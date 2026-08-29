// Polyarena service worker: precache the app shell, serve cache-first with
// background refresh so the game works offline once visited.

const CACHE = 'polyarena-v3';
const SHELL = [
  '.',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/main.js',
  'js/util.js',
  'js/fighters.js',
  'js/engine.js',
  'js/sim.js',
  'js/render3d.js',
  'js/stages.js',
  'vendor/three.module.min.js',
  'vendor/three.core.min.js',
  'js/table.js',
  'js/hud.js',
  'js/bots.js',
  'js/audio.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request)
        .then(res => {
          if (res.ok && new URL(e.request.url).origin === location.origin) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
