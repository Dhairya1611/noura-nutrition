const CACHE = "noura-shell-v5";
const ROOT = new URL("./", self.location.href).href;
const SHELL_ASSETS = [new URL("manifest.webmanifest", ROOT).href, new URL("icon.svg", ROOT).href];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const rootResponse = await fetch(ROOT, { cache: "no-store" });
    if (!rootResponse.ok) throw new Error("The Noura app shell could not be downloaded.");
    await cache.put(ROOT, rootResponse);
    await cache.addAll(SHELL_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
  const isNavigation = event.request.mode === "navigate";
  const networkRequest = isNavigation ? new Request(event.request, { cache: "no-store" }) : event.request;
  const cacheKey = isNavigation ? ROOT : event.request;
  event.respondWith(fetch(networkRequest).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(cacheKey, copy));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(cacheKey);
    if (cached) return cached;
    if (isNavigation) return caches.match(ROOT);
    return new Response("Noura is offline and this file is not cached yet.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => clients[0]?.focus() || self.clients.openWindow(ROOT)));
});
