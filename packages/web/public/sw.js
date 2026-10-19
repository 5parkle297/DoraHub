// 极简 service worker：只缓存带 hash 的静态资产，不碰 /api、/ws、导航（06 §1）。
// v2：修复 v1 缓存导航文档导致更新不生效的 bug——导航永远走网络。
const CACHE = "dorahub-shell-v9";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (e) => {
  // v2 不再预缓存导航文档（只缓存带 hash 的资产，fetch 时懒加载）
  e.waitUntil(self.skipWaiting());
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
