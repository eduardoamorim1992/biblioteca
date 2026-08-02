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

  /* -------------------------------------------------------------------- UI */
  const dlg = $("authDlg");
  let perfil = null;

  function pinta(sessao) {
    const btn = $("accountBtn");
    btn.textContent = sessao ? (perfil ? "@" + perfil.username : "conta") : "Entrar";
    btn.classList.toggle("primary", !sessao);
    $("authForms").hidden = !!sessao;
    $("accountPanel").hidden = !sessao;
    if (sessao && perfil) {
      $("pUsername").value = perfil.username || "";
      $("pName").value = perfil.display_name || "";
      $("pBio").value = perfil.bio || "";
      $("pPrivate").checked = !!perfil.is_private;
      $("accountEmail").textContent = (Supa.user && Supa.user.email) || "";
    }
  }

  function aviso(texto, tipo) {
    const el = $("authMsg");
    el.textContent = texto || "";
    el.hidden = !texto;
    el.className = "auth-msg" + (tipo ? " " + tipo : "");
  }

  async function carregaPerfil() {
    try { perfil = await Supa.myProfile(); } catch (e) { perfil = null; }
    pinta(Supa.session);
  }

  Supa.onChange(s => { if (!s) { perfil = null; } pinta(s); });

  $("accountBtn").addEventListener("click", async () => {
    if (!Supa.ready) return toast("Backend não configurado.");
    aviso("");
    dlg.showModal();
    if (Supa.session && !perfil) await carregaPerfil();
  });
  $("authClose").addEventListener("click", () => dlg.close());

  document.querySelectorAll("[data-authtab]").forEach(t => t.addEventListener("click", () => {
    const alvo = t.dataset.authtab;
    document.querySelectorAll("[data-authtab]").forEach(x => x.setAttribute("aria-selected", String(x === t)));
    $("formEntrar").hidden = alvo !== "entrar";
    $("formCriar").hidden = alvo !== "criar";
    aviso("");
  }));

  $("formEntrar").addEventListener("submit", async e => {
    e.preventDefault();
    aviso("Entrando…");
    try {
      await Supa.signIn($("inEmail").value.trim(), $("inSenha").value);
      await carregaPerfil();
      aviso("");
      toast("Bem-vindo de volta.");
    } catch (err) {
      aviso(err.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : err.message, "erro");
    }
  });

  $("formCriar").addEventListener("submit", async e => {
    e.preventDefault();
    const senha = $("upSenha").value;
    if (senha.length < 8) return aviso("A senha precisa de pelo menos 8 caracteres.", "erro");
    aviso("Criando conta…");
    try {
      const r = await Supa.signUp($("upEmail").value.trim(), senha, $("upNome").value.trim());
      if (r.session) { await carregaPerfil(); aviso(""); toast("Conta criada."); }
      else aviso(`Enviamos um e-mail de confirmação para ${r.email}. Confirme e depois entre.`, "ok");
    } catch (err) {
      aviso(err.message, "erro");
    }
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

  if (Supa.session) carregaPerfil();
})();
