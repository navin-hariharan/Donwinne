// Offline support for Donwinne: keeps the app's files so it opens without a network.
// The build fills in VERSION and PRECACHE (see vite.config.ts); a new build means a new cache.
const VERSION = "__SW_VERSION__";
const PRECACHE = /*__SW_PRECACHE__*/ [];
const CACHE = `donwinne-${VERSION}`;
const SHELL = "index.html";
/** How long a page load waits for the network before using the saved copy. */
const NETWORK_TIMEOUT_MS = 4000;

const abs = (p) => new URL(p, self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map(abs))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("donwinne-") && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// The page asks a waiting new version to take over when the user agrees to reload.
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

async function fromNetwork(request, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Pages: the network first, so a new version shows up when online; the saved copy when offline.
    event.respondWith(
      (async () => {
        try {
          const response = await fromNetwork(request, NETWORK_TIMEOUT_MS);
          if (response.ok) {
            const cache = await caches.open(CACHE);
            await cache.put(abs(SHELL), response.clone());
          }
          return response;
        } catch {
          const saved = await caches.match(abs(SHELL));
          return saved ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Everything else: file names carry a content hash, so a saved copy is always right.
  event.respondWith(
    (async () => {
      const saved = await caches.match(request, { ignoreSearch: url.pathname.endsWith(".webmanifest") });
      if (saved) return saved;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
