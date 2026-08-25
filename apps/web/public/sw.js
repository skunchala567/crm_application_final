/*
 * MarketFarmer service worker.
 *
 * Installability is only half of what this is for. The other half is that the
 * shell -- the HTML, the JavaScript and the CSS -- comes from the cache, so an
 * installed app opens at once and a flaky connection costs a request rather
 * than a blank window.
 *
 * What it deliberately does NOT do:
 *
 *   - It never touches the API. Lead data is per user, per business unit and
 *     changes constantly; a cached answer would be a stale or, worse, someone
 *     else's. Anything that is not this origin, or that looks like an API
 *     call, is passed straight to the network with no interception at all.
 *   - It never caches a POST, PUT or DELETE.
 *
 * Written by hand rather than generated: the build has no service-worker
 * plugin, and the rules here are few enough to read in one sitting.
 */

// Bump on release. The old cache is deleted on activate, so a new version
// never serves last week's JavaScript.
const VERSION = 'marketfarmer-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

// The least that has to be there for the app to open offline. Hashed build
// assets are not listed: their names change every build, so they are cached as
// they are requested instead.
const SHELL = ['/', '/index.html', '/offline.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll fails the whole install if one entry 404s; each is added on its
    // own so a missing extra never costs the install.
    await Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

/** The page asking to be updated now rather than on the next cold start. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

const isApiRequest = (url) => url.pathname.startsWith('/api/')
  || url.pathname.startsWith('/uploads/')
  || url.pathname.startsWith('/media/');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Another origin (the API on its own host, Google fonts, provider media) is
  // none of this worker's business.
  if (url.origin !== self.location.origin) return;
  if (isApiRequest(url)) return;

  /*
   * A navigation: try the network first so a deploy is picked up, fall back to
   * the cached shell, and only then to the offline page. index.html is the
   * fallback for every route because this is a single-page app -- the router
   * resolves /leads once the shell is running.
   */
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('/index.html', response.clone());
        return response;
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('/index.html'))
          || (await cache.match('/'))
          || (await cache.match('/offline.html'))
          || Response.error();
      }
    })());
    return;
  }

  /*
   * Everything else on this origin, in one of two ways.
   *
   * /assets/ is Vite's hashed output: the name changes whenever the contents
   * do, so a cached copy can never be wrong and is served without asking the
   * network at all.
   *
   * Anything else at the root -- crm-attribution.js, the icons, a CSV template
   * -- keeps its name when it changes. Those are served from cache for speed
   * and refreshed in the background, so an edit reaches the user on their next
   * visit rather than waiting for the worker version to be bumped.
   */
  const immutable = url.pathname.startsWith('/assets/');
  event.respondWith((async () => {
    const cache = await caches.open(ASSET_CACHE);
    const cached = await cache.match(request);
    // Opaque and error responses are not worth keeping.
    const keep = (response) => {
      if (response && response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    };
    if (cached && immutable) return cached;
    const network = fetch(request).then(keep).catch(() => null);
    if (cached) {
      // Refresh for next time; this visit is answered from cache.
      event.waitUntil(network);
      return cached;
    }
    return (await network) || Response.error();
  })());
});
