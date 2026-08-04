/* Cliente do Supabase escrito à mão sobre fetch.
 *
 * Por que não a biblioteca oficial: este app não tem build nem dependências, e
 * promete funcionar offline. Um bundle de CDN quebraria as duas coisas. A API do
 * Supabase é HTTP comum — dá para falar com ela direto.
 *
 * Cuida de: criar conta, entrar, sair, renovar o token antes de expirar, e as
 * chamadas de tabela que o app usa. */
"use strict";

const Supa = (() => {
  const cfg = window.BIBLIOTECA_CONFIG || {};
  const AUTH_KEY = "biblioteca.auth.v1";
  const ready = !!(cfg.url && cfg.anonKey);

  let session = null;
  try { session = JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch (e) { session = null; }

  const listeners = new Set();
  /* O motivo viaja junto com a mudança: quem perde a sessão precisa saber se
     saiu por vontade própria ou se foi expulso — sem isso, a tela de entrada
     reaparece do nada e o usuário fica sem explicação. */
  const emit = motivo => listeners.forEach(fn => { try { fn(session, motivo); } catch (e) { console.error(e); } });

  function store(s, motivo) {
    if (s && s.access_token) {
      session = {
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        // 60s de folga: melhor renovar cedo do que tomar 401 no meio de uma escrita
        expires_at: Date.now() + ((s.expires_in || 3600) - 60) * 1000,
        user: s.user || (session && session.user) || null
      };
      localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    } else {
      session = null;
      localStorage.removeItem(AUTH_KEY);
    }
    emit(motivo);
    return session;
  }

  /** Erro com a mensagem que o Supabase devolveu, não um "500" genérico. */
  class SupaError extends Error {
    constructor(status, body) {
      const msg = (body && (body.msg || body.message || body.error_description || body.error || body.hint)) ||
                  `HTTP ${status}`;
      super(msg);
      this.status = status;
      this.body = body;
      this.code = body && body.code;
    }
  }

  async function raw(path, { method = "GET", body, headers = {}, token } = {}) {
    if (!ready) throw new Error("Backend não configurado (config.js).");
    const res = await fetch(cfg.url + path, {
      method,
      headers: Object.assign({
        apikey: cfg.anonKey,
        Authorization: "Bearer " + (token || cfg.anonKey),
        "Content-Type": "application/json"
      }, headers),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let parsed = null;
    if (text) { try { parsed = JSON.parse(text); } catch (e) { parsed = { message: text }; } }
    if (!res.ok) throw new SupaError(res.status, parsed);
    return parsed;
  }

  /* Renova o token. Só derruba a sessão quando o servidor RECUSA o refresh
     token — aí ela morreu mesmo. Falha de rede, 500 ou timeout não são motivo
     para expulsar ninguém: quem apaga a sessão por causa de wi-fi ruim faz o
     usuário digitar a senha certa e voltar para a tela de entrada calado. */
  async function refresh() {
    if (!session || !session.refresh_token) {
      store(null, "expirou");
      throw new Error("Sua sessão terminou. Entre de novo.");
    }
    try {
      const s = await raw("/auth/v1/token?grant_type=refresh_token", {
        method: "POST", body: { refresh_token: session.refresh_token }
      });
      return store(s);
    } catch (e) {
      if (e.status === 400 || e.status === 401 || e.status === 403) {
        store(null, "expirou");          // refresh token morto: sessão acabou
        throw new Error("Sua sessão expirou. Entre de novo.");
      }
      throw e;                           // rede/servidor: sessão continua de pé
    }
  }

  /** Chamada autenticada, renovando o token quando necessário. */
  async function auth(path, opts = {}) {
    if (!session) throw new Error("Você precisa entrar na sua conta.");
    if (Date.now() >= session.expires_at) await refresh();
    try {
      return await raw(path, Object.assign({}, opts, { token: session.access_token }));
    } catch (e) {
      // 401 aqui pode ser token vencido antes da hora — ou pode ser problema da
      // própria tabela. Renovar só faz sentido no primeiro caso; nos outros,
      // renovar em vão gastava o refresh token e derrubava a sessão à toa.
      //
      // Token recém-emitido não vence: se ele acabou de sair do login e mesmo
      // assim tomou 401, o problema é do outro lado. Renovar aí era o que
      // apagava a sessão de quem tinha ACABADO de entrar com a senha certa.
      const perto = Date.now() >= session.expires_at - 5 * 60 * 1000;
      if (e.status !== 401 || !perto || !ehProblemaDeToken(e)) throw e;
      await refresh();
      return raw(path, Object.assign({}, opts, { token: session.access_token }));
    }
  }

  /** O PostgREST responde 401 tanto para "seu token venceu" quanto para outras
      recusas. Estas marcas são as do token. */
  function ehProblemaDeToken(e) {
    const txt = `${(e && e.code) || ""} ${(e && e.message) || ""}`;
    return /PGRST30|jwt|token|expired|invalid claim|not authenticated/i.test(txt);
  }

  const qs = params => Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

  /* Confirmação de e-mail, link mágico e OAuth voltam com a sessão no fragmento
     da URL (#access_token=...). Guardamos e limpamos a barra de endereços na
     hora: token em URL vaza por histórico, por print e por "copiar link". */
  async function captureFromUrl() {
    const hash = location.hash || "";
    if (hash.length < 2) return null;
    const p = new URLSearchParams(hash.slice(1));
    const limpaUrl = () => history.replaceState(null, "", location.pathname + location.search);

    if (p.get("error") || p.get("error_description")) {
      const erro = p.get("error_description") || p.get("error");
      limpaUrl();
      return { error: decodeURIComponent(erro.replace(/\+/g, " ")) };
    }

    const access_token = p.get("access_token");
    if (!access_token) return null;

    store({
      access_token,
      refresh_token: p.get("refresh_token"),
      expires_in: +p.get("expires_in") || 3600
    });
    limpaUrl();

    try {
      const user = await raw("/auth/v1/user", { token: access_token });
      session.user = user;
      localStorage.setItem(AUTH_KEY, JSON.stringify(session));
      emit();
      return { ok: true, type: p.get("type") || "login" };
    } catch (e) {
      store(null);                       // token da URL não vale: não fingir que entrou
      return { error: "Esse link expirou ou já foi usado. Entre com e-mail e senha." };
    }
  }

  return {
    captureFromUrl,
    ready,
    onChange(fn) { listeners.add(fn); fn(session); return () => listeners.delete(fn); },
    get session() { return session; },
    get user() { return session && session.user; },

    // ---------------------------------------------------------------- contas
    async signUp(email, password, displayName) {
      const out = await raw("/auth/v1/signup", {
        method: "POST",
        body: { email, password, data: { display_name: displayName || "" } }
      });
      // Com confirmação de e-mail ligada, não vem sessão: o usuário precisa confirmar.
      if (out && out.access_token) { store(out); return { session: true }; }
      return { session: false, email };
    },

    async signIn(email, password) {
      const out = await raw("/auth/v1/token?grant_type=password", {
        method: "POST", body: { email, password }
      });
      return store(out);
    },

    async signOut() {
      try { await auth("/auth/v1/logout", { method: "POST" }); } catch (e) { /* sair sempre funciona localmente */ }
      store(null, "saiu");
    },

    /** Troca a senha do usuário já autenticado (inclusive por link de recuperação). */
    async updatePassword(novaSenha) {
      const user = await auth("/auth/v1/user", { method: "PUT", body: { password: novaSenha } });
      if (session) { session.user = user; localStorage.setItem(AUTH_KEY, JSON.stringify(session)); }
      return user;
    },

    /** Reenvia o e-mail de confirmação de cadastro. Sem isto, quem não recebeu
        o primeiro e-mail fica preso para sempre: a senha está certa e o
        servidor recusa mesmo assim. */
    async resendConfirmation(email) {
      return raw("/auth/v1/resend", {
        method: "POST", body: { type: "signup", email, gotrue_meta_security: {} }
      });
    },

    async resetPassword(email, redirectTo) {
      return raw("/auth/v1/recover", { method: "POST", body: { email, gotrue_meta_security: {}, redirect_to: redirectTo } });
    },

    // ---------------------------------------------------------------- perfil
    async myProfile() {
      if (!session || !session.user) return null;
      const rows = await auth(`/rest/v1/profiles?${qs({ id: "eq." + session.user.id, select: "*" })}`);
      return rows[0] || null;
    },

    async updateProfile(patch) {
      const rows = await auth(`/rest/v1/profiles?${qs({ id: "eq." + session.user.id })}`, {
        method: "PATCH", body: patch, headers: { Prefer: "return=representation" }
      });
      return rows[0];
    },

    async profileByUsername(username) {
      const rows = await raw(`/rest/v1/rpc/reader_card`, {
        method: "POST", body: { p_username: username },
        token: session && session.access_token
      });
      return rows[0] || null;
    },

    // ---------------------------------------------------------------- social
    /* Descoberta. Tudo aqui lê só o que o RLS já abre para qualquer um:
       perfis públicos, estantes de perfis públicos e o grafo de seguidores.
       Nenhuma função nova no banco — o esquema já dava conta. */

    /** Procura leitores por @ ou por nome. */
    async searchReaders(termo, limit = 20) {
      // Estes caracteres são sintaxe de filtro no PostgREST; num campo de busca
      // eles não querem dizer nada, e deixá-los passar quebraria a consulta.
      const t = termo.replace(/[%,()*\\]/g, "").trim();
      if (t.length < 2) return [];
      const alvo = encodeURIComponent(t);
      return raw(`/rest/v1/profiles?${qs({
        select: "id,username,display_name,bio,avatar_url", is_private: "eq.false", limit
      })}&or=(username.ilike.*${alvo}*,display_name.ilike.*${alvo}*)`,
      { token: session && session.access_token });
    },

    /** Quem eu sigo, em uma ida só — o app guarda e usa para pintar os botões. */
    async following() {
      if (!session || !session.user) return [];
      const rows = await auth(`/rest/v1/follows?${qs({
        select: "following", follower: "eq." + session.user.id
      })}`);
      return rows.map(r => r.following);
    },

    follow(userId) {
      return auth("/rest/v1/follows", {
        method: "POST", body: { follower: session.user.id, following: userId }
      });
    },

    unfollow(userId) {
      return auth(`/rest/v1/follows?${qs({
        follower: "eq." + session.user.id, following: "eq." + userId
      })}`, { method: "DELETE" });
    },

    /** Leitores públicos que têm estes livros na estante.
        Um pedido para a estante inteira, não um por livro: com 40 livros na
        tela, 40 requisições seriam um jeito elegante de derrubar o próprio app. */
    async readersOfBooks(olKeys) {
      const chaves = [...new Set((olKeys || []).filter(Boolean))];
      if (!chaves.length || !session || !session.user) return [];
      const lista = chaves.map(encodeURIComponent).join(",");
      return auth(`/rest/v1/books?${qs({
        select: "ol_key,status,owner,profiles(username,display_name,avatar_url)",
        owner: "neq." + session.user.id, limit: 200
      })}&ol_key=in.(${lista})`);
    },

    // ----------------------------------------------------------------- obra
    /* A página do livro agrega por ol_key, sem tabela de obra canônica. Essa
       tabela é a refatoração cara — juntar edições, reconciliar livro digitado
       à mão com a Open Library — e nada aqui precisa dela para funcionar:
       ol_key já é o que faz a edição dela e a dele serem o mesmo livro.

       O RLS faz o recorte sozinho: books_read devolve o que é seu e o que é de
       perfil público, então estante de perfil privado não entra na lista nem
       na contagem. */
    exemplaresDaObra(olKey) {
      return auth(`/rest/v1/books?${qs({
        select: "id,title,author,cover_url,pages,year,synopsis,status,rating,review,owner," +
                "profiles(username,display_name,avatar_url)",
        ol_key: "eq." + olKey,
        limit: 100
      })}`);
    },

    /** Média da obra. Vem de função porque ela conta a nota de gente cuja
        estante eu não posso ler — o que sai é média e contagem, nunca quem
        deu qual nota. */
    async notaDaObra(olKey) {
      const linhas = await auth("/rest/v1/rpc/book_rating", {
        method: "POST", body: { p_ol_key: olKey }
      });
      return (linhas && linhas[0]) || { media: null, votos: 0 };
    },

    // ------------------------------------------------------------------ feed
    /* Uma ida por tela. A função feed() no banco já devolve autor, livro,
       nota, contagem de curtidas, contagem de comentários e se fui eu que
       curti — montar isso no cliente custaria cinco requisições por rolagem. */
    feed(escopo = "seguindo", limit = 30, antes = null) {
      return auth("/rest/v1/rpc/feed", {
        method: "POST",
        body: { p_escopo: escopo, p_limit: limit, p_antes: antes }
      });
    },

    curtir(activityId) {
      return auth("/rest/v1/likes", {
        method: "POST", body: { activity_id: activityId, user_id: session.user.id }
      });
    },

    descurtir(activityId) {
      return auth(`/rest/v1/likes?${qs({
        activity_id: "eq." + activityId, user_id: "eq." + session.user.id
      })}`, { method: "DELETE" });
    },

    comentarios(activityId) {
      return auth(`/rest/v1/comments?${qs({
        select: "id,body,created_at,author,profiles(username,display_name,avatar_url)",
        activity_id: "eq." + activityId, order: "created_at.asc", limit: 200
      })}`);
    },

    comentar(activityId, texto) {
      return auth("/rest/v1/comments", {
        method: "POST",
        body: { activity_id: activityId, author: session.user.id, body: texto },
        headers: { Prefer: "return=representation" }
      });
    },

    apagarComentario(id) {
      return auth(`/rest/v1/comments?${qs({ id: "eq." + id })}`, { method: "DELETE" });
    },

    /** Denúncia. Existe desde o primeiro esquema e nunca teve tela: sem ela,
        moderar depende de alguém avisar por fora — e ninguém avisa. */
    denunciar({ comentario = null, atividade = null, motivo }) {
      return auth("/rest/v1/reports", {
        method: "POST",
        body: { reporter: session.user.id, comment_id: comentario, activity_id: atividade, reason: motivo }
      });
    },

    /** Publica uma anotação: torna a linha pública e anuncia no feed.
        Duas escritas porque são dois fatos distintos — a nota passa a ser
        legível, e passou a existir um acontecimento com hora marcada. */
    async publicarNota(notaId, livroId, titulo) {
      await auth(`/rest/v1/notes?${qs({ id: "eq." + notaId })}`, {
        method: "PATCH", body: { is_public: true }
      });
      return auth("/rest/v1/activities", {
        method: "POST",
        body: {
          owner: session.user.id, kind: "note", note_id: notaId, book_id: livroId,
          payload: { title: titulo || null }
        },
        headers: { Prefer: "return=representation" }
      });
    },

    /** Despublica: some do feed e volta a ser privada. A atividade fica órfã
        de propósito — apagá-la levaria junto os comentários de quem respondeu,
        e a função feed() já esconde atividade sem nota pública. */
    despublicarNota(notaId) {
      return auth(`/rest/v1/notes?${qs({ id: "eq." + notaId })}`, {
        method: "PATCH", body: { is_public: false }
      });
    },

    // -------------------------------------------------------- notificações
    /* Quem escreve notificação é o banco, por gatilho. O cliente só lê as
       suas e marca como lidas — não existe política de INSERT aqui, então
       nem se quisesse daria para plantar aviso no nome de outra pessoa. */
    notificacoes(limit = 30) {
      return auth("/rest/v1/rpc/notificacoes", { method: "POST", body: { p_limit: limit } });
    },

    naoLidas() {
      return auth("/rest/v1/rpc/nao_lidas", { method: "POST", body: {} });
    },

    /** Marca tudo como lido. Um PATCH filtrado é uma ida só, e a condição de
        dono é redundante com o RLS de propósito: filtro errado aqui vira
        engano visível, não escrita indevida. */
    marcarLidas() {
      return auth(`/rest/v1/notifications?${qs({
        user_id: "eq." + session.user.id, read_at: "is.null"
      })}`, { method: "PATCH", body: { read_at: new Date().toISOString() } });
    },

    // --------------------------------------------------------------- ranking
    leaderboard(period = "month", metric = "pages", limit = 50) {
      return raw("/rest/v1/rpc/leaderboard", {
        method: "POST",
        body: { p_period: period, p_metric: metric, p_limit: limit },
        token: session && session.access_token
      });
    },

    // ----------------------------------------------------------------- dados
    insert(table, rows) {
      return auth(`/rest/v1/${table}`, {
        method: "POST", body: rows, headers: { Prefer: "return=representation" }
      });
    },

    /* Grava mandando o id junto: se a linha já existe, atualiza; se não,
       cria. É o que torna a sincronia repetível — mandar duas vezes o mesmo
       registro tem que dar o mesmo resultado que mandar uma, senão cada
       reenvio duplicaria a estante. */
    upsert(table, rows) {
      return auth(`/rest/v1/${table}`, {
        method: "POST", body: rows,
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" }
      });
    },

    select(table, params = {}) {
      return auth(`/rest/v1/${table}?${qs(Object.assign({ select: "*" }, params))}`);
    },

    update(table, filter, patch) {
      return auth(`/rest/v1/${table}?${qs(filter)}`, {
        method: "PATCH", body: patch, headers: { Prefer: "return=representation" }
      });
    },

    remove(table, filter) {
      return auth(`/rest/v1/${table}?${qs(filter)}`, { method: "DELETE" });
    }
  };
})();
