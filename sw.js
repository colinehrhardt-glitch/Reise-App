const VERSION = 'viaro-v3';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/api.js',
  'js/discover.js',
  'js/i18n.js',
  'js/info.js',
  'js/map.js',
  'js/overview.js',
  'js/planner.js',
  'js/recent.js',
  'js/storage.js',
  'js/ui.js',
  'data/airports.json',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png'
];
const LIBS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
  'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js',
  'https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.3/leaflet-maplibre-gl.js'
];
const NETWORK_WAIT = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    await Promise.all(LIBS.map(async (url) => {
      try {
        const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (response.ok) await cache.put(url, response);
      } catch {
        return;
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  network.catch(() => null);
  const cached = cache.match(request, { ignoreSearch: true }).then((hit) => hit || (request.mode === 'navigate' ? cache.match('./') : null));
  const fallback = new Promise((resolve) => {
    setTimeout(async () => resolve(await cached), NETWORK_WAIT);
  });
  try {
    const response = await Promise.race([network, fallback]);
    if (response) return response;
    return await network;
  } catch (error) {
    const hit = await cached;
    if (hit) return hit;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request.url, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) event.respondWith(networkFirst(request));
  else if (url.hostname === 'unpkg.com') event.respondWith(cacheFirst(request));
});
