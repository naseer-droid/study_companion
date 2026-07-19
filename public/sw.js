// Study Lamp service worker — app-shell caching + read-only offline data.
// Bump VERSION on any change to this file to invalidate old caches.
const VERSION = "v4"; // v3.4: visible transcripts, rich article reader, remote books, new mic
const CACHE = `study-lamp-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(["/"]))
      .catch(() => {}) // "/" may redirect to /login when signed out; fine
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // writes are online-only by design
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // The one data read: network-first so it's always fresh, cached copy as the
  // offline read-only fallback.
  if (url.pathname === "/api/storage") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error()))
    );
    return;
  }

  // Other API calls (LLM, auth) need the network.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  // Hashed build assets and icons never change: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // Navigations: network-first, cached shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match("/")).then((hit) => hit || Response.error())
        )
    );
  }
});
