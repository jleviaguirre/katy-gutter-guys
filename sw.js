/**
 * Gutter Guys of Katy - service worker
 * ---------------------------------------------------------------------------
 * - App shell (HTML/CSS/JS/manifest/icons): cache-first, so the shell loads
 *   instantly and works offline.
 * - API calls (to the Cloudflare Worker): stale-while-revalidate, so the app
 *   renders the last known content immediately while refreshing it in the
 *   background. Falls back to cache alone when offline.
 */
// Bump this whenever a fix means previously-cached responses must be
// discarded (the browser only re-checks this file's own bytes for updates,
// not imported scripts, so cache-name bumps alone in config.js won't trigger
// an update without a change here too).
var SW_BUILD = 4;

importScripts('./config.js');

var SHELL_CACHE = self.APP_CONFIG.SHELL_CACHE;
var API_CACHE = self.APP_CONFIG.API_CACHE;
var API_BASE_URL = self.APP_CONFIG.API_BASE_URL;

var SHELL_ASSETS = [
  './',
  './index.html',
  './config.js',
  './manifest.json',
  './assets/css/styles.css',
  './assets/js/app.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) { return cache.addAll(SHELL_ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) { return key !== SHELL_CACHE && key !== API_CACHE; })
            .map(function (key) { return caches.delete(key); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return; // never intercept POST (form submits)

  var url = new URL(request.url);
  var isApiRequest = API_BASE_URL && url.href.indexOf(API_BASE_URL) === 0;

  if (isApiRequest) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
  }
});

function cacheFirst(request) {
  return caches.match(request).then(function (cached) {
    if (cached) return cached;
    return fetch(request).then(function (response) {
      return cacheResponse(SHELL_CACHE, request, response);
    });
  });
}

function staleWhileRevalidate(request) {
  return caches.open(API_CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var networkFetch = fetch(request)
        .then(function (response) {
          if (response.ok) {
            cache.put(request, response.clone()); // never cache error responses
          }
          return response;
        })
        .catch(function () {
          return cached; // offline - fall back to whatever we have
        });
      return cached || networkFetch;
    });
  });
}

function cacheResponse(cacheName, request, response) {
  if (response && response.ok) {
    var copy = response.clone();
    caches.open(cacheName).then(function (cache) { cache.put(request, copy); });
  }
  return response;
}
