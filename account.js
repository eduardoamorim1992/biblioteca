/* Conta e sincronização.
 *
 * Regra do projeto: o app continua funcionando sem conta, exatamente como
 * antes. Entrar é opcional e só acrescenta — nunca é pré-requisito para ler
 * nem para registrar leitura.
 *
 * A sincronização é explícita, com dois botões, em vez de automática. Sync
 * automático entre um banco local e um remoto precisa resolver conflito, e
 * resolver conflito errado apaga leitura registrada. Enquanto não houver uma
 * regra boa, quem decide é o usuário. */
"use strict";

(() => {
  const $ = id => document.getElementById(id);

  /* ------------------------------------------------------------------ mapa
     Liga cada registro local ao seu par no servidor. Sem isso, cada envio
     duplicaria a estante inteira. */
  const MAP_KEY = "biblioteca.sync.v1";
  let map = { books: {}, sessions: {}, notes: {} };
  try { map = Object.assign(map, JSON.parse(localStorage.getItem(MAP_KEY) || "{}")); } catch (e) { }
  const saveMap = () => localStorage.setItem(MAP_KEY, JSON.stringify(map));

  const bookRow = b => ({
    owner: Supa.user.id,
    title: b.title,
    author: b.author || null,
    pages: b.pages || null,
    current_page: b.pages ? Math.min(b.current || 0, b.pages) : (b.current || 0),
    status: b.status,
    priority: b.priority ?? 1,
    cover_url: b.cover || null,
    year: b.year || null,
    isbn: b.isbn || null,
    ol_key: b.olKey || null,
    synopsis: b.synopsis || null,
    started_at: b.startedAt || null,
    finished_at: b.finishedAt || null
  });

  async function pushAll(onStep) {
    if (!Supa.user) throw new Error("Entre na sua conta primeiro.");
    const feito = { livros: 0, sessoes: 0, notas: 0 };

    for (const b of state.books) {
      const row = bookRow(b);
      const remote = map.books[b.id];
      if (remote) {
        await Supa.update("books", { id: "eq." + remote }, row);
      } else {
        const [created] = await Supa.insert("books", [row]);
        map.books[b.id] = created.id;
      }
      feito.livros++;
      onStep && onStep(`livros ${feito.livros}/${state.books.length}`);
    }
    saveMap();

    const novasSessoes = state.sessions.filter(s => !map.sessions[s.id] && map.books[s.bookId]);
    for (let i = 0; i < novasSessoes.length; i += 100) {
      const lote = novasSessoes.slice(i, i + 100);
      const criadas = await Supa.insert("sessions", lote.map(s => ({
        owner: Supa.user.id, book_id: map.books[s.bookId],
        date: s.date, pages: s.pages || 0, minutes: s.minutes || 0
      })));
      lote.forEach((s, k) => { if (criadas[k]) map.sessions[s.id] = criadas[k].id; });
      feito.sessoes += lote.length;
      onStep && onStep(`sessões ${feito.sessoes}/${novasSessoes.length}`);
    }
    saveMap();

    const novasNotas = state.notes.filter(n => !map.notes[n.id] && map.books[n.bookId]);
    if (novasNotas.length) {
      const criadas = await Supa.insert("notes", novasNotas.map(n => ({
        owner: Supa.user.id, book_id: map.books[n.bookId],
        page: n.page || null, kind: n.type === "quote" ? "quote" : "note",
        body: n.text, is_public: false
      })));
      novasNotas.forEach((n, k) => { if (criadas[k]) map.notes[n.id] = criadas[k].id; });
      feito.notas = novasNotas.length;
    }
    saveMap();
    return feito;
  }

  async function pullAll() {
    if (!Supa.user) throw new Error("Entre na sua conta primeiro.");
    const [books, sessions, notes] = await Promise.all([
      Supa.select("books", { order: "created_at.asc" }),
      Supa.select("sessions", { order: "date.asc" }),
      Supa.select("notes", { order: "created_at.asc" })
    ]);

    const porRemoto = {};
    state.books = books.map(b => {
      const local = uid();
      porRemoto[b.id] = local;
      map.books[local] = b.id;
      return {
        id: local, title: b.title, author: b.author || "", pages: b.pages || 0,
        current: b.current_page || 0, status: b.status, priority: b.priority ?? 1,
        cover: b.cover_url || null, year: b.year || null, isbn: b.isbn || null,
        olKey: b.ol_key || null, synopsis: b.synopsis || null,
        addedAt: (b.created_at || "").slice(0, 10) || todayISO(),
        startedAt: b.started_at || null, finishedAt: b.finished_at || null
      };
    });
    state.sessions = sessions.filter(s => porRemoto[s.book_id]).map(s => {
      const local = uid(); map.sessions[local] = s.id;
      return { id: local, bookId: porRemoto[s.book_id], date: s.date,
               pages: s.pages || 0, minutes: s.minutes || 0, createdAt: Date.parse(s.created_at) || Date.now() };
    });
    state.notes = notes.filter(n => porRemoto[n.book_id]).map(n => {
      const local = uid(); map.notes[local] = n.id;
      return { id: local, bookId: porRemoto[n.book_id], page: n.page || null,
               type: n.kind === "quote" ? "quote" : "note", text: n.body,
               createdAt: Date.parse(n.created_at) || Date.now() };
    });
    state.timer = null;
    saveMap(); save(); renderAll();
    return { livros: state.books.length, sessoes: state.sessions.length, notas: state.notes.length };
  }

  /* -------------------------------------------------------------------- UI
     Duas superfícies distintas: a tela cheia de entrada, para quem está de
     fora, e o diálogo de conta, para quem já está dentro. Nunca as duas. */
  const dlg = $("authDlg");
  const view = $("authView");
  let perfil = null;

  const telaAberta = () => !view.hidden;

  const PRIMEIRO_CAMPO = { entrar: "inEmail", criar: "upNome", novaSenha: "npSenha" };

  function abreTela(qual = "entrar") {
    $("paneEntrar").hidden = qual !== "entrar";
    $("paneCriar").hidden = qual !== "criar";
    $("paneNovaSenha").hidden = qual !== "novaSenha";
    // Na volta do link de recuperação não faz sentido oferecer "usar sem conta".
    $("authSkip").hidden = qual === "novaSenha";
    view.hidden = false;
    document.body.style.overflow = "hidden";
    aviso("");
    setTimeout(() => { const i = $(PRIMEIRO_CAMPO[qual]); i && i.focus(); }, 60);
  }
  function fechaTela() {
    view.hidden = true;
    document.body.style.overflow = "";
    aviso("");
  }

  function pinta(sessao) {
    const btn = $("accountBtn");
    btn.textContent = sessao ? (perfil ? "@" + perfil.username : "conta") : "Entrar";
    btn.classList.toggle("primary", !sessao);
    if (sessao) fechaTela();
    if (sessao && perfil) {
      $("pUsername").value = perfil.username || "";
      $("pName").value = perfil.display_name || "";
      $("pBio").value = perfil.bio || "";
      $("pPrivate").checked = !!perfil.is_private;
      $("accountEmail").textContent = (Supa.user && Supa.user.email) || "";
    }
  }

  /** Escreve dentro do formulário que está à vista, nunca num rodapé flutuante:
      mensagem fora da área visível é o mesmo que mensagem nenhuma. */
  function aviso(texto, tipo) {
    const alvo = !telaAberta() ? "acctMsg"
               : !$("paneNovaSenha").hidden ? "msgNovaSenha"
               : !$("paneCriar").hidden ? "msgCriar"
               : "msgEntrar";
    for (const id of ["acctMsg", "msgEntrar", "msgCriar", "msgNovaSenha"]) {
      const el = $(id);
      if (!el) continue;
      if (id === alvo) {
        el.textContent = texto || "";
        el.hidden = !texto;
        el.className = "auth-msg" + (tipo ? " " + tipo : "");
        if (texto) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        el.hidden = true;
      }
    }
  }

  /** Trava o botão enquanto a requisição corre, para não disparar duas vezes. */
  async function comEspera(form, texto, fn) {
    const btn = form.querySelector("button[type=submit]");
    const rotulo = btn.textContent;
    btn.disabled = true; btn.textContent = texto;
    try { return await fn(); }
    finally { btn.disabled = false; btn.textContent = rotulo; }
  }

  async function carregaPerfil() {
    try { perfil = await Supa.myProfile(); } catch (e) { perfil = null; }
    pinta(Supa.session);
  }

  Supa.onChange(s => { if (!s) { perfil = null; } pinta(s); });

  // Fora da conta abre a tela de entrada; dentro, o painel da conta.
  $("accountBtn").addEventListener("click", async () => {
    if (!Supa.ready) return toast("Backend não configurado.");
    if (Supa.session) {
      dlg.showModal();
      if (!perfil) await carregaPerfil();
    } else {
      abreTela("entrar");
    }
  });
  $("authClose").addEventListener("click", () => dlg.close());
  $("authSkip").addEventListener("click", fechaTela);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && telaAberta()) fechaTela(); });

  document.querySelectorAll("[data-goto]").forEach(b =>
    b.addEventListener("click", () => abreTela(b.dataset.goto)));

  document.querySelectorAll("[data-eye]").forEach(b => b.addEventListener("click", () => {
    const campo = $(b.dataset.eye);
    const escondida = campo.type === "password";
    campo.type = escondida ? "text" : "password";
    b.textContent = escondida ? "ocultar" : "mostrar";
    campo.focus();
  }));

  const emailValido = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

  $("formEntrar").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("inEmail").value.trim(), senha = $("inSenha").value;
    if (!emailValido(email)) return aviso("Confira o e-mail digitado.", "erro");
    if (!senha) return aviso("Digite sua senha.", "erro");
    aviso("");
    try {
      await comEspera(e.target, "Entrando…", () => Supa.signIn(email, senha));
      await carregaPerfil();
      toast("Bem-vindo de volta.");
    } catch (err) {
      const m = err.message || "";
      aviso(m === "Invalid login credentials" ? "E-mail ou senha incorretos."
          : /Email not confirmed/i.test(m) ? "Confirme o e-mail antes de entrar — o link foi para sua caixa."
          : m, "erro");
    }
  });

  $("formCriar").addEventListener("submit", async e => {
    e.preventDefault();
    const nome = $("upNome").value.trim(), email = $("upEmail").value.trim(), senha = $("upSenha").value;
    if (!nome) return aviso("Diga como quer ser chamado.", "erro");
    if (!emailValido(email)) return aviso("Confira o e-mail digitado.", "erro");
    if (senha.length < 8) return aviso("A senha precisa de pelo menos 8 caracteres.", "erro");
    aviso("");
    try {
      const r = await comEspera(e.target, "Criando…", () => Supa.signUp(email, senha, nome));
      if (r.session) { await carregaPerfil(); toast("Conta criada."); }
      else aviso(`Enviamos um e-mail de confirmação para ${r.email}. Confirme e depois entre.`, "ok");
    } catch (err) {
      const m = err.message || "";
      aviso(/already registered/i.test(m) ? "Esse e-mail já tem conta. Tente entrar." : m, "erro");
    }
  });

  $("formNovaSenha").addEventListener("submit", async e => {
    e.preventDefault();
    const s1 = $("npSenha").value, s2 = $("npConfirma").value;
    if (s1.length < 8) return aviso("A senha precisa de pelo menos 8 caracteres.", "erro");
    if (s1 !== s2) return aviso("As duas senhas não são iguais.", "erro");
    try {
      await comEspera(e.target, "Salvando…", () => Supa.updatePassword(s1));
      await carregaPerfil();
      fechaTela();
      toast("Senha trocada. Você está dentro.");
    } catch (err) {
      const m = err.message || "";
      aviso(/should be different/i.test(m) ? "Escolha uma senha diferente da anterior."
          : /session|expired|token/i.test(m) ? "O link de recuperação expirou. Peça outro."
          : m, "erro");
    }
  });

  $("btnEsqueci").addEventListener("click", async () => {
    const email = $("inEmail").value.trim();
    if (!emailValido(email)) return aviso("Digite seu e-mail no campo acima e clique de novo.", "erro");
    try {
      await Supa.resetPassword(email, location.origin + location.pathname);
      aviso(`Se existir conta com ${email}, o link de recuperação chegou por e-mail.`, "ok");
    } catch (err) { aviso(err.message, "erro"); }
  });

  $("btnSair").addEventListener("click", async () => {
    await Supa.signOut();
    toast("Você saiu. Seus dados continuam neste navegador.");
    dlg.close();
  });

  $("formPerfil").addEventListener("submit", async e => {
    e.preventDefault();
    aviso("Salvando…");
    try {
      perfil = await Supa.updateProfile({
        username: $("pUsername").value.trim().toLowerCase(),
        display_name: $("pName").value.trim(),
        bio: $("pBio").value.trim() || null,
        is_private: $("pPrivate").checked
      });
      pinta(Supa.session);
      aviso("Perfil salvo.", "ok");
    } catch (err) {
      aviso(err.code === "23505" ? "Esse @ já está em uso." : err.message, "erro");
    }
  });

  $("btnEnviar").addEventListener("click", async () => {
    if (!confirm("Enviar sua estante, sessões e anotações para a conta?")) return;
    aviso("Enviando…");
    try {
      const r = await pushAll(p => aviso("Enviando " + p));
      aviso(`Enviado: ${r.livros} livros, ${r.sessoes} sessões, ${r.notas} anotações.`, "ok");
    } catch (err) { aviso("Falhou: " + err.message, "erro"); }
  });

  $("btnTrazer").addEventListener("click", async () => {
    if (!confirm("Isso substitui os dados deste navegador pelos da conta. Continuar?")) return;
    aviso("Baixando…");
    try {
      const r = await pullAll();
      aviso(`Trazido: ${r.livros} livros, ${r.sessoes} sessões, ${r.notas} anotações.`, "ok");
    } catch (err) { aviso("Falhou: " + err.message, "erro"); }
  });

  /* Chegou de volta de um link de confirmação, recuperação ou OAuth. */
  (async () => {
    const r = await Supa.captureFromUrl();
    if (!r) { if (Supa.session) carregaPerfil(); return; }

    if (r.error) {
      abreTela("entrar");
      aviso(r.error, "erro");
      return;
    }
    // Recuperação de senha: o link autentica, mas a troca ainda precisa acontecer.
    if (r.type === "recovery") {
      await carregaPerfil();
      abreTela("novaSenha");
      aviso("Link confirmado. Defina sua nova senha.", "ok");
      return;
    }

    await carregaPerfil();
    toast(r.type === "signup" ? "E-mail confirmado. Bem-vindo!" : "Você entrou.");
    if (r.type === "signup") {
      dlg.showModal();
      aviso("Conta confirmada. Escolha seu @ e envie seus dados para a conta.", "ok");
    }
  })();
})();
