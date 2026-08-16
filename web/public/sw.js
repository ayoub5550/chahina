const CACHE = "chahina-v35";
const ASSETS = ["./", "./styles.css", "./ux.css", "./app.js", "./v2.js", "./ux.js", "./ai.js", "./simple.js",
  "./i18n.js", "./config.js", "./manifest.webmanifest",
  "./vendor/leaflet/leaflet.css", "./vendor/leaflet/leaflet.js"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS))));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x))))));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/") || e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
