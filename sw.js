// Polyarena service worker: precache the app shell (including the ~0.9 MB
// motion-capture animation library), serve cache-first with background
// refresh so the game works offline once visited. Character models
// (assets/models/*.glb, ~1 MB each) are cached on first use rather than
// precached, to keep the first load light.

const CACHE = 'polyarena-v10';
const SHELL = [
  '.',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'fonts/bungee.woff2',
  'fonts/teko.woff2',
  'fonts/rajdhani-600.woff2',
  'fonts/rajdhani-700.woff2',
  'js/main.js',
  'js/util.js',
  'js/fighters.js',
  'js/engine.js',
  'js/sim.js',
  'js/render3d.js',
  'js/camera.js',
  'js/fighter.js',
  'js/charrig.js',
  'js/models.js',
  'js/anim.js',
  'js/styles.js',
  'js/portraits.js',
  'js/stages.js',
  'js/table.js',
  'js/hud.js',
  'js/bots.js',
  'js/fx.js',
  'js/audio.js',
  'assets/anims/anims.json',
  'assets/anims/anims.bin',
  'vendor/three.module.min.js',
  'vendor/three.core.min.js',
  'vendor/jsm/loaders/GLTFLoader.js',
  'vendor/jsm/utils/BufferGeometryUtils.js',
  'vendor/jsm/utils/SkeletonUtils.js',
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
