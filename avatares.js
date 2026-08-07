/* Conquistas e avatares.
 *
 * O app media leitura e não devolvia nada por ela. Ranking devolve posição,
 * que é comparação com os outros; conquista devolve marca, que é comparação
 * com você mesmo de ontem — e é a única das duas que funciona para quem está
 * em último lugar.
 *
 * Três decisões que explicam o resto do arquivo:
 *
 * 1. O avatar é desenhado aqui, não hospedado. Nada de upload, nada de CDN:
 *    o app promete abrir offline e não tem servidor de arquivo. Cada avatar é
 *    um SVG de duas linhas escrito à mão, então trocar de avatar não custa
 *    byte nenhum de rede e o rosto aparece igual no celular de quem te segue.
 *
 * 2. A régua é o que o banco já sabia. Páginas, minutos, livros, sequência,
 *    anotações, notas dadas, gente seguida — nenhuma coluna nova, nenhum
 *    contador paralelo para desincronizar. Conquista é leitura da mesma
 *    verdade, sob outro ângulo.
 *
 * 3. A conta guarda `av:<id>`, não a imagem. É curto, viaja em qualquer
 *    consulta que já traz avatar_url, e deixa o desenho evoluir sem migração.
 *
 * Quem confere de verdade é o banco (supabase/conquistas.sql): a chave anônima
 * está no navegador de todo mundo, e conquista que o próprio cliente carimba
 * não é conquista — é campo de texto. Aqui é a tela; lá é a regra. */
"use strict";

const Avatares = (() => {
  const $ = id => document.getElementById(id);

  /* A placa é escura nos dois temas, pelo mesmo motivo da capa do livro: o
     avatar é objeto, não interface. Traço claro por cima, tons saídos da
     rampa do sistema — nenhum hex inventado. */
  const TOM = { 1: "#292b31", 2: "#2b2741", 3: "#423a6a", 4: "#5d5294", 5: "#796cbf" };
  const TRACO = "#f5f4ff";

  /* Cada linha aqui tem gêmea em supabase/conquistas.sql. Acrescentar avatar
     sem acrescentar lá dá erro na cara de quem tentar usá-lo — de propósito,
     porque o silêncio seria pior: um avatar que some ao recarregar. */
  const CATALOGO = [
    { id: "leitor",   nome: "Leitor",    tom: 2, livre: true,
      como: "seu desde o primeiro dia",
      glifo: `<path d="M20 14.6c-2.2-1.7-5-2.6-8-2.6v14c3 0 5.8.9 8 2.6 2.2-1.7 5-2.6 8-2.6V12c-3 0-5.8.9-8 2.6Z"/>
              <path d="M20 14.6v13.4"/>` },

    { id: "marcador", nome: "Marcador",  tom: 1, livre: true,
      como: "seu desde o primeiro dia",
      glifo: `<path d="M13.5 11.5h13V29l-6.5-5.3L13.5 29z"/>` },

    { id: "pilha",    nome: "Pilha",     tom: 3, livre: true,
      como: "seu desde o primeiro dia",
      glifo: `<rect x="10.5" y="23.5" width="19" height="5.5" rx="1.6"/>
              <rect x="12.8" y="17.8" width="14.4" height="5.5" rx="1.6"/>
              <rect x="15" y="12" width="10" height="5.5" rx="1.6"/>` },

    { id: "chama",    nome: "Chama",     tom: 4, medida: "streak", meta: 7,
      como: "7 dias seguidos de leitura",
      glifo: `<path d="M20 10.5c4.2 4.3 6.6 7.5 6.6 11.2a6.6 6.6 0 0 1-13.2 0c0-2 .9-3.8 2.5-5.5.5 1.4 1.4 2.3 2.5 2.7-.6-3.1.3-5.8 1.6-8.4Z"/>` },

    { id: "lua",      nome: "Lua",       tom: 2, medida: "streak", meta: 30,
      como: "30 dias seguidos de leitura",
      glifo: `<path d="M24.4 10.6a10 10 0 1 0 5.2 15.1 11.2 11.2 0 0 1-5.2-15.1Z"/>` },

    { id: "ampulheta", nome: "Ampulheta", tom: 1, medida: "minutos", meta: 600,
      como: "10 horas de leitura registradas",
      glifo: `<path d="M14 11h12M14 29h12"/>
              <path d="M15.6 11c0 4 4.4 6 4.4 9s-4.4 5-4.4 9M24.4 11c0 4-4.4 6-4.4 9s4.4 5 4.4 9"/>` },

    { id: "lampiao",  nome: "Lampião",   tom: 5, medida: "minutos", meta: 3000,
      como: "50 horas de leitura registradas",
      glifo: `<path d="M20 9.5v3"/>
              <path d="M14.5 26.5 17 14h6l2.5 12.5z"/>
              <path d="M12.8 26.5h14.4M17.6 29.5h4.8"/>` },

    { id: "mil",      nome: "Mil",       tom: 3, medida: "paginas", meta: 1000,
      como: "1.000 páginas lidas",
      glifo: `<path d="M14 10.5h7.6l5.4 5.4V29.5H14z"/>
              <path d="M21.6 10.5v5.4H27"/>
              <path d="M17.4 21h6.2M17.4 25h4.2"/>` },

    { id: "dezmil",   nome: "Dez mil",   tom: 4, medida: "paginas", meta: 10000,
      como: "10.000 páginas lidas",
      glifo: `<path d="M9 28.5l7.6-11.4 4 5.6 3.6-4.8L31 28.5z"/>
              <path d="M9 28.5h22"/>` },

    { id: "torre",    nome: "Torre",     tom: 2, medida: "livros", meta: 5,
      como: "5 livros concluídos",
      glifo: `<rect x="11" y="12" width="4.4" height="16" rx="1.2"/>
              <rect x="16.6" y="12" width="4.4" height="16" rx="1.2"/>
              <path d="M24.9 13.3l4.3 1.1-3.5 15.5-4.3-1.1z"/>` },

    { id: "coluna",   nome: "Coluna",    tom: 5, medida: "livros", meta: 25,
      como: "25 livros concluídos",
      glifo: `<path d="M12.5 11.5h15M12.5 28.5h15"/>
              <path d="M16 11.5v17M20 11.5v17M24 11.5v17"/>` },

    { id: "pena",     nome: "Pena",      tom: 1, medida: "notas", meta: 10,
      como: "10 anotações escritas",
      glifo: `<path d="M28.6 11.4C20.2 12 14.2 17.1 12.4 25.8l1.9 1.9c8.8-1.9 14-7.8 14.3-16.3Z"/>
              <path d="M11 29.5l7.6-7.6"/>` },

    { id: "aspas",    nome: "Aspas",     tom: 3, medida: "citacoes", meta: 25,
      como: "25 citações guardadas",
      glifo: `<path d="M18.4 12.8c-4 1.8-6.4 4.8-6.4 8.6v6.6h6.9v-7.3h-3.3c.2-2.5 1.4-4.2 3.6-5.1z" fill="${TRACO}" stroke="none"/>
              <path d="M29.4 12.8c-4 1.8-6.4 4.8-6.4 8.6v6.6h6.9v-7.3h-3.3c.2-2.5 1.4-4.2 3.6-5.1z" fill="${TRACO}" stroke="none"/>` },

    { id: "estrela",  nome: "Estrela",   tom: 5, medida: "avaliados", meta: 5,
      como: "5 livros avaliados com nota",
      glifo: `<path d="M20 10.6l3.1 6.4 7 1-5.1 4.9 1.2 7-6.2-3.3-6.2 3.3 1.2-7-5.1-4.9 7-1z"/>` },

    { id: "elo",      nome: "Elo",       tom: 4, medida: "seguindo", meta: 5,
      como: "seguir 5 leitores",
      glifo: `<circle cx="16.4" cy="20" r="6.2"/><circle cx="23.6" cy="20" r="6.2"/>` },

    /* A meta deste é a que a pessoa escolheu — por isso vem de fora, e por
       isso ele fica cinza com um convite em vez de um número quando ninguém
       escolheu nada. */
    { id: "coroa",    nome: "Coroa",     tom: 5, medida: "desafio", meta: nums => nums.desafioMeta,
      como: "bater o desafio do ano",
      glifo: `<path d="M11.4 25.4L9.8 13.8l6.1 4.6L20 11l4.1 7.4 6.1-4.6-1.6 11.6z"/>
              <path d="M11.4 28.6h17.2"/>` }
  ];

  const PORID = new Map(CATALOGO.map(a => [a.id, a]));
  const PREFIXO = "av:";
  const chaveDe = id => PREFIXO + id;
  const idDaChave = url =>
    typeof url === "string" && url.slice(0, 3) === PREFIXO ? url.slice(3) : null;

  /* ------------------------------------------------------------- desenho */

  /** SVG do avatar, ou "" se a chave não for de avatar deste catálogo —
      é o que deixa quem chama decidir entre desenho, foto e inicial.

      Com `px`, sai medido e autônomo: dentro da página o tamanho vem do CSS,
      mas como imagem o SVG precisa de medida própria e do xmlns, senão o
      navegador não sabe em que escala rasterizar. Todas as cores são hex
      literal justamente por isso — variável de CSS não atravessa a fronteira
      da imagem, e o avatar sairia sem cor nenhuma. */
  function svg(avatarUrl, px) {
    const a = PORID.get(idDaChave(avatarUrl));
    if (!a) return "";
    const medida = px ? ` width="${px}" height="${px}"` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" class="av-svg" viewBox="0 0 40 40"${medida} aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill="${TOM[a.tom]}"/>
      <g fill="none" stroke="${TRACO}" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round">${a.glifo}</g>
    </svg>`;
  }

  /** O avatar como imagem pronta para canvas, ou null se não houver desenho.

      Vai por data URI, não por rede: o cartão tem que sair com o app offline.
      E data URI de SVG sem referência externa não suja o canvas — o que
      importa porque canvas sujo faz toBlob() estourar, e aí não é o rosto que
      some do cartão, é o cartão inteiro. */
  function paraImagem(avatarUrl, px = 132) {
    const marcacao = svg(avatarUrl, px);
    if (!marcacao) return Promise.resolve(null);
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);     // cartão sem rosto > cartão nenhum
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(marcacao);
    });
  }

  const nomeDe = avatarUrl => (PORID.get(idDaChave(avatarUrl)) || {}).nome || null;

  /** A fileira de conquistas de alguém, para o perfil de quem se visita.
      Só o que a pessoa ganhou — quem visita não precisa da lista de tarefas
      alheia, e mostrar o que falta ao outro é apontar, não informar.

      A ordem sai daqui, não da resposta do servidor: a fileira tem que ficar
      igual em todos os perfis, senão comparar dois vira caça ao tesouro. */
  function fila(ids) {
    const tem = new Set(ids || []);
    const meus = CATALOGO.filter(a => tem.has(a.id));
    if (!meus.length) return "";
    return `
      <div class="obra-secao">Conquistas · ${meus.length} de ${CATALOGO.length}</div>
      <div class="conq-fila">${meus.map(a =>
        `<span class="conq" title="${esc(a.nome + " — " + a.como)}">${svg(chaveDe(a.id))}</span>`
      ).join("")}</div>`;
  }

  /* -------------------------------------------------------------- régua
     Tudo daqui sai do estado local, não do servidor: o número tem que
     aparecer com o app offline e mudar no mesmo instante em que a pessoa
     registra a leitura. O servidor confere de novo na hora de gravar. */

  function numeros() {
    if (typeof state === "undefined") return null;
    const soma = (arr, f) => arr.reduce((t, x) => t + (f(x) || 0), 0);
    const perfil = window.MEU_PERFIL || {};
    return {
      streak:    typeof bestStreak === "function" ? bestStreak() : 0,
      minutos:   soma(state.sessions, s => s.minutes),
      paginas:   soma(state.sessions, s => s.pages),
      livros:    state.books.filter(b => b.status === "lido").length,
      avaliados: state.books.filter(b => b.rating).length,
      notas:     state.notes.length,
      citacoes:  state.notes.filter(n => n.type === "quote").length,
      seguindo:  (typeof Social !== "undefined" && Social.quantosSigo) ? Social.quantosSigo() : 0,
      desafio:   typeof livrosLidosNoAno === "function" ? livrosLidosNoAno() : 0,
      desafioMeta: perfil.goal_books || 0
    };
  }

  const metaDe = (a, nums) => (typeof a.meta === "function" ? a.meta(nums) : a.meta) || 0;
  const num = n => Number(n || 0).toLocaleString("pt-BR");

  /** Conquistado? Meta zero significa "ainda não dá para tentar" — é o caso
      de quem não escolheu desafio do ano —, e isso nunca conta como feito. */
  function conquistado(a, nums) {
    if (a.livre) return true;
    if (!nums) return false;
    const meta = metaDe(a, nums);
    return meta > 0 && (nums[a.medida] || 0) >= meta;
  }

  const conquistados = nums => CATALOGO.filter(a => conquistado(a, nums)).map(a => a.id);

  /* -------------------------------------------------- aviso de conquista
     O prêmio precisa chegar no instante em que foi ganho; conquista que a
     pessoa só descobre se abrir a tela certa não recompensa nada.

     A primeira conferência de cada navegador é muda de propósito: quem já
     lia antes desta tela existir tomaria dez avisos de uma vez, e dez avisos
     juntos não são dez alegrias — são spam. */
  const VISTAS = "biblioteca.conquistas.v1";

  function confere() {
    const nums = numeros();
    if (!nums) return;
    const agora = conquistados(nums);
    let antes;
    try { antes = JSON.parse(localStorage.getItem(VISTAS) || "null"); } catch (e) { antes = null; }

    const guarda = () => { try { localStorage.setItem(VISTAS, JSON.stringify(agora)); } catch (e) { } };
    if (!Array.isArray(antes)) return guarda();

    const novas = agora.filter(id => !antes.includes(id));
    // renderAll() chama isto a cada salvamento; sem esta saída, todo registro
    // de leitura reescreveria a mesma lista no localStorage à toa.
    if (!novas.length && agora.length === antes.length) return;
    guarda();
    pinta();                       // o contador do painel da conta acabou de mudar
    if (!novas.length || typeof toast !== "function") return;

    const nomes = novas.map(id => PORID.get(id).nome);
    // O aviso leva para a grade. É o único instante em que a pessoa quer
    // clicar nisso, e até agora ele não levava a lugar nenhum.
    toast(novas.length === 1
      ? `Conquista: ${nomes[0]} — avatar liberado.`
      : `${novas.length} conquistas novas: ${nomes.join(", ")}.`,
      { texto: "escolher rosto", fn: abre });
    if (dlg && dlg.open) desenhaGrade();
  }

  /* ----------------------------------------------------------- a escolha */

  const dlg = $("avatarDlg");
  const atual = () => (window.MEU_PERFIL || {}).avatar_url || null;

  /** O botão de dentro do painel da conta: rosto, nome e quanto já se ganhou. */
  function pinta(perfil) {
    const alvo = $("avatarPreview");
    if (!alvo) return;
    const p = perfil || window.MEU_PERFIL || {};
    const desenho = svg(p.avatar_url);
    alvo.innerHTML = desenho ||
      esc((p.display_name || p.username || "?").trim().charAt(0));
    alvo.dataset.av = desenho ? "1" : "0";

    const nums = numeros();
    const feitas = nums ? conquistados(nums).length : 0;
    $("avatarNome").textContent = nomeDe(p.avatar_url) ||
      (p.avatar_url ? "imagem própria" : "sua inicial");
    $("avatarConta").textContent = `${feitas} de ${CATALOGO.length} conquistas`;
  }

  function barra(feito, n, meta) {
    if (feito) return "";
    const pct = meta > 0 ? Math.min(100, Math.round(n / meta * 100)) : 0;
    return `<span class="av-barra"><i style="width:${pct}%"></i></span>`;
  }

  function celula(a, nums, escolhido) {
    const feito = conquistado(a, nums);
    const meta = metaDe(a, nums);
    const n = a.livre ? 0 : Math.min(nums[a.medida] || 0, meta || Infinity);

    // "1260 de 10000" ao lado de "10.000 páginas lidas" faz o leitor conferir
    // se são o mesmo número. Mesma régua, mesma pontuação.
    const rodape = a.livre ? a.como
      : feito ? "conquistado"
      : meta > 0 ? `${a.como} · ${num(n)} de ${num(meta)}`
      : "escolha seu desafio do ano no perfil";

    return `
    <button type="button" class="av-cel" data-av-id="${a.id}"
            data-preso="${feito ? 0 : 1}" data-on="${escolhido ? 1 : 0}"
            aria-pressed="${escolhido ? "true" : "false"}">
      <span class="av-face">${svg(chaveDe(a.id))}${feito ? "" : `<span class="av-cadeado">🔒</span>`}</span>
      <span class="av-nome">${a.nome}</span>
      <span class="av-como">${esc(rodape)}</span>
      ${barra(feito || a.livre, n, meta)}
    </button>`;
  }

  function desenhaGrade() {
    const nums = numeros();
    const escolhido = idDaChave(atual());
    const feitas = nums ? conquistados(nums).length : 0;

    $("avatarResumo").textContent = nums
      ? `${feitas} de ${CATALOGO.length} conquistados. Cada um vira um rosto que aparece no feed, no ranking e para quem visita seu perfil.`
      : "Não consegui ler seus números agora.";

    $("avatarGrade").innerHTML = CATALOGO
      .map(a => celula(a, nums || {}, a.id === escolhido)).join("");
  }

  function abre() {
    if (!dlg) return;
    desenhaGrade();
    aviso("");
    if (!dlg.open) dlg.showModal();
  }

  function aviso(texto, tipo) {
    const el = $("avatarMsg");
    if (!el) return;
    el.textContent = texto || "";
    el.hidden = !texto;
    el.className = "auth-msg" + (tipo ? " " + tipo : "");
  }

  /** Trocar de avatar grava na hora. Não há botão de salvar porque não há o
      que rever: a escolha é o próprio resultado, e ela aparece na mesma tela. */
  async function escolhe(id) {
    const a = PORID.get(id);
    if (!a) return;
    const nums = numeros();

    if (!conquistado(a, nums)) {
      const meta = metaDe(a, nums);
      return aviso(meta > 0
        ? `Ainda não: ${a.como}. Você está em ${num(nums[a.medida])}.`
        : "Este depende do desafio do ano. Defina uma meta de livros no seu perfil.", "erro");
    }
    if (!Supa.user) return aviso("Entre na sua conta para trocar o avatar.", "erro");

    aviso("Salvando…");
    try {
      const p = await Supa.updateProfile({ avatar_url: chaveDe(id) });
      window.MEU_PERFIL = p;
      pinta(p);
      desenhaGrade();
      // O passo "escolha seu rosto" do primeiro dia acabou de ficar pronto —
      // ou de deixar de estar. Sem isto ele só se corrigiria no próximo render.
      if (typeof renderPrimeiroDia === "function") renderPrimeiroDia();
      aviso(`Agora você é ${a.nome}.`, "ok");
    } catch (e) {
      /* O banco recusa avatar não conquistado. Quando isso acontece com uma
         conquista que a tela mostra como feita, o motivo quase sempre é o
         mesmo: a leitura ainda está neste navegador e não subiu. */
      aviso(/conquist/i.test(e.message || "")
        ? "O servidor ainda não viu essa conquista. Sincronize sua conta e tente de novo."
        : "Não consegui trocar: " + e.message, "erro");
    }
  }

  /** Volta para a inicial do nome. Existe porque escolher avatar não pode ser
      caminho de mão única — e a inicial é o padrão de quem nunca escolheu. */
  async function limpa() {
    if (!Supa.user) return;
    aviso("Salvando…");
    try {
      const p = await Supa.updateProfile({ avatar_url: null });
      window.MEU_PERFIL = p;
      pinta(p);
      desenhaGrade();
      // O passo "escolha seu rosto" do primeiro dia acabou de ficar pronto —
      // ou de deixar de estar. Sem isto ele só se corrigiria no próximo render.
      if (typeof renderPrimeiroDia === "function") renderPrimeiroDia();
      aviso("Voltou para a sua inicial.", "ok");
    } catch (e) { aviso("Não consegui: " + e.message, "erro"); }
  }

  /* ------------------------------------------------------------- ligação */

  const btn = $("btnAvatar");
  if (btn) btn.addEventListener("click", abre);
  const fechar = $("avatarClose");
  if (fechar) fechar.addEventListener("click", () => dlg.close());
  const semAvatar = $("btnSemAvatar");
  if (semAvatar) semAvatar.addEventListener("click", limpa);

  const grade = $("avatarGrade");
  if (grade) grade.addEventListener("click", e => {
    const cel = e.target.closest("[data-av-id]");
    if (cel) escolhe(cel.dataset.avId);
  });

  return { svg, paraImagem, nomeDe, fila, pinta, confere, numeros, abre,
           conquistados: () => conquistados(numeros()) };
})();
