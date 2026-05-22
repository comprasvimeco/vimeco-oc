// Versión reemplazada automáticamente por build.js en cada push (GitHub Actions)
const CACHE_NAME = 'vimeco-oc-v6';

const BASE = '/vimeco-oc';

const STATIC_ASSETS = [
  BASE + '/index.html',
  BASE + '/app.html',
  BASE + '/css/styles.css',
  BASE + '/js/auth.js',
  BASE + '/js/app.js',
  BASE + '/js/firebase.js',
  BASE + '/js/gemini.js',
  BASE + '/js/ocGenerator.js',
  BASE + '/js/voice.js',
  BASE + '/js/logoBase64.js',
  BASE + '/obras.js',
  BASE + '/whitelist.js',
  BASE + '/manifest.json',
  BASE + '/icono_app.png',
  BASE + '/js/jspdf.umd.min.js'
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
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME && k !== 'share-target').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' })))
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Web Share Target: guarda el archivo en cache y redirige a app.html
  if (event.request.method === 'POST' && url.pathname === BASE + '/app.html') {
    event.respondWith((async () => {
      const formData = await event.request.formData();
      const file = formData.get('file');
      if (file) {
        const cache = await caches.open('share-target');
        await cache.put('shared-file', new Response(file));
      }
      return Response.redirect(BASE + '/app.html', 303);
    })());
    return;
  }

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
