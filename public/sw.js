// Porto 3D service worker: the app opens offline after one visit.
//
//   shell      installed up front: the page, the manifest, two icons
//   cache first   hashed bundles (/static/), photos (/assets/), icons, and
//                 data files that carry ?v=<content hash> (they never change
//                 under that URL)
//   network first the page itself and unversioned data (fresh deploys win)
//
// Everything else is cached on demand with a cap, so a long session over the
// streamed tiles cannot fill the visitor's storage: the data cache keeps the
// last DATA_MAX entries, the photo cache the last PHOTO_MAX (oldest out).
// Same origin only: fonts, Wikimedia and YouTube go straight to the network.
const VERSION = 'porto-v2';
const DATA = 'porto-data-v2';
const PHOTOS = 'porto-photos-v2';
const DATA_MAX = 600; // the 470 city tiles and the data files with room to spare
const PHOTO_MAX = 120;
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
      .then((keys) => Promise.all(keys.filter((k) => ![VERSION, DATA, PHOTOS].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// put, then drop the oldest entries beyond the cap (keys() is insertion order)
async function putCapped(name, request, response, max) {
  const cache = await caches.open(name);
  await cache.put(request, response);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

function cacheFor(url) {
  if (/^\/(data|cities)\//.test(url.pathname)) return [DATA, DATA_MAX];
  if (/^\/assets\//.test(url.pathname)) return [PHOTOS, PHOTO_MAX];
  return [VERSION, 400];
}

async function networkFirst(request, fallbackUrl) {
  const url = new URL(request.url);
  const [name, max] = cacheFor(url);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') putCapped(name, request, res.clone(), max).catch(() => {});
    return res;
  } catch (err) {
    const cache = await caches.open(name);
    const hit = (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }));
    if (hit) return hit;
    if (fallbackUrl) {
      const shell = await (await caches.open(VERSION)).match(fallbackUrl);
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const url = new URL(request.url);
  const [name, max] = cacheFor(url);
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') putCapped(name, request, res.clone(), max).catch(() => {});
  return res;
}

// /static/ is hashed, /assets/ is immutable per vercel.json, versioned data never changes
const CACHE_FIRST = /^\/(static|assets|icons)\//;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // live data: never cache
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './'));
  } else if (CACHE_FIRST.test(url.pathname) || (url.searchParams.has('v') && /^\/(data|cities)\//.test(url.pathname))) {
    event.respondWith(cacheFirst(request));
  } else {
    // unversioned data, the manifest, anything else on this origin
    event.respondWith(networkFirst(request));
  }
});
