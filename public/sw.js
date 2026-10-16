const CACHE = "noura-shell-v11";
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

self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || "It’s time to log your next meal." };
  }
  event.waitUntil(self.registration.showNotification(payload.title || "Noura meal reminder", {
    body: payload.body || "Take a quick photo or tell Noura what’s on your plate.",
    icon: new URL("icon.svg", ROOT).href,
    badge: new URL("icon.svg", ROOT).href,
    tag: payload.tag || "noura-meal-reminder",
    renotify: true,
    data: { url: payload.url || ROOT }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  let target = ROOT;
  try {
    const requested = new URL(event.notification.data?.url || ROOT, ROOT);
    if (requested.origin === self.location.origin) target = requested.href;
  } catch {
    target = ROOT;
  }
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clients => {
    const existing = clients.find(client => client.url.startsWith(ROOT));
    if (existing) {
      await existing.navigate?.(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});
