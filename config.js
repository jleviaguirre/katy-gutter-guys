/**
 * Gutter Guys of Katy - runtime configuration
 * Edit API_BASE_URL after deploying the Cloudflare Worker (see
 * /backend/cloudflare-worker). Loaded both by the page (as window.APP_CONFIG)
 * and by the service worker (via importScripts, as self.APP_CONFIG) because
 * `globalThis` resolves to the right object in both contexts.
 */
(function (scope) {
  scope.APP_CONFIG = {
    // Cloudflare Worker base URL, no trailing slash.
    API_BASE_URL: 'https://rainguard-proxy.quiet-tree-7238.workers.dev',

    // Module shown when the URL has no #hash.
    DEFAULT_MODULE: 'home',

    // Cache names/versions - bump these to force clients to drop old caches.
    SHELL_CACHE: 'rainguard-shell-v3',
    API_CACHE: 'rainguard-api-v2'
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
