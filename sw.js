/* Service worker da Biblioteca.
   Objetivo: o app abrir offline sem nunca servir uma versão velha por engano.
   - navegação: rede primeiro, cache como rede de segurança
   - estáticos (ícones, manifest): cache primeiro, revalidando por trás
   - Open Library: sempre rede, nunca cache (metadados não são do app) */

const VERSION = "biblioteca-v28";
const SHELL = [
  "./",
  "./index.html",
  "./config.js",
  "./supa.js",
  "./account.js",
  "./avatares.js",
  "./social.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())     // um recurso faltando não impede a instalação
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Open Library e capas externas passam direto

  // Páginas: rede primeiro, para que um novo deploy apareça já no próximo acesso online.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then(r => r || caches.match("./")))
    );
    return;
  }

  // Imagens: cache primeiro, revalidando por trás. Mudam pouco e pesam.
  if (req.destination === "image") {
    event.respondWith(
      caches.match(req).then(cached => {
        const network = fetch(req)
          .then(res => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then(c => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Código (js, css, json): rede primeiro, cache só como rede de segurança.
  //
  // Cache primeiro aqui causa desencontro de versão: o index.html vem novo da
  // rede e os scripts vêm velhos do cache, então o HTML novo chama código que
  // não existe mais. Sem etapa de build para versionar os nomes dos arquivos,
  // ir à rede primeiro é o que garante que tudo venha do mesmo deploy.
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
