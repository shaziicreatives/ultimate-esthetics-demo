const CACHE_NAME = "ultimate-clinic-shell-v2";
const APP_SHELL = ["/admin/index.html", "/admin/manifest.webmanifest", "/admin/icon.svg"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate" && url.pathname.startsWith("/admin/")) {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put("/admin/index.html", copy));
      return response;
    }).catch(() => caches.match("/admin/index.html")));
    return;
  }
  if (url.pathname.startsWith("/admin/")) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
  }
});