/* Vela offline shell service worker */
const CACHE = "vela-shell-v1";
const SHELL_ASSETS = [
  "/",
  "/component.html",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/icons/vela-icon-180.png",
  "/icons/vela-icon-192.png",
  "/icons/vela-icon-512.png",
  "/icons/vela-icon-maskable-512.png",
  "/vela-wordmark.svg",
  "/vela-wordmark-dark.svg",
  "/vela-terminal-square.svg"
];

async function precacheShell() {
  const cache = await caches.open(CACHE);
  const entries = [...SHELL_ASSETS];
  try {
    const shell = await fetch("/");
    if (shell.ok) {
      cache.put("/", shell.clone());
      const html = await shell.text();
      const modulePaths = [...html.matchAll(/<script\s+src="(\/src\/[^"]+\.js)"/g)].map((match) => match[1]);
      entries.push(...modulePaths);
    }
  } catch {
    /* Shell may already be cached; continue with the static list. */
  }
  await Promise.allSettled(entries.map((entry) => cache.add(entry)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" && request.method !== "HEAD") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // Network-first for application modules and source scripts so updates
  // take effect immediately without being blocked by stale offline caches.
  if (url.pathname.startsWith("/src/") || url.pathname.endsWith(".js")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && new URL(request.url).pathname !== "/api/health") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});