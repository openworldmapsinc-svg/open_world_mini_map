/* Open World Maps — service worker
   - app shell: cache-first
   - map tiles + fonts: cache-first with a size cap, so charted ground
     keeps rendering when the signal drops
   - place lookups (Nominatim) always go to the network
*/
const VERSION    = 'v14';
const SHELL      = 'ow-shell-' + VERSION;
const TILES      = 'ow-tiles-' + VERSION;
const TILE_LIMIT = 1500;

const SHELL_FILES = [
  './',
  './index.html',
  './data.js',
  './app.js',
  './manifest.json',
  './cartographer.jpg',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

const TILE_HOSTS = [
  'basemaps.cartocdn.com',
  'tile.openstreetmap.org',
  'tile.opentopomap.org',
  'server.arcgisonline.com',
  'fonts.gstatic.com'
];

const SHELL_HOSTS = ['unpkg.com', 'fonts.googleapis.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL).then(cache =>
      Promise.allSettled(SHELL_FILES.map(url =>
        cache.add(new Request(url, {
          cache: 'reload',
          mode: url.startsWith('http') ? 'cors' : 'same-origin'
        }))
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith('ow-') && k !== SHELL && k !== TILES)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys  = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // place lookups must never be served stale
  if (url.hostname.endsWith('nominatim.openstreetmap.org') ||
      url.hostname.endsWith('photon.komoot.io')) return;

  // tiles and font files
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) {
    event.respondWith((async () => {
      const cache = await caches.open(TILES);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
          cache.put(req, res.clone());
          trimCache(TILES, TILE_LIMIT);
        }
        return res;
      } catch {
        return new Response('', { status: 504, statusText: 'Unavailable offline' });
      }
    })());
    return;
  }

  // page loads
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(SHELL);
        cache.put('./index.html', res.clone());
        return res;
      } catch {
        const cache = await caches.open(SHELL);
        return (await cache.match('./index.html')) || (await cache.match('./')) ||
               new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // own files and known libraries
  const own = url.origin === self.location.origin;
  if (!own && !SHELL_HOSTS.some(h => url.hostname.endsWith(h))) return;

  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req);
    const net = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  })());
});
