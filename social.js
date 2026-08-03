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

  // Delegação: as linhas de leitor nascem e morrem o tempo todo, em três
  // lugares diferentes. Ouvir no documento evita religar ouvinte a cada render.
  document.addEventListener("click", e => {
    const seguir = e.target.closest("[data-seguir]");
    if (seguir) return alternaSeguir(seguir.dataset.seguir, seguir);
    const perfil = e.target.closest("[data-perfil]");
    if (perfil) return abrePerfil(perfil.dataset.perfil);
    if (e.target.closest("#btnCartao")) return cartao();
  });

  // A aba Leitores só busca quando é aberta: ranking de quem nunca clicou ali
  // é requisição jogada fora.
  let rankingCarregado = false;
  document.querySelector('.tab[data-view="leitores"]').addEventListener("click", async () => {
    await carregaSeguindo();
    if (!rankingCarregado) { rankingCarregado = true; ranking(); }
  });

  /* Entrou (ou saiu): a lista de quem eu sigo pertence à sessão. */
  Supa.onChange(async s => {
    seguindo = new Set();
    prontos = false;
    rankingCarregado = false;
    if (!s) return;
    await carregaSeguindo(true);
    repinta();
    // Link direto para um perfil: ?u=fulano. É assim que alguém de fora chega.
    const u = new URLSearchParams(location.search).get("u");
    if (u) {
      history.replaceState(null, "", location.pathname);
      abrePerfil(u.replace(/^@/, ""));
    }
  });

  return { enriquecerEstante, abrePerfil, ranking };
})();
