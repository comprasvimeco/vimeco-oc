// Versión reemplazada automáticamente por build.js en cada push (GitHub Actions)
const CACHE_NAME = 'vimeco-oc-v1781642035477';

const BASE = '/vimeco-oc';

const STATIC_ASSETS = [
  BASE + '/index.html',
  BASE + '/menu.html',
  BASE + '/compras.html',
  BASE + '/app.html',
  BASE + '/caja.html',
  BASE + '/css/styles.css',
  BASE + '/js/auth.js',
  BASE + '/js/app.js',
  BASE + '/js/firebase.js',
  BASE + '/js/drive.js',
  BASE + '/js/gemini.js',
  BASE + '/js/ocGenerator.js',
  BASE + '/js/voice.js',
  BASE + '/js/logoBase64.js',
  BASE + '/obras.html',
  BASE + '/js/obras.js',
  BASE + '/usuarios.html',
  BASE + '/js/usuarios.js',
  BASE + '/manifest.json',
  BASE + '/icono_app.png',
  BASE + '/icons/icon-192.png',
  BASE + '/icons/icon-512.png',
  BASE + '/js/jspdf.umd.min.js',
  BASE + '/historial.html',
  BASE + '/js/historial.js',
  BASE + '/js/driveQueue.js',
  BASE + '/adjuntar.html',
  BASE + '/js/adjuntar.js',
  BASE + '/js/icons.js',
  BASE + '/js/caja.js'
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
  if (event.request.method === 'POST' &&
      (url.pathname === BASE + '/app.html' || url.pathname === BASE + '/adjuntar.html')) {
    event.respondWith((async () => {
      const formData = await event.request.formData();
      const file = formData.get('file');
      if (file) {
        const cache = await caches.open('share-target');
        await cache.put('shared-file', new Response(file, {
          headers: { 'X-File-Name': file.name || '', 'Content-Type': file.type || '' }
        }));
      }
      return Response.redirect(BASE + '/app.html', 303);
    })());
    return;
  }

  // Network-only: Google APIs (Drive, OAuth, Gemini) y Firebase.
  // No se llama a event.respondWith(): así el navegador maneja la request
  // nativamente sin pasar por el SW. Re-hacer fetch(event.request) acá
  // rompe en iOS/Safari con bodies binarios (multipart de subida a Drive),
  // tirando "TypeError: Load failed".
  if (url.hostname.endsWith('.googleapis.com') ||
      url.hostname.endsWith('.firebaseio.com')) {
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
