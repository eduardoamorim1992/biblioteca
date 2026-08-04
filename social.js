/* Descoberta de leitores: busca, ranking, perfil público e seguir.
 *
 * Nada aqui inventa tabela nem função no banco. O esquema já expunha tudo
 * pelo RLS — perfis públicos, estantes de perfis públicos, o grafo de
 * seguidores e as funções leaderboard() e reader_card(). O que faltava era
 * uma tela.
 *
 * Regra que governa o arquivo: a camada social é enfeite. Se o servidor não
 * responder, o app de leitura continua inteiro — nenhuma falha daqui pode
 * derrubar a estante, o cronômetro ou o registro de sessão. */
"use strict";

const Social = (() => {
  const $ = id => document.getElementById(id);

  let seguindo = new Set();       // ids que eu sigo, guardados para pintar botões
  let prontos = false;            // já carreguei a lista pelo menos uma vez?
  let ultimaBusca = 0;

  /* ---------------------------------------------------------------- peças */

  const inicial = p => ((p.display_name || p.username || "?").trim().charAt(0));

  function avatar(p) {
    return p.avatar_url
      ? `<div class="leitor-av"><img src="${esc(p.avatar_url)}" alt="" loading="lazy" onerror="this.remove()"></div>`
      : `<div class="leitor-av">${esc(inicial(p))}</div>`;
  }

  /** Botão de seguir. Sai da tela quando o leitor é você mesmo: seguir a si
      próprio é barrado pelo banco, e mostrar um botão que só dá erro é pior
      do que não mostrar nada. */
  function botaoSeguir(id) {
    if (!Supa.user || id === Supa.user.id) return "";
    const jaSigo = seguindo.has(id);
    return `<button class="btn sm ${jaSigo ? "" : "primary"}" data-seguir="${id}">${
      jaSigo ? "Seguindo" : "Seguir"}</button>`;
  }

  /** Uma linha de leitor, usada na busca, no ranking e na lista de quem lê
      o mesmo livro. Mesma forma nos três lugares, de propósito. */
  function linhaLeitor(p, { posicao = "", numero = "" } = {}) {
    const eu = Supa.user && p.id === Supa.user.id;
    return `
    <div class="leitor" data-eu="${eu ? 1 : 0}">
      ${posicao !== "" ? `<span class="leitor-pos">${posicao}</span>` : ""}
      ${avatar(p)}
      <button class="leitor-id" data-perfil="${esc(p.username)}"
              style="background:none;border:0;padding:0;text-align:left;cursor:pointer;color:inherit">
        <b>${esc(p.display_name || p.username)}</b>
        <span>@${esc(p.username)}</span>
      </button>
      ${numero ? `<span class="leitor-num">${numero}</span>` : ""}
      ${botaoSeguir(p.id)}
    </div>`;
  }

  const vazio = txt => `<div class="empty">${txt}</div>`;

  /* -------------------------------------------------------------- seguir */

  async function carregaSeguindo(forcar) {
    if (prontos && !forcar) return;
    try {
      seguindo = new Set(await Supa.following());
      prontos = true;
    } catch (e) {
      console.warn("não consegui carregar quem você segue:", e.message);
    }
  }

  async function alternaSeguir(id, botao) {
    const jaSigo = seguindo.has(id);
    botao.disabled = true;
    try {
      if (jaSigo) { await Supa.unfollow(id); seguindo.delete(id); }
      else { await Supa.follow(id); seguindo.add(id); }
      repinta();
      toast(jaSigo ? "Deixou de seguir." : "Agora você segue este leitor.");
    } catch (e) {
      // 23505 = já existe. Acontece com clique duplo ou com duas abas abertas;
      // o estado desejado já é o que está no banco, então não é erro para o usuário.
      if (e.code === "23505") { seguindo.add(id); repinta(); }
      else toast("Não consegui: " + e.message);
    } finally { botao.disabled = false; }
  }

  /** Repinta só os botões de seguir que já estão na tela, sem refazer pedido. */
  function repinta() {
    document.querySelectorAll("[data-seguir]").forEach(b => {
      const jaSigo = seguindo.has(b.dataset.seguir);
      b.textContent = jaSigo ? "Seguindo" : "Seguir";
      b.classList.toggle("primary", !jaSigo);
    });
  }

  /* -------------------------------------------------------------- busca */

  async function busca() {
    const termo = $("buscaLeitor").value.trim();
    const alvo = $("resultadoBusca");
    if (termo.length < 2) { alvo.innerHTML = ""; return; }

    const meu = ++ultimaBusca;                 // ignora resposta de busca velha
    try {
      const gente = await Supa.searchReaders(termo);
      if (meu !== ultimaBusca) return;
      alvo.innerHTML = gente.length
        ? gente.map(p => linhaLeitor(p)).join("")
        : vazio(`Ninguém encontrado para “${esc(termo)}”.`);
    } catch (e) {
      if (meu !== ultimaBusca) return;
      alvo.innerHTML = vazio("Não consegui buscar agora: " + esc(e.message));
    }
  }

  /* ------------------------------------------------------------- ranking */

  const rotuloMetrica = { pages: "págs", books: "livros", streak: "dias" };

  async function ranking() {
    const alvo = $("listaRanking");
    const periodo = $("rankPeriodo").value;
    const metrica = $("rankMetrica").value;
    alvo.innerHTML = vazio("Carregando…");
    try {
      const linhas = await Supa.leaderboard(periodo, metrica, 50);
      if (!linhas.length) { alvo.innerHTML = vazio("Ninguém no ranking ainda."); return; }
      alvo.innerHTML = linhas.map(r => linhaLeitor(
        { id: r.user_id, username: r.username, display_name: r.display_name, avatar_url: r.avatar_url },
        { posicao: r.rank + "º",
          numero: `${r[metrica === "books" ? "books" : metrica === "streak" ? "streak" : "pages"]} ${rotuloMetrica[metrica]}` }
      )).join("");
    } catch (e) {
      alvo.innerHTML = vazio("Não consegui carregar o ranking: " + esc(e.message));
    }
  }

  /* -------------------------------------------------------------- perfil */

  async function abrePerfil(username) {
    const dlg = $("perfilDlg");
    $("perfilTitulo").textContent = "@" + username;
    $("perfilCorpo").innerHTML = vazio("Carregando…");
    if (!dlg.open) dlg.showModal();

    let p;
    try {
      p = await Supa.profileByUsername(username);
    } catch (e) {
      $("perfilCorpo").innerHTML = vazio("Não consegui abrir este perfil: " + esc(e.message));
      return;
    }
    if (!p) {
      // reader_card() não devolve perfil privado — e é isso que o usuário
      // precisa ler, em vez de um erro técnico.
      $("perfilCorpo").innerHTML = vazio("Este leitor não existe ou mantém o perfil privado.");
      return;
    }

    $("perfilTitulo").textContent = p.display_name || "@" + p.username;
    const desde = new Date(p.member_since);
    $("perfilCorpo").innerHTML = `
      <div class="perfil-topo">
        ${avatar(p)}
        <div class="leitor-id">
          <b>${esc(p.display_name || p.username)}</b>
          <span>@${esc(p.username)} · ${p.followers} seg. · ${p.following} seguindo</span>
        </div>
        ${botaoSeguir(p.user_id)}
      </div>
      ${p.bio ? `<p class="perfil-bio">${esc(p.bio)}</p>` : ""}
      <div class="perfil-nums">
        <div class="perfil-num"><b>${p.pages_year}</b><span>páginas no ano</span></div>
        <div class="perfil-num"><b>${p.books_year}</b><span>livros no ano</span></div>
        <div class="perfil-num"><b>${p.streak}</b><span>dias seguidos</span></div>
      </div>
      <p class="dlg-note">Lendo por aqui desde ${desde.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}.</p>
      ${Supa.user && p.user_id === Supa.user.id
        ? `<div class="dlg-sep"></div>
           <button class="btn primary" id="btnCartao" style="width:100%">Compartilhar meu cartão</button>
           <p class="dlg-note" style="margin-top:8px">Gera uma imagem com seus números do ano e seu @.</p>`
        : ""}`;
  }

  /* ------------------------------------------------- quem lê o mesmo livro */

  /** Enriquece a estante com "quem mais está neste livro".
      Um pedido para a tela inteira; sem sessão ou sem ol_key, não faz nada. */
  async function enriquecerEstante() {
    if (!Supa.session) return;
    const cartoes = [...document.querySelectorAll(".book[data-ol]")].filter(c => c.dataset.ol);
    if (!cartoes.length) return;

    let linhas;
    try {
      linhas = await Supa.readersOfBooks(cartoes.map(c => c.dataset.ol));
    } catch (e) {
      console.warn("quem lê o mesmo livro:", e.message);
      return;                                  // estante já está na tela; some calado
    }

    const porLivro = new Map();
    for (const l of linhas) {
      if (!l.profiles) continue;               // perfil privado: o embed vem vazio
      if (!porLivro.has(l.ol_key)) porLivro.set(l.ol_key, []);
      const lista = porLivro.get(l.ol_key);
      if (!lista.some(x => x.username === l.profiles.username)) {
        lista.push({ id: l.owner, ...l.profiles });
      }
    }

    for (const cartao of cartoes) {
      const gente = porLivro.get(cartao.dataset.ol);
      if (!gente || !gente.length) continue;
      const alvo = cartao.querySelector(".book-foot");
      if (!alvo || alvo.parentElement.querySelector(".quem-le")) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quem-le";
      btn.textContent = gente.length === 1
        ? "1 leitor também tem este livro"
        : `${gente.length} leitores também têm este livro`;
      btn.addEventListener("click", () => mostraLeitoresDoLivro(cartao, gente));
      alvo.after(btn);
    }
  }

  function mostraLeitoresDoLivro(cartao, gente) {
    const dlg = $("perfilDlg");
    $("perfilTitulo").textContent = cartao.querySelector(".t").textContent;
    $("perfilCorpo").innerHTML =
      `<p class="dlg-note" style="margin-bottom:10px">Leitores públicos com este livro na estante.</p>` +
      gente.map(p => linhaLeitor(p)).join("");
    if (!dlg.open) dlg.showModal();
  }

  /* ---------------------------------------------------------------- feed
     O banco registra quem começou e quem terminou um livro desde o primeiro
     dia. Sem esta tela, seguir alguém não levava a lugar nenhum: você seguia,
     e nada acontecia. Um app onde seguir não significa nada não é uma rede —
     é uma lista de nomes. */

  let feedEscopo = "seguindo";
  let feedFim = false;          // já chegou ao fim da lista?
  let feedCarregando = false;
  let feedUltima = null;        // data do último fato, para paginar
  const comentariosAbertos = new Set();

  /** "agora", "há 3 h", "ontem", "12 de mar". Data cheia num feed é ruído:
      o que importa é se foi hoje ou faz tempo. */
  function quando(iso) {
    const t = Date.parse(iso);
    if (!t) return "";
    const min = Math.round((Date.now() - t) / 60000);
    if (min < 2) return "agora";
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h} h`;
    const d = Math.round(h / 24);
    if (d === 1) return "ontem";
    if (d < 7) return `há ${d} dias`;
    return new Date(t).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
  }

  const VERBO = {
    started:  f => `começou a ler <b>${esc(f.book_title || tituloDoPayload(f))}</b>`,
    finished: f => `terminou <b>${esc(f.book_title || tituloDoPayload(f))}</b>`,
    note:     f => f.note_kind === "quote"
                     ? `guardou uma citação${f.book_title ? ` de <b>${esc(f.book_title)}</b>` : ""}`
                     : `anotou algo${f.book_title ? ` sobre <b>${esc(f.book_title)}</b>` : ""}`,
    progress: f => `avançou em <b>${esc(f.book_title || tituloDoPayload(f))}</b>`,
    review:   f => `avaliou <b>${esc(f.book_title || tituloDoPayload(f))}</b>`
  };

  /* A nota vem da linha do livro; se o livro foi apagado, sobra a que viajou
     no payload no momento da publicação. */
  const notaDoFato = f => f.book_rating || (f.payload && f.payload.rating) || 0;

  function estrelasFeed(n) {
    if (!n) return "";
    return `<span class="nota" title="${n} de 5">${"★".repeat(n)}<span class="vazia">${"★".repeat(5 - n)}</span></span>`;
  }

  // O livro pode ter sido apagado depois; o título viajou junto na atividade
  // justamente para o fato não virar "terminou de ler (nada)".
  const tituloDoPayload = f => (f.payload && f.payload.title) || "um livro";

  function capa(f) {
    if (f.book_cover) return `<div class="thumb"><img src="${esc(f.book_cover)}" alt="" loading="lazy" onerror="this.remove()"></div>`;
    const t = (f.book_title || tituloDoPayload(f)).trim().charAt(0);
    return `<div class="thumb" style="background:var(--accent)"><span>${esc(t)}</span></div>`;
  }

  function fato(f) {
    const autor = { id: f.owner, username: f.username, display_name: f.display_name, avatar_url: f.avatar_url };
    const temLivro = f.kind !== "note" && (f.book_title || f.payload);
    const abertos = comentariosAbertos.has(f.id);
    return `
    <article class="fato" data-fato="${f.id}">
      <div class="fato-topo">
        ${avatar(autor)}
        <div class="fato-quem">
          <b data-perfil="${esc(f.username)}">${esc(f.display_name || f.username)}</b>
          <span class="fato-quando">@${esc(f.username)} · ${quando(f.created_at)}</span>
        </div>
        ${botaoSeguir(f.owner)}
      </div>

      <p class="fato-verbo">${(VERBO[f.kind] || (() => "fez algo"))(f)}</p>

      ${temLivro ? `
        <div class="fato-livro">
          ${capa(f)}
          <div style="min-width:0">
            <div class="t">${esc(f.book_title || tituloDoPayload(f))}</div>
            <div class="a">${esc(f.book_author || (f.payload && f.payload.author) || "")}${
              f.book_pages ? ` · ${f.book_pages} págs` : ""}</div>
            ${estrelasFeed(notaDoFato(f))}
          </div>
        </div>` : ""}

      ${f.kind === "review" && f.book_review
        ? `<div class="fato-resenha">${esc(f.book_review)}</div>` : ""}

      ${f.note_body ? `
        <div class="fato-citacao ${f.note_kind === "quote" ? "quote" : ""}">${esc(f.note_body)}${
          f.note_page ? `<span class="fato-quando"> — pág. ${f.note_page}</span>` : ""}</div>` : ""}

      <div class="fato-acoes">
        <button class="acao" data-curtir="${f.id}" data-ativo="${f.eu_curti ? 1 : 0}"
                aria-label="Curtir">${f.eu_curti ? "♥" : "♡"} <span class="n">${f.curtidas || ""}</span></button>
        <button class="acao" data-coments="${f.id}">💬 <span class="n">${f.comentarios || ""}</span></button>
        ${Supa.user && f.owner === Supa.user.id ? "" :
          `<button class="acao" data-denunciar="${f.id}" title="Denunciar">⚑</button>`}
      </div>

      <div class="coments" data-lista="${f.id}" ${abertos ? "" : "hidden"}></div>
    </article>`;
  }

  async function carregaFeed({ mais = false } = {}) {
    const alvo = $("feedLista");
    if (!Supa.user) { alvo.innerHTML = vazio("Entre na sua conta para ver o feed."); return; }
    if (feedCarregando) return;
    feedCarregando = true;
    if (!mais) { feedFim = false; feedUltima = null; alvo.innerHTML = vazio("Carregando…"); }

    try {
      const linhas = await Supa.feed(feedEscopo, 20, mais ? feedUltima : null);
      if (!mais) alvo.innerHTML = "";
      if (linhas.length) {
        feedUltima = linhas[linhas.length - 1].created_at;
        alvo.insertAdjacentHTML("beforeend", `<div class="feed">${linhas.map(fato).join("")}</div>`);
        // Um feed com vários blocos vira várias listas; junta tudo numa só.
        const blocos = alvo.querySelectorAll(".feed");
        if (blocos.length > 1) {
          const primeiro = blocos[0];
          for (let i = 1; i < blocos.length; i++) { primeiro.append(...blocos[i].children); blocos[i].remove(); }
        }
      }
      feedFim = linhas.length < 20;
      $("feedMais").hidden = feedFim || !alvo.querySelector(".fato");

      if (!alvo.querySelector(".fato")) {
        alvo.innerHTML = feedEscopo === "seguindo"
          ? vazio("Você ainda não segue ninguém — ou quem você segue não registrou nada. " +
                  "Toque em <b>Todos</b> aqui em cima para ver a praça inteira.")
          : vazio("Ninguém publicou nada ainda. Termine um livro e o seu será o primeiro.");
      }
      repinta();
    } catch (e) {
      // PGRST202 = função não existe: o SQL do feed ainda não foi aplicado no
      // banco. Dizer isso é mais útil do que "erro 404".
      alvo.innerHTML = vazio(/PGRST202|Could not find the function/i.test(e.message || "")
        ? "O feed ainda não foi ligado neste banco. Rode <b>supabase/feed.sql</b> no SQL Editor do Supabase."
        : "Não consegui carregar o feed: " + esc(e.message));
      $("feedMais").hidden = true;
    } finally { feedCarregando = false; }
  }

  /** Curtir é a interação mais barata que existe, então ela não pode esperar
      o servidor: pinta na hora e desfaz se o servidor recusar. */
  async function alternaCurtida(id, botao) {
    const curtido = botao.dataset.ativo === "1";
    const n = botao.querySelector(".n");
    const antes = +n.textContent || 0;
    const pinta = (ativo, valor) => {
      botao.dataset.ativo = ativo ? "1" : "0";
      botao.firstChild.textContent = ativo ? "♥ " : "♡ ";
      n.textContent = valor || "";
    };
    pinta(!curtido, curtido ? antes - 1 : antes + 1);
    try {
      if (curtido) await Supa.descurtir(id); else await Supa.curtir(id);
    } catch (e) {
      if (e.code === "23505") return;            // já estava curtido: estado certo
      pinta(curtido, antes);
      toast("Não consegui: " + e.message);
    }
  }

  async function alternaComentarios(id) {
    const caixa = document.querySelector(`[data-lista="${id}"]`);
    if (!caixa) return;
    if (comentariosAbertos.has(id)) {
      comentariosAbertos.delete(id);
      caixa.hidden = true;
      return;
    }
    comentariosAbertos.add(id);
    caixa.hidden = false;
    caixa.innerHTML = `<p class="dlg-note">Carregando…</p>`;
    try {
      const linhas = await Supa.comentarios(id);
      caixa.innerHTML = linhas.map(c => comentario(c)).join("") + formularioComentario(id);
    } catch (e) {
      caixa.innerHTML = `<p class="dlg-note">Não consegui carregar: ${esc(e.message)}</p>` + formularioComentario(id);
    }
  }

  function comentario(c) {
    const p = c.profiles || {};
    const meu = Supa.user && c.author === Supa.user.id;
    return `
    <div class="coment" data-coment="${c.id}">
      ${avatar(p)}
      <div class="coment-corpo">
        <span class="quem" data-perfil="${esc(p.username || "")}">${esc(p.display_name || p.username || "alguém")}</span>
        <span class="quando">${quando(c.created_at)}</span>
        <div class="txt">${esc(c.body)}</div>
        <div class="coment-acoes">
          ${meu ? `<button data-apagar-coment="${c.id}">apagar</button>`
                : `<button data-denunciar-coment="${c.id}">denunciar</button>`}
        </div>
      </div>
    </div>`;
  }

  const formularioComentario = id => `
    <form class="coment-form" data-comentar="${id}">
      <textarea placeholder="Responder…" maxlength="1000" required></textarea>
      <button class="btn sm primary" type="submit">Enviar</button>
    </form>`;

  async function enviaComentario(form) {
    const id = form.dataset.comentar;
    const campo = form.querySelector("textarea");
    const texto = campo.value.trim();
    if (!texto) return;
    const botao = form.querySelector("button");
    botao.disabled = true;
    try {
      const [novo] = await Supa.comentar(id, texto);
      campo.value = "";
      form.insertAdjacentHTML("beforebegin", comentario({
        ...novo,
        profiles: { username: (perfilLocal() || {}).username, display_name: (perfilLocal() || {}).display_name, avatar_url: (perfilLocal() || {}).avatar_url }
      }));
      const contador = document.querySelector(`[data-coments="${id}"] .n`);
      if (contador) contador.textContent = (+contador.textContent || 0) + 1;
    } catch (e) {
      toast("Não consegui comentar: " + e.message);
    } finally { botao.disabled = false; }
  }

  // O perfil de quem está logado, para o comentário recém-enviado aparecer com
  // nome e avatar sem precisar recarregar a lista inteira.
  let meuPerfil = null;
  const perfilLocal = () => meuPerfil;

  async function apagaComentario(id) {
    if (!confirm("Apagar seu comentário?")) return;
    try {
      await Supa.apagarComentario(id);
      const el = document.querySelector(`[data-coment="${id}"]`);
      const fatoEl = el && el.closest(".fato");
      el && el.remove();
      const contador = fatoEl && fatoEl.querySelector("[data-coments] .n");
      if (contador) contador.textContent = Math.max(0, (+contador.textContent || 1) - 1) || "";
    } catch (e) { toast("Não consegui apagar: " + e.message); }
  }

  async function denuncia({ comentario = null, atividade = null }) {
    const motivo = prompt("O que há de errado aqui? (isso vai para quem modera)");
    if (!motivo || !motivo.trim()) return;
    try {
      await Supa.denunciar({ comentario, atividade, motivo: motivo.trim().slice(0, 500) });
      toast("Denúncia enviada. Obrigado por avisar.");
    } catch (e) { toast("Não consegui enviar: " + e.message); }
  }

  /* -------------------------------------------------- notificações
     Sem isto, seguir, curtir e comentar não voltavam para ninguém: a
     interação acontecia e o outro lado nunca ficava sabendo. */

  let naoLidas = 0;

  function pintaSino() {
    const btn = $("sinoBtn"), n = $("sinoN");
    if (!btn) return;
    btn.hidden = !Supa.user;
    n.hidden = !naoLidas;
    n.textContent = naoLidas > 9 ? "9+" : String(naoLidas);
    // "notificação" faz plural em -ões, não em -s: grudar um "s" no fim gera
    // "notificaçãos". Palavra de plural irregular se escreve por extenso.
    btn.title = !naoLidas ? "Notificações"
      : naoLidas === 1 ? "1 notificação não lida"
      : `${naoLidas} notificações não lidas`;
  }

  async function contaNaoLidas() {
    if (!Supa.user) { naoLidas = 0; pintaSino(); return; }
    try {
      naoLidas = (await Supa.naoLidas()) || 0;
    } catch (e) {
      // Função ainda não aplicada no banco, ou rede fora: sino sem número é
      // melhor do que erro na cara de quem só queria ler.
      naoLidas = 0;
      console.warn("não lidas:", e.message);
    }
    pintaSino();
  }

  const VERBO_NOTIF = {
    follow:  () => "começou a seguir você",
    like:    n => `curtiu ${sobreOQue(n)}`,
    comment: n => `comentou ${sobreOQue(n)}`
  };

  // "seu registro de Torto Arado" lê melhor do que "sua atividade #4f2a".
  function sobreOQue(n) {
    if (n.book_title) {
      const q = n.activity_kind === "review" ? "sua resenha de"
              : n.activity_kind === "finished" ? "quando você terminou"
              : n.activity_kind === "started" ? "quando você começou"
              : "seu registro de";
      return `${q} <b>${esc(n.book_title)}</b>`;
    }
    return "algo que você publicou";
  }

  function linhaNotif(n) {
    const p = { username: n.username, display_name: n.display_name, avatar_url: n.avatar_url };
    return `
    <div class="notif" data-nova="${n.read_at ? 0 : 1}">
      ${avatar(p)}
      <div class="notif-corpo">
        <b data-perfil="${esc(n.username)}">${esc(n.display_name || n.username)}</b>
        ${(VERBO_NOTIF[n.kind] || (() => "interagiu"))(n)}
        ${n.comment_body ? `<div class="notif-citacao">“${esc(n.comment_body)}”</div>` : ""}
        <span class="notif-quando">${quando(n.created_at)}</span>
      </div>
    </div>`;
  }

  async function abreNotificacoes() {
    const dlg = $("notifDlg"), corpo = $("notifCorpo");
    corpo.innerHTML = vazio("Carregando…");
    if (!dlg.open) dlg.showModal();
    try {
      const linhas = await Supa.notificacoes(30);
      corpo.innerHTML = linhas.length
        ? linhas.map(linhaNotif).join("")
        : vazio("Nada por aqui ainda. Quando alguém seguir você, curtir ou " +
                "comentar o que você registrou, aparece nesta caixa.");
      // Marcar como lida só depois de mostrar: se o pedido falhar, o número
      // continua lá, que é o certo — some quando de fato foi visto e gravado.
      if (linhas.some(l => !l.read_at)) {
        try { await Supa.marcarLidas(); naoLidas = 0; pintaSino(); } catch (e) { console.warn(e); }
      }
    } catch (e) {
      corpo.innerHTML = vazio(/PGRST202|Could not find the function/i.test(e.message || "")
        ? "As notificações ainda não foram ligadas neste banco. Rode <b>supabase/notificacoes.sql</b> no SQL Editor do Supabase."
        : "Não consegui carregar: " + esc(e.message));
    }
  }

  /* -------------------------------------------------------------- cartão */

  /** Desenha o cartão do ano numa imagem. É o que sai do app para o mundo:
      com poucos leitores dentro, compartilhar para fora é o único jeito de
      alguém chegar aqui. */
  async function cartao() {
    let p;
    try {
      p = await Supa.profileByUsername((await Supa.myProfile()).username);
    } catch (e) { return toast("Não consegui montar o cartão: " + e.message); }
    if (!p) return toast("Deixe seu perfil público para gerar o cartão.");

    const W = 1080, H = 1350, c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");

    const fundo = g.createLinearGradient(0, 0, W, H);
    fundo.addColorStop(0, "#3987e5");
    fundo.addColorStop(.45, "#2a78d6");
    fundo.addColorStop(1, "#1c5cab");
    g.fillStyle = fundo; g.fillRect(0, 0, W, H);

    g.fillStyle = "rgba(255,255,255,.07)";
    g.beginPath(); g.arc(W - 60, H - 90, 340, 0, Math.PI * 2); g.fill();

    const fonte = (px, peso = 400) => `${peso} ${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;

    g.fillStyle = "rgba(255,255,255,.75)";
    g.font = fonte(30, 600);
    g.fillText("BIBLIOTECA", 90, 140);

    g.fillStyle = "#fff";
    g.font = fonte(76, 700);
    g.fillText(recorta(g, p.display_name || p.username, W - 180, 76, 700), 90, 300);

    g.fillStyle = "rgba(255,255,255,.8)";
    g.font = fonte(38, 500);
    g.fillText("@" + p.username, 90, 362);

    const nums = [
      [p.pages_year, "páginas no ano"],
      [p.books_year, p.books_year === 1 ? "livro no ano" : "livros no ano"],
      [p.streak, p.streak === 1 ? "dia seguido" : "dias seguidos"]
    ];
    let y = 520;
    for (const [valor, rotulo] of nums) {
      g.fillStyle = "#fff";
      g.font = fonte(118, 700);
      g.fillText(String(valor), 90, y);
      g.fillStyle = "rgba(255,255,255,.78)";
      g.font = fonte(34, 500);
      g.fillText(rotulo, 92, y + 52);
      y += 210;
    }

    g.fillStyle = "rgba(255,255,255,.7)";
    g.font = fonte(30, 500);
    g.fillText(location.host, 90, H - 90);

    // JPEG, não PNG: o mesmo cartão sai com um décimo do peso, e num fundo de
    // degradê com texto grande a diferença não aparece. Quem compartilha por
    // dados móveis agradece.
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.92));
    const arquivo = new File([blob], `biblioteca-${p.username}.jpg`, { type: "image/jpeg" });

    // Web Share leva direto para o WhatsApp e o Instagram no celular; onde ela
    // não existe, o download resolve. Sem alarde de qual dos dois aconteceu.
    if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
      try { await navigator.share({ files: [arquivo], title: "Minha leitura no ano" }); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = arquivo.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("Cartão salvo nos downloads.");
  }

  /** Encolhe o texto até caber, para um nome comprido não vazar da imagem. */
  function recorta(g, texto, largura, px, peso) {
    let t = texto || "";
    g.font = `${peso} ${px}px ui-sans-serif, system-ui, sans-serif`;
    while (t.length > 3 && g.measureText(t).width > largura) t = t.slice(0, -1);
    return t === texto ? t : t.trimEnd() + "…";
  }

  /* -------------------------------------------------------------- ligação */

  let debounce;
  $("buscaLeitor").addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(busca, 300);         // uma ida por pausa de digitação
  });
  $("rankPeriodo").addEventListener("change", ranking);
  $("rankMetrica").addEventListener("change", ranking);
  $("perfilClose").addEventListener("click", () => $("perfilDlg").close());
  $("sinoBtn").addEventListener("click", abreNotificacoes);
  $("notifClose").addEventListener("click", () => $("notifDlg").close());

  /* Voltar para a aba é quando a novidade pode ter chegado — e é de graça,
     porque quem está com o app fechado não gasta requisição. O intervalo
     longo cobre quem deixa aberto o dia inteiro. */
  document.addEventListener("visibilitychange", () => { if (!document.hidden) contaNaoLidas(); });
  setInterval(() => { if (!document.hidden && Supa.user) contaNaoLidas(); }, 3 * 60 * 1000);

  // Delegação: as linhas de leitor nascem e morrem o tempo todo, em três
  // lugares diferentes. Ouvir no documento evita religar ouvinte a cada render.
  document.addEventListener("click", e => {
    const seguir = e.target.closest("[data-seguir]");
    if (seguir) return alternaSeguir(seguir.dataset.seguir, seguir);

    const curtir = e.target.closest("[data-curtir]");
    if (curtir) return alternaCurtida(curtir.dataset.curtir, curtir);

    const coments = e.target.closest("[data-coments]");
    if (coments) return alternaComentarios(coments.dataset.coments);

    const apagar = e.target.closest("[data-apagar-coment]");
    if (apagar) return apagaComentario(apagar.dataset.apagarComent);

    const denCom = e.target.closest("[data-denunciar-coment]");
    if (denCom) return denuncia({ comentario: denCom.dataset.denunciarComent });

    const denAtv = e.target.closest("[data-denunciar]");
    if (denAtv) return denuncia({ atividade: denAtv.dataset.denunciar });

    const escopo = e.target.closest("[data-escopo]");
    if (escopo) {
      feedEscopo = escopo.dataset.escopo;
      document.querySelectorAll("#feedEscopo .seg-b").forEach(b => {
        const on = b === escopo;
        b.classList.toggle("on", on);
        b.setAttribute("aria-selected", String(on));
      });
      comentariosAbertos.clear();
      return carregaFeed();
    }

    if (e.target.closest("#feedMais")) return carregaFeed({ mais: true });

    // Perfil por último: o nome do autor também é clicável dentro do fato, e
    // as ações acima estão aninhadas nele.
    const perfil = e.target.closest("[data-perfil]");
    if (perfil && perfil.dataset.perfil) return abrePerfil(perfil.dataset.perfil);
    if (e.target.closest("#btnCartao")) return cartao();
  });

  document.addEventListener("submit", e => {
    const form = e.target.closest("[data-comentar]");
    if (!form) return;
    e.preventDefault();
    enviaComentario(form);
  });

  // A aba Leitores só busca quando é aberta: ranking de quem nunca clicou ali
  // é requisição jogada fora.
  let rankingCarregado = false;
  let feedVisto = 0;
  document.querySelector('.tab[data-view="leitores"]').addEventListener("click", async () => {
    await carregaSeguindo();
    if (!rankingCarregado) { rankingCarregado = true; ranking(); }
    // Feed velho é pior do que feed vazio: quem volta à aba espera novidade.
    // Um minuto de tolerância evita repetir o pedido em cliques seguidos.
    if (Date.now() - feedVisto > 60000) { feedVisto = Date.now(); carregaFeed(); }
  });

  /* Entrou (ou saiu): a lista de quem eu sigo pertence à sessão. */
  Supa.onChange(async s => {
    seguindo = new Set();
    prontos = false;
    rankingCarregado = false;
    meuPerfil = null;
    comentariosAbertos.clear();
    naoLidas = 0;
    pintaSino();                 // sem conta, o sino some junto
    if (!s) return;
    await carregaSeguindo(true);
    repinta();
    contaNaoLidas();
    // Guardado uma vez: é o que faz o comentário recém-enviado aparecer com
    // nome e rosto, sem recarregar a conversa inteira.
    Supa.myProfile().then(p => { meuPerfil = p; }).catch(() => {});
    // Link direto para um perfil: ?u=fulano. É assim que alguém de fora chega.
    const u = new URLSearchParams(location.search).get("u");
    if (u) {
      history.replaceState(null, "", location.pathname);
      abrePerfil(u.replace(/^@/, ""));
    }
  });

  /* O diálogo de resenha pergunta isto para avisar que resenha de perfil
     privado não vira notícia nem entra em média. Vem do perfil já carregado;
     sem ele, assume público, que é o padrão do cadastro. */
  const souPrivado = () => !!(meuPerfil && meuPerfil.is_private);

  return { enriquecerEstante, abrePerfil, ranking, souPrivado };
})();
