// Perinexa's service worker (the installable app, 31 Oct 2026): it makes Perinexa installable on phones, tablets and
// computers. PATIENT DATA IS NEVER KEPT ON THE DEVICE: requests to /api always go to the server and are never stored,
// and pages are always fetched fresh (the browser's own cache handles the app's scripts and styles, as on the website).
// Only the "no connection" page and its icon are kept, to show when there is no internet.
const CACHE = 'perinexa-app-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE, '/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
});

// An older version's files are removed
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return; // everything else, /api included, as without the app
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // A page: always from the server; without a connection, the "no connection" page
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
});
