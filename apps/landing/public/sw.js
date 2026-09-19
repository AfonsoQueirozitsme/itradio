/*
 * Service worker — Radio IT (IT.FM) PWA.
 *
 * Sem dependências. Faz:
 *   - precache do "app shell" mínimo + página offline (para funcionar sem rede);
 *   - navegação network-first com fallback para a última página cacheada e,
 *     em último caso, para /offline.html;
 *   - assets estáticos com hash (/_next/static) em cache-first (imutáveis);
 *   - o resto (ícones, manifest, og-image) em stale-while-revalidate.
 *
 * NÃO toca no stream de áudio (é cross-origin, radio.itfm.live) nem em pedidos
 * não-GET nem nos dados dinâmicos do Next (RSC).
 *
 * Sobe CACHE_VERSION sempre que mudares a estratégia ou os ficheiros precached
 * — o activate limpa as caches antigas.
 */
const CACHE_VERSION = "itfm-v2";
const PRECACHE = `${CACHE_VERSION}-precache`;
const RUNTIME = `${CACHE_VERSION}-runtime`;

// Recursos garantidos para o modo offline (todos existem em /public).
const PRECACHE_URLS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  // Aplica a versão nova sem esperar pelo fecho de todas as abas.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== PRECACHE && k !== RUNTIME)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isImmutableStatic(url) {
  return url.pathname.startsWith("/_next/static/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Só GET. Métodos com efeitos (POST, etc.) passam sempre à rede.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Só a mesma origem — o stream e tudo o que é cross-origin passa direto.
  if (url.origin !== self.location.origin) return;

  // Gestão (/gestao) e a sua API: autenticadas e sempre frescas → passam à rede,
  // nunca cacheadas nem servidas de cache (evita servir páginas atrás de login).
  if (url.pathname === "/gestao" || url.pathname.startsWith("/gestao/") ||
      url.pathname.startsWith("/api/gestao")) {
    return;
  }

  // Dados do Next (RSC) são dinâmicos — nunca cacheados.
  if (url.searchParams.has("_rsc")) return;

  // Navegações: network-first, com fallback para cache e depois /offline.html.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME);
        try {
          const fresh = await fetch(request);
          if (fresh.ok) cache.put(request, fresh.clone());
          return fresh;
        } catch {
          return (
            (await cache.match(request)) ||
            (await caches.match("/offline.html"))
          );
        }
      })(),
    );
    return;
  }

  // Assets com hash: imutáveis → cache-first.
  if (isImmutableStatic(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const res = await fetch(request);
        if (res.ok) {
          const cache = await caches.open(RUNTIME);
          cache.put(request, res.clone());
        }
        return res;
      })(),
    );
    return;
  }

  // Ícones, manifest, og-image, etc.: stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })(),
  );
});
