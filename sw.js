// Service Worker — network-first：在线永远拿最新版（顺手更新缓存），离线回退缓存。
// skipWaiting + clients.claim：新 SW 立即接管，不等旧页面关闭（两阶段更新的规避）。
// 不做多版本缓存管理：network-first 下缓存始终保持最后一次成功响应，单资源无需缓存代际。
const CACHE = 'ctdp-offline-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        void caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
