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
  const emit = () => listeners.forEach(fn => { try { fn(session); } catch (e) { console.error(e); } });

  function store(s) {
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
    emit();
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

  async function refresh() {
    if (!session || !session.refresh_token) return null;
    try {
      const s = await raw("/auth/v1/token?grant_type=refresh_token", {
        method: "POST", body: { refresh_token: session.refresh_token }
      });
      return store(s);
    } catch (e) {
      store(null);                       // refresh token morto: sessão acabou
      throw e;
    }
  }

  /** Chamada autenticada, renovando o token quando necessário. */
  async function auth(path, opts = {}) {
    if (!session) throw new Error("Você precisa entrar na sua conta.");
    if (Date.now() >= session.expires_at) await refresh();
    try {
      return await raw(path, Object.assign({}, opts, { token: session.access_token }));
    } catch (e) {
      if (e.status !== 401) throw e;
      await refresh();                   // token recusado antes da hora prevista
      return raw(path, Object.assign({}, opts, { token: session.access_token }));
    }
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
      store(null);
    },

    /** Troca a senha do usuário já autenticado (inclusive por link de recuperação). */
    async updatePassword(novaSenha) {
      const user = await auth("/auth/v1/user", { method: "PUT", body: { password: novaSenha } });
      if (session) { session.user = user; localStorage.setItem(AUTH_KEY, JSON.stringify(session)); }
      return user;
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
