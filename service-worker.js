const CACHE_NAME = 'korea-stock-dashboard-v2-4-cloudflare';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 외부 API·시세 데이터는 영구 캐싱하지 않고 네트워크 우선으로 처리한다.
  const isExternalApi = url.hostname.includes('yahoo.com') ||
    url.hostname.includes('hyperliquid.xyz') ||
    url.hostname.includes('allorigins.win') ||
    url.hostname.includes('open.er-api.com') ||
    url.pathname.startsWith('/api/');

  if (isExternalApi) {
    event.respondWith(
      fetch(req).catch(() => new Response(JSON.stringify({ ok:false, offline:true, message:'network unavailable' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 503
      }))
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (req.method === 'GET' && url.origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      }
      return res;
    }).catch(() => cached))
  );
});
