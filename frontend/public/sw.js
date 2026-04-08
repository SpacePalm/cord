const CACHE_NAME = 'cord-v1';
const PRECACHE = [
  '/app',
  '/logo.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // API и WebSocket — всегда в сеть
  if (request.url.includes('/api/') || request.url.includes('/ws') || request.url.includes('/media/')) {
    return;
  }

  // Для навигации (HTML) — network first, fallback to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/app'))
    );
    return;
  }

  // Статика — cache first, fallback to network
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
