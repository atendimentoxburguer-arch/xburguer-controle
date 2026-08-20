const CACHE_NAME = "xburguer-pwa-v4.5.1";
const PRECACHE = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./icons/xburguer-rounded-180.png",
  "./icons/xburguer-rounded-192.png",
  "./icons/xburguer-rounded-512.png",
  "./icons/xburguer-rounded-maskable-512.png",
  "./CONTROLE%20DE%20CONSUMO/app.js",
  "./CONTROLE%20DE%20CONSUMO/configuracoes-supabase.js",
  "./CONTROLE%20DE%20CONSUMO/configuracoes.html",
  "./CONTROLE%20DE%20CONSUMO/consumos-supabase.js",
  "./CONTROLE%20DE%20CONSUMO/consumos.html",
  "./CONTROLE%20DE%20CONSUMO/dashboard-supabase.js",
  "./CONTROLE%20DE%20CONSUMO/dashboard.html",
  "./CONTROLE%20DE%20CONSUMO/faltas-supabase.js",
  "./CONTROLE%20DE%20CONSUMO/faltas.html",
  "./CONTROLE%20DE%20CONSUMO/funcionarios-supabase.js",
  "./CONTROLE%20DE%20CONSUMO/funcionarios.html",
  "./CONTROLE%20DE%20CONSUMO/historico-supabase.js",
  "./CONTROLE%20DE%20CONSUMO/historico.html",
  "./CONTROLE%20DE%20CONSUMO/login.html",
  "./CONTROLE%20DE%20CONSUMO/logo.jfif",
  "./CONTROLE%20DE%20CONSUMO/produtos-supabase.js",
  "./CONTROLE%20DE%20CONSUMO/produtos.html",
  "./CONTROLE%20DE%20CONSUMO/relatorios-supabase.js",
  "./CONTROLE%20DE%20CONSUMO/relatorios.html",
  "./CONTROLE%20DE%20CONSUMO/style.css",
  "./CONTROLE%20DE%20CONSUMO/supabase-config.js"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key.startsWith("xburguer-pwa-") && key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Supabase, Google Fonts, jsDelivr e qualquer outro domínio ficam fora do cache local.
    if (url.origin !== self.location.origin) return;

    event.respondWith((async () => {
        try {
            // Para arquivos do próprio sistema, força revalidação de rede.
            const networkRequest = new Request(request, { cache: "no-store" });
            const response = await fetch(networkRequest);

            if (response && response.ok) {
                const cache = await caches.open(CACHE_NAME);
                cache.put(request, response.clone());
            }
            return response;
        } catch (_) {
            const cached = await caches.match(request, { ignoreSearch: true });
            if (cached) return cached;

            if (request.mode === "navigate") {
                return (
                    await caches.match("./CONTROLE%20DE%20CONSUMO/login.html", { ignoreSearch: true }) ||
                    await caches.match("./offline.html", { ignoreSearch: true })
                );
            }

            return Response.error();
        }
    })());
});
