// Versión reemplazada automáticamente por build.js en cada deploy de Netlify
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
  '/icono_app.png',
  '/js/jspdf.umd.min.js',
  '/js/drive.js'
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
  if (event.request.method === 'POST' && url.pathname === '/app.html') {
    event.respondWith((async () => {
      const formData = await event.request.formData();
      const file = formData.get('file');
      if (file) {
        const cache = await caches.open('share-target');
        await cache.put('shared-file', new Response(file));
      }
      return Response.redirect('/app.html', 303);
    })());
    return;
  }

  // Network-only: Gemini API, Firebase, Google OAuth y Drive
  if (url.hostname === 'generativelanguage.googleapis.com' ||
      url.hostname.endsWith('.firebaseio.com') ||
      url.hostname === 'oauth2.googleapis.com' ||
      url.hostname === 'www.googleapis.com') {
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
