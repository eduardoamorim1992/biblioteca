/* Conta e sincronização.
 *
 * Regra do projeto: o app continua funcionando sem conta, exatamente como
 * antes. Entrar é opcional e só acrescenta — nunca é pré-requisito para ler
 * nem para registrar leitura.
 *
 * A sincronização é automática. Antes era manual, com dois botões, para não
 * ter que resolver conflito — mas o preço disso era o app mentir: quem
 * criava conta, lia, e abria o app em outro navegador achava a estante
 * vazia. Guardar no navegador e chamar isso de conta não é conta.
 *
 * O que torna a automática segura aqui:
 *   - o id local É o id do servidor (uuid), então o mesmo registro é o mesmo
 *     registro em qualquer aparelho e reenviar não duplica nada;
 *   - a "sombra" guarda o que o servidor tem de cada registro, então dá para
 *     distinguir "editei aqui" de "mudou lá" sem precisar de relógio;
 *   - em qualquer empate, dado sobrevive: nada é apagado por dedução. */
"use strict";

(() => {
  const $ = id => document.getElementById(id);

  /* Declarado logo aqui, antes de qualquer outra coisa: migraIds() (bem
     abaixo) pode chamar save() -> Sync.mudou() -> pinta_sync() já na carga
     da página, sempre que o navegador abre com uma sessão ainda válida
     guardada. pinta_sync() lê dlg.open. Um `const dlg` declarado mais adiante
     no arquivo cai na zona morta temporal nesse caminho e o ReferenceError
     aborta o resto do script — dlg, view e nenhum dos addEventListener de
     login chega a existir. Quem sofria isso via a tela de entrada travada,
     como se o app tivesse simplesmente parado de responder. */
  const dlg = $("authDlg");
  const view = $("authView");

  /* =================================================================== dados
     A sombra é a memória do que o servidor tem: id -> impressão digital da
     linha enviada. Com ela, três perguntas ficam respondíveis sem relógio e
     sem coluna nova no banco:
       registro local != sombra  -> mudou aqui, precisa subir
       está na sombra e sumiu daqui -> apaguei aqui, precisa apagar lá
       está na sombra e sumiu de lá -> apagaram em outro aparelho */
  const SYNC_KEY = "biblioteca.sync.v2";
  const MAPA_ANTIGO = "biblioteca.sync.v1";

  const sombraVazia = () => ({ books: {}, sessions: {}, notes: {} });
  let meta = { userId: null, shadow: sombraVazia(), quarentena: {}, lastSync: 0, migrado: false };
  try { Object.assign(meta, JSON.parse(localStorage.getItem(SYNC_KEY) || "{}")); } catch (e) { }
  meta.shadow = Object.assign(sombraVazia(), meta.shadow);
  meta.quarentena = meta.quarentena || {};
  const salvaMeta = () => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(meta)); } catch (e) { } };

  /* Impressão digital da linha (FNV-1a). Só precisa responder "é a mesma
     coisa?", não precisa ser criptográfica — e guardar a linha inteira na
     sombra dobraria o espaço usado no navegador. */
  function digital(obj) {
    const s = JSON.stringify(obj);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36) + "." + s.length;
  }

  /* --------------------------------------------------- tradução local <-> banco
     As duas direções precisam ser idempotentes: traduzir de ida e de volta
     tem que devolver a mesma impressão digital, senão todo registro baixado
     pareceria "alterado aqui" e subiria de novo para sempre. */
  const limite = (n, min, max) => (typeof n === "number" && isFinite(n) ? Math.min(Math.max(Math.round(n), min), max) : null);

  /* Só conteúdo: dono e id entram na hora de enviar. Misturar identidade com
     conteúdo faria a impressão digital mudar por motivo que não é do usuário. */
  const bookRow = b => {
    const pages = limite(b.pages, 1, 20000);
    return {
      title: String(b.title || "").slice(0, 300),
      author: b.author || null,
      pages,
      current_page: Math.max(0, Math.min(b.current || 0, pages || Infinity)) || 0,
      status: ["fila", "lendo", "lido", "abandonado"].includes(b.status) ? b.status : "fila",
      priority: limite(b.priority ?? 1, 0, 2) ?? 1,
      cover_url: b.cover || null,
      year: b.year || null,
      isbn: b.isbn || null,
      ol_key: b.olKey || null,
      synopsis: b.synopsis || null,
      started_at: b.startedAt || null,
      finished_at: b.finishedAt || null
    };
  };
  const sessionRow = s => ({
    book_id: s.bookId, date: s.date,
    pages: Math.max(0, s.pages || 0), minutes: Math.max(0, s.minutes || 0)
  });
  const noteRow = n => ({
    book_id: n.bookId, page: n.page || null,
    kind: n.type === "quote" ? "quote" : "note",
    body: String(n.text || "").slice(0, 4000), is_public: n.isPublic === true
  });

  const bookLocal = r => ({
    id: r.id, title: r.title, author: r.author || "", pages: r.pages || 0,
    current: r.current_page || 0, status: r.status, priority: r.priority ?? 1,
    cover: r.cover_url || null, year: r.year || null, isbn: r.isbn || null,
    olKey: r.ol_key || null, synopsis: r.synopsis || null,
    addedAt: (r.created_at || "").slice(0, 10) || todayISO(),
    startedAt: r.started_at || null, finishedAt: r.finished_at || null
  });
  const sessionLocal = r => ({
    id: r.id, bookId: r.book_id, date: r.date, pages: r.pages || 0,
    minutes: r.minutes || 0, createdAt: Date.parse(r.created_at) || Date.now()
  });
  const noteLocal = r => ({
    id: r.id, bookId: r.book_id, page: r.page || null,
    type: r.kind === "quote" ? "quote" : "note", text: r.body,
    isPublic: !!r.is_public, createdAt: Date.parse(r.created_at) || Date.now()
  });

  /* O banco recusa linha fora destas regras. Mandar assim mesmo derrubaria o
     lote inteiro por causa de um registro estranho — melhor deixar o esquisito
     em casa do que travar a sincronia de todo o resto. */
  const TABELAS = {
    books: {
      linha: bookRow, local: bookLocal,
      lista: () => state.books, guarda: v => { state.books = v; },
      valido: b => !!String(b.title || "").trim()
    },
    sessions: {
      linha: sessionRow, local: sessionLocal,
      lista: () => state.sessions, guarda: v => { state.sessions = v; },
      valido: s => !!s.date && ((s.pages || 0) > 0 || (s.minutes || 0) > 0)
    },
    notes: {
      linha: noteRow, local: noteLocal,
      lista: () => state.notes, guarda: v => { state.notes = v; },
      valido: n => !!String(n.text || "").trim()
    }
  };
  const ORDEM = ["books", "sessions", "notes"];   // livro antes do que aponta para ele

  /* ================================================================ migração
     Quem já usava o app tem ids antigos e, talvez, um mapa local->remoto da
     versão manual. Reaproveitar esse mapa é o que evita duplicar no servidor
     tudo que já tinha sido enviado uma vez. */
  const EH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function migraIds() {
    if (meta.migrado) return;
    let antigo = {};
    try { antigo = JSON.parse(localStorage.getItem(MAPA_ANTIGO) || "{}"); } catch (e) { }
    const novo = (tabela, id) => (antigo[tabela] && antigo[tabela][id]) || uid();

    const deLivro = {};
    for (const b of state.books) {
      const id = EH_UUID.test(b.id) ? b.id : novo("books", b.id);
      deLivro[b.id] = id; b.id = id;
    }
    for (const s of state.sessions) {
      if (!EH_UUID.test(s.id)) s.id = novo("sessions", s.id);
      s.bookId = deLivro[s.bookId] || s.bookId;
    }
    for (const n of state.notes) {
      if (!EH_UUID.test(n.id)) n.id = novo("notes", n.id);
      n.bookId = deLivro[n.bookId] || n.bookId;
    }
    if (state.timer && deLivro[state.timer.bookId]) state.timer.bookId = deLivro[state.timer.bookId];

    meta.migrado = true;
    salvaMeta();
    save();
  }

  /* ================================================================== subida */
  function pendentes(nome) {
    const t = TABELAS[nome], sombra = meta.shadow[nome];
    const vistos = new Set();
    const sujos = [];
    for (const r of t.lista()) {
      vistos.add(r.id);
      if (!t.valido(r)) continue;
      const linha = t.linha(r);
      const h = digital(linha);
      if (sombra[r.id] === h) continue;
      if (meta.quarentena[nome + ":" + r.id] === h) continue;   // já recusada assim
      sujos.push({ id: r.id, linha, h });
    }
    return { sujos, apagados: Object.keys(sombra).filter(id => !vistos.has(id)) };
  }

  const contaPendentes = () => {
    if (!Supa.user) return 0;
    return ORDEM.reduce((n, t) => {
      const p = pendentes(t);
      return n + p.sujos.length + p.apagados.length;
    }, 0);
  };

  async function empurra() {
    // Apaga do fim para o começo: sessões e notas antes dos livros que elas
    // apontam. (O banco cascatearia de qualquer jeito, mas depender disso
    // seria confiar em efeito colateral.)
    for (const nome of [...ORDEM].reverse()) {
      const { apagados } = pendentes(nome);
      for (let i = 0; i < apagados.length; i += 50) {
        const lote = apagados.slice(i, i + 50);
        await Supa.remove(nome, { id: "in.(" + lote.join(",") + ")" });
        lote.forEach(id => delete meta.shadow[nome][id]);
        salvaMeta();
      }
    }

    for (const nome of ORDEM) {
      const t = TABELAS[nome];
      let { sujos } = pendentes(nome);
      // Sessão ou nota de livro que o servidor ainda não tem quebraria a
      // chave estrangeira; ela sobe na próxima rodada, depois do livro.
      if (nome !== "books") sujos = sujos.filter(x => {
        const reg = t.lista().find(r => r.id === x.id);
        return reg && meta.shadow.books[reg.bookId] !== undefined;
      });

      for (let i = 0; i < sujos.length; i += 100) {
        const lote = sujos.slice(i, i + 100);
        try {
          await Supa.upsert(nome, lote.map(x => Object.assign({ id: x.id, owner: Supa.user.id }, x.linha)));
          lote.forEach(x => { meta.shadow[nome][x.id] = x.h; });
        } catch (e) {
          if (deRede(e)) throw e;
          // O lote caiu por causa de alguma linha; descobre qual mandando uma
          // a uma, para que um registro problemático não segure os outros.
          for (const x of lote) {
            try {
              await Supa.upsert(nome, [Object.assign({ id: x.id, owner: Supa.user.id }, x.linha)]);
              meta.shadow[nome][x.id] = x.h;
            } catch (e2) {
              if (deRede(e2)) throw e2;
              meta.quarentena[nome + ":" + x.id] = x.h;
              console.warn("registro recusado pelo servidor:", nome, x.id, e2.message);
            }
          }
        }
        salvaMeta();
      }
    }
  }

  /* ================================================================== descida
     Filtro por dono aqui não é opcional. O RLS de `books` (e de `notes`
     públicas) permite ler o que é seu OU o que pertence a qualquer perfil
     público — de propósito, é o que alimenta "quem mais lê este livro" e o
     feed. Sem o `owner=eq.<eu>` explícito, esta função herdava essa leitura
     ampla: puxar "meus livros" trazia a estante de qualquer usuário com
     perfil público junto, e funde() mesclava tudo como se fosse do dono da
     sessão. Foi assim que uma conta nova apareceu com os livros de outra
     pessoa — RLS decide o que É PERMITIDO ler, não o que É MEU, e só o
     código sabe a diferença. */
  async function leTudo(nome) {
    const linhas = [];
    for (let offset = 0; ; offset += 1000) {
      const lote = await Supa.select(nome, {
        owner: "eq." + Supa.user.id, order: "created_at.asc", limit: 1000, offset
      });
      linhas.push(...lote);
      if (lote.length < 1000) return linhas;
    }
  }

  async function puxa() {
    const [books, sessions, notes] = await Promise.all(ORDEM.map(leTudo));
    let mudou = false;

    const funde = (nome, remotos) => {
      const t = TABELAS[nome], sombra = meta.shadow[nome];
      const locais = new Map(t.lista().map(r => [r.id, r]));
      const daServidor = new Set();
      const saida = [];

      for (const rem of remotos) {
        daServidor.add(rem.id);
        const local = locais.get(rem.id);
        // Apagado aqui e ainda não apagado lá. Adotar o registro do servidor
        // agora ressuscitaria o que o usuário acabou de excluir — a exclusão
        // ainda não subiu, e a sombra é justamente a prova de que ele existia.
        if (!local && sombra[rem.id] !== undefined) continue;
        // Alterado aqui e ainda não enviado: o local manda, e a alteração
        // sobe logo em seguida. Só assim editar offline não vira nada.
        if (local && t.valido(local) && sombra[local.id] !== digital(t.linha(local))) { saida.push(local); continue; }
        const novo = t.local(rem);
        if (!local || digital(t.linha(novo)) !== digital(t.linha(local))) mudou = true;
        sombra[rem.id] = digital(t.linha(novo));
        saida.push(novo);
      }

      for (const local of t.lista()) {
        if (daServidor.has(local.id)) continue;
        if (sombra[local.id] === undefined) { saida.push(local); continue; }  // nasceu aqui, ainda vai subir
        if (t.valido(local) && sombra[local.id] !== digital(t.linha(local))) { saida.push(local); continue; }
        // Estava sincronizado, sumiu do servidor: apagaram em outro aparelho.
        delete sombra[local.id];
        mudou = true;
      }
      return saida;
    };

    const livros = funde("books", books);
    const idsLivros = new Set(livros.map(b => b.id));
    TABELAS.books.guarda(livros);
    // Sessão ou nota sem livro não tem onde aparecer na tela; some junto.
    TABELAS.sessions.guarda(funde("sessions", sessions).filter(s => idsLivros.has(s.bookId)));
    TABELAS.notes.guarda(funde("notes", notes).filter(n => idsLivros.has(n.bookId)));

    salvaMeta();
    if (mudou) { aplicando = true; save(); aplicando = false; renderAll(); }
    return mudou;
  }

  /* ================================================================= motor
     Uma rodada por vez. Pedido que chega no meio de uma rodada não é
     descartado — vira a próxima, senão a última tecla digitada seria
     justamente a que não subiu. */
  const deRede = e => /Failed to fetch|NetworkError|load failed|network/i.test((e && e.message) || "") ||
                      (e && (e.status === 0 || e.status >= 500));

  let rodando = null, pedidoNaFila = false, puxarNaFila = false, aplicando = false, agendado = null;
  let contaSincronizada = null;
  let situacao = { estado: "ocioso", erro: "" };

  async function sincroniza(opcoes = {}) {
    if (!Supa.user) return;
    // Mudança feita no meio de uma rodada não entra nela — a lista do que
    // subir já foi montada. Fica para a próxima, que é disparada aqui mesmo.
    if (rodando) {
      pedidoNaFila = true;
      puxarNaFila = puxarNaFila || !opcoes.somenteSubida;
      return rodando;
    }

    const esta = rodando = (async () => {
      pinta_sync("indo");
      try {
        if (!opcoes.somenteSubida) await puxa();
        await empurra();
        meta.lastSync = Date.now();
        salvaMeta();
        pinta_sync("ok");
      } catch (e) {
        situacao.erro = e.message || String(e);
        pinta_sync(deRede(e) ? "offline" : "erro");
        console.warn("sincronia falhou:", e);
      } finally {
        rodando = null;
      }
    })();

    await esta;
    if (!pedidoNaFila) return;
    pedidoNaFila = false;
    const comDescida = puxarNaFila; puxarNaFila = false;
    return sincroniza({ somenteSubida: !comDescida });
  }

  function pinta_sync(estado) {
    situacao.estado = estado;
    pinta_pilula(estado);

    const el = $("syncStatus");
    // Contar pendências percorre a estante inteira; fora do painel aberto,
    // ninguém está olhando, e isso rodaria a cada tecla registrada.
    if (!el || !dlg.open) return;
    const n = contaPendentes();
    const quando = meta.lastSync ? new Date(meta.lastSync).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null;
    el.textContent =
      !Supa.user ? "Entre na conta para sincronizar."
      : estado === "indo" ? "Sincronizando…"
      : estado === "offline" ? `Sem conexão com o servidor. ${n} alteraç${n === 1 ? "ão" : "ões"} esperando — nada se perde, tento de novo sozinho.`
      : estado === "erro" ? "Falhou: " + situacao.erro
      : n ? `${n} alteraç${n === 1 ? "ão" : "ões"} para enviar.`
      : quando ? `Tudo salvo na conta (${quando}).`
      : "Automática: tudo que você registra sobe sozinho.";
  }

  /* A pílula do cabeçalho fica visível o tempo todo, então precisa ser barata:
     só estado e horário, nunca contagem — contar percorre a estante inteira, e
     isto é repintado a cada registro. O número exato mora no painel. */
  function pinta_pilula(estado) {
    const p = $("headSync");
    if (!p) return;
    if (!Supa.user) { p.hidden = true; return; }
    const quando = meta.lastSync ? new Date(meta.lastSync).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null;
    p.hidden = false;
    p.dataset.estado = estado;
    p.innerHTML = `<span class="led"></span>` + (
      estado === "indo" ? "salvando…"
      : estado === "offline" ? "sem conexão"
      : estado === "erro" ? "não salvou"
      : quando ? `salvo ${quando}` : "salva sozinho"
    );
    p.title = estado === "erro" ? "Falhou: " + situacao.erro
            : estado === "offline" ? "As alterações estão guardadas aqui e sobem quando a conexão voltar."
            : "Sua estante está salva na conta.";
  }

  /* Some mudanças vêm em rajada (registrar leitura mexe em livro e sessão).
     Espera o dedo sair do teclado antes de falar com o servidor. */
  function mudou() {
    if (aplicando || !Supa.user) return;
    pinta_sync(situacao.estado === "indo" ? "indo" : "ocioso");
    clearTimeout(agendado);
    agendado = setTimeout(() => sincroniza({ somenteSubida: true }), 1500);
  }

  window.Sync = {
    mudou, agora: () => sincroniza(), pendentes: contaPendentes,
    entrou: () => comecaSincronia()      // "esta conta assumiu este navegador"
  };

  // Antes de qualquer sincronia, e independente de ter conta: id local
  // esquisito é problema deste navegador, não do servidor.
  migraIds();

  /* Primeira sincronia da sessão: cuida também da troca de conta. */
  async function comecaSincronia() {
    if (!Supa.user) return;

    if (meta.userId && meta.userId !== Supa.user.id) {
      // Estes dados são da conta anterior — e já estão salvos nela. Levá-los
      // para a conta nova seria misturar a estante de duas pessoas.
      //
      // Menos o que ainda não tinha subido: isso não está salvo em lugar
      // nenhum, e não há token da conta anterior para enviar agora. Fica
      // guardado aqui, sem entrar na estante nova, em vez de evaporar.
      const sobrando = contaPendentes();
      if (sobrando) {
        try {
          localStorage.setItem("biblioteca.orfaos." + meta.userId, JSON.stringify({
            salvoEm: new Date().toISOString(),
            books: state.books, sessions: state.sessions, notes: state.notes
          }));
          toast(`${sobrando} alteraç${sobrando === 1 ? "ão" : "ões"} da conta anterior não tinham subido. ` +
                `Guardei neste navegador em vez de misturar as estantes.`);
        } catch (e) { console.warn("não consegui guardar os órfãos:", e); }
      }
      state.books = []; state.sessions = []; state.notes = []; state.timer = null;
      meta.shadow = sombraVazia(); meta.quarentena = {}; meta.lastSync = 0;
      aplicando = true; save(); aplicando = false; renderAll();
    }
    meta.userId = Supa.user.id;
    salvaMeta();
    await sincroniza();
  }

  // Voltar para o app, reconectar e trocar de aba são os momentos em que o
  // outro aparelho pode ter mudado alguma coisa.
  addEventListener("online", () => sincroniza());
  addEventListener("visibilitychange", () => {
    if (document.hidden) { if (Supa.user) sincroniza({ somenteSubida: true }); }
    else if (Supa.user && Date.now() - meta.lastSync > 30000) sincroniza();
  });
  setInterval(() => { if (!document.hidden && Supa.user) sincroniza(); }, 5 * 60 * 1000);

  /* -------------------------------------------------------------------- UI
     Duas superfícies distintas: a tela cheia de entrada, para quem está de
     fora, e o diálogo de conta, para quem já está dentro. Nunca as duas.
     (dlg e view são declarados lá em cima, antes de migraIds().) */
  let perfil = null;

  const telaAberta = () => !view.hidden;

  const PRIMEIRO_CAMPO = { entrar: "inEmail", criar: "upNome", novaSenha: "npSenha" };

  function abreTela(qual = "entrar") {
    $("paneEntrar").hidden = qual !== "entrar";
    $("paneCriar").hidden = qual !== "criar";
    $("paneNovaSenha").hidden = qual !== "novaSenha";
    view.hidden = false;
    document.body.style.overflow = "hidden";
    $("linhaReenviar").hidden = true;
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
    const alvo = telaAberta() ? (!$("paneNovaSenha").hidden ? "msgNovaSenha"
                              : !$("paneCriar").hidden ? "msgCriar"
                              : "msgEntrar")
               : dlg.open ? "acctMsg"
               : null;
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
    // Nenhuma das duas superfícies está à vista: escrever no diálogo fechado
    // seria falar para uma parede. O toast é o que sobra.
    if (!alvo && texto) toast(texto);
  }

  /** Trava o botão enquanto a requisição corre, para não disparar duas vezes. */
  async function comEspera(form, texto, fn) {
    const btn = form.querySelector("button[type=submit]");
    const rotulo = btn.textContent;
    btn.disabled = true; btn.textContent = texto;
    try { return await fn(); }
    finally { btn.disabled = false; btn.textContent = rotulo; }
  }

  /* O perfil é enfeite: decide o que aparece no botão da conta. A sessão é o
     que importa. Falha aqui não pode desfazer uma entrada bem-sucedida — era
     exatamente isso que expulsava o usuário de volta para a tela de entrada,
     em silêncio, logo depois de ele acertar a senha. */
  async function carregaPerfil() {
    try {
      perfil = await Supa.myProfile();
    } catch (e) {
      perfil = null;
      console.warn("perfil não carregou:", e);
      if (Supa.session) toast("Você entrou, mas o perfil não carregou: " + e.message);
    }
    pinta(Supa.session);
  }

  // Sessão perdida sem o usuário pedir: diga o porquê. Tela de entrada que
  // reaparece sozinha e muda é indistinguível de "cliquei e não aconteceu nada".
  const PORQUE_SAIU = { expirou: "Sua sessão expirou. Entre de novo." };

  // Sair devolve para a tela de entrada: sem conta, não há app.
  Supa.onChange((s, motivo) => {
    if (!s) {
      perfil = null;
      contaSincronizada = null;
      clearTimeout(agendado);
      if (dlg.open) dlg.close();
      abreTela("entrar");
      if (PORQUE_SAIU[motivo]) aviso(PORQUE_SAIU[motivo], "erro");
    } else if (Supa.user && contaSincronizada !== Supa.user.id) {
      // Entrar é o gatilho: é aqui que a estante da conta desce para este
      // navegador e o que estava só aqui sobe. Sem isto, "minha conta" seria
      // só um nome no cabeçalho.
      contaSincronizada = Supa.user.id;
      comecaSincronia();
    }
    pinta(s);
    pinta_pilula(situacao.estado);   // sem conta, a pílula some junto
  });

  // Fora da conta abre a tela de entrada; dentro, o painel da conta.
  $("accountBtn").addEventListener("click", async () => {
    if (!Supa.ready) return toast("Backend não configurado.");
    if (Supa.session) {
      dlg.showModal();
      pinta_sync(situacao.estado);
      if (!perfil) await carregaPerfil();
    } else {
      abreTela("entrar");
    }
  });
  $("authClose").addEventListener("click", () => dlg.close());

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
    } catch (err) {
      const m = err.message || "";
      // Conta não confirmada é beco sem saída: a senha está certa e o servidor
      // recusa assim mesmo. Só sai dali com outro e-mail de confirmação, então
      // o botão de reenviar aparece junto com a explicação.
      if (/Email not confirmed|email_not_confirmed/i.test(m)) {
        aviso("Sua conta ainda não foi confirmada. Abra o link que enviamos para " +
              email + " — sem isso o servidor recusa a senha, mesmo estando certa.", "erro");
        $("linhaReenviar").hidden = false;
        return;
      }
      aviso(m === "Invalid login credentials" ? "E-mail ou senha incorretos."
          : /Failed to fetch|NetworkError|load failed/i.test(m)
            ? "Não consegui falar com o servidor. Confira a conexão e tente de novo."
            : m || "Não consegui entrar, e o servidor não disse por quê.", "erro");
      return;
    }
    // Daqui para baixo o usuário JÁ está dentro. Nada aqui pode expulsá-lo.
    toast("Bem-vindo de volta.");
    carregaPerfil();
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

  $("btnReenviar").addEventListener("click", async () => {
    const btn = $("btnReenviar");
    const email = $("inEmail").value.trim();
    if (!emailValido(email)) return aviso("Digite seu e-mail no campo acima e clique de novo.", "erro");
    btn.disabled = true;
    aviso("Reenviando a confirmação para " + email + "…");
    try {
      await Supa.resendConfirmation(email);
      aviso(`Novo link enviado para ${email}. Procure também no spam e na lixeira — ` +
            `provedores como Hotmail e Outlook costumam segurar esse e-mail.`, "ok");
    } catch (err) {
      const m = err.message || "";
      aviso(/rate|limit|seconds/i.test(m)
        ? "O servidor de e-mail tem limite por hora. Espere alguns minutos e tente de novo."
        : "Não consegui reenviar: " + m, "erro");
    } finally { btn.disabled = false; }
  });

  $("btnEsqueci").addEventListener("click", async () => {
    const btn = $("btnEsqueci");
    const email = $("inEmail").value.trim();
    if (!emailValido(email)) return aviso("Digite seu e-mail no campo acima e clique de novo.", "erro");
    btn.disabled = true;
    aviso("Enviando o link para " + email + "…");     // feedback antes da ida ao servidor
    try {
      await Supa.resetPassword(email, location.origin + location.pathname);
      aviso(`Link enviado para ${email}. Confira a caixa de entrada e o spam — pode levar um minuto.`, "ok");
    } catch (err) {
      const m = err.message || "";
      aviso(/rate|limit|seconds/i.test(m)
        ? "Muitos pedidos seguidos. Espere alguns minutos e tente de novo."
        : "Não consegui enviar: " + m, "erro");
    } finally { btn.disabled = false; }
  });

  $("btnSair").addEventListener("click", async () => {
    // Última subida antes de sair: o que ficou nos 1,5s de espera ainda não
    // chegou ao servidor, e sair sem isso perderia a leitura recém-registrada.
    clearTimeout(agendado);
    if (contaPendentes()) { aviso("Salvando o que faltava…"); try { await sincroniza({ somenteSubida: true }); } catch (e) { } }
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

  /* A sincronia acontece sozinha; este botão é para quem quer ver acontecer
     agora — e para o caso de a conexão ter voltado antes do próximo ciclo. */
  $("btnSincronizar").addEventListener("click", async () => {
    const btn = $("btnSincronizar");
    btn.disabled = true;
    try { await sincroniza(); } finally { btn.disabled = false; }
  });

  /* Chegou de volta de um link de confirmação, recuperação ou OAuth. */
  const exigeEntrada = () => { if (!Supa.session) abreTela("entrar"); };

  (async () => {
    const r = await Supa.captureFromUrl();
    if (!r) {
      if (Supa.session) await carregaPerfil(); else exigeEntrada();
      return;
    }

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
