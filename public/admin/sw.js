const CACHE_NAME = "ultimate-clinic-shell-v5";
const APP_SHELL = ["/admin/index.html", "/admin/manifest.webmanifest", "/admin/icon.svg"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Ultimate Esthetics", {
    body: data.body || "There is an update in Clinic Desk.",
    icon: data.icon || "/admin/icon.svg",
    badge: "/admin/icon.svg",
    tag: data.tag || "clinic-update",
    renotify: true,
    vibrate: [70, 45, 120, 55, 190],
    data: { url: data.url || "/admin/index.html" }
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/admin/index.html", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const existing = list.find(client => client.url.startsWith(self.location.origin + "/admin/"));
    if (existing) return existing.focus();
    return clients.openWindow(target);
  }));
});
self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
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