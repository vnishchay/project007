// Trusted Picks service worker: makes the app installable and quick to reopen.
// Pages: network first, the last copy when offline. Built files (/assets/*, hashed): cache first.
// Never touches the database, sign-in, AI or payment calls (other origins and /api/).
const CACHE = "tp-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/favicon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok && url.pathname === "/") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/index.html", copy)); }
        return res;
      }).catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
