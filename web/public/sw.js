// Heorth PWA service worker — hand-rolled and small on purpose (see web/README
// for why: no vite-plugin-pwa/Workbox, just this file + the offline-queue
// logic in src/lib, which is the part that actually needs test coverage).
//
// Strategy:
//  - Build assets (content-hashed, under /assets/) + icons: cache-first. Vite
//    hashes the filename on every change, so a cached copy is never stale.
//  - Navigations (index.html): network-first, falling back to the last cached
//    shell when offline, so the app still boots with zero connectivity.
//  - /api/* calls: always network — this worker does NOT cache API responses.
//    Offline "last-known shopping list + queued check-offs" is handled by the
//    app itself (src/lib/shopping-offline.ts) via localStorage, which survives
//    a full reload same as this worker's shell cache does.
//
// Update flow: a new deploy installs a new worker that waits (no forced
// self.skipWaiting() on install — a mid-session takeover would swap the app
// under the user's feet). The page (src/lib/sw-register.ts) notices the
// waiting worker and shows a toast; only a user-triggered reload posts
// SKIP_WAITING, which activates the new worker and reloads once.

const CACHE_NAME = 'heorth-shell-v1';
const ASSET_RE = /\.(?:js|css|woff2?|ttf|png|jpg|jpeg|svg|ico|webmanifest)$/;

self.addEventListener('install', () => {
  // No eager precache list: hashed build filenames aren't known ahead of
  // time. The shell fills in lazily via the cache-first fetch handler below.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // POST/PATCH/DELETE always pass through untouched

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // Network-first, no caching: the app's own offline layer covers the one
    // surface (shopping list) that needs to tolerate a dead spot.
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, res.clone());
          return res;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match(request)) || (await cache.match('/index.html')) || Response.error();
        }
      })(),
    );
    return;
  }

  if (ASSET_RE.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) return cached;
        const res = await fetch(request);
        cache.put(request, res.clone());
        return res;
      })(),
    );
  }
});
