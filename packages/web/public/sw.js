// 极简 service worker：只缓存 App Shell，不碰 /api 与 /ws（06 §1）。
const CACHE = "durahub-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // API/WS 永不缓存：权威状态在 hub（05 §1）；导航文档也不缓存（拿最新资产名）
  if (url.pathname.startsWith("/api/") || url.pathname === "/ws" || e.request.mode === "navigate") return;
  // 带内容 hash 的静态资源 cache-first
  if (!/-[A-Za-z0-9_-]{8}\.[a-z]+$/.test(url.pathname)) return;
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit ??
      fetch(e.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      }),
    ),
  );
});
