// Porto 3D service worker: the app opens offline after one visit.
// Network first for pages and data (fresh deploys win), cache first for
// hashed bundles, photos, models and icons. Same origin only:
// fonts, Wikimedia and YouTube go straight to the network.
const VERSION = 'porto-v1';
const SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // one missing file must not stop the install
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// /assets/ is served immutable by vercel.json; /og/ previews stay network first
const CACHE_FIRST = /^\/(static|assets|icons)\//;

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }));
    if (hit) return hit;
    if (fallbackUrl) {
      const shell = await cache.match(fallbackUrl);
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // live data: never cache
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './'));
  } else if (CACHE_FIRST.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else {
    // /data/*.json, the manifest, anything else on this origin
    event.respondWith(networkFirst(request));
  }
});
