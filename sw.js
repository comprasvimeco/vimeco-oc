// DEPLOY VERSION: v6
// *** Cambiar este número en cada deploy para forzar actualización en móviles ***
// Ej: 'vimeco-oc-v5', 'vimeco-oc-v6', etc.
const CACHE_NAME = 'vimeco-oc-v6';

const STATIC_ASSETS = [
  '/index.html',
  '/app.html',
  '/css/styles.css',
  '/js/auth.js',
  '/js/app.js',
  '/js/firebase.js',
  '/js/gemini.js',
  '/js/ocGenerator.js',
  '/js/voice.js',
  '/js/logoBase64.js',
  '/obras.js',
  '/whitelist.js',
  '/manifest.json',
  '/icono_app.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' })))
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Network-only: Gemini API y Firebase
  if (url.hostname === 'generativelanguage.googleapis.com' ||
      url.hostname.endsWith('.firebaseio.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
