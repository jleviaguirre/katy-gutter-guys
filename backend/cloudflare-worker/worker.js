/**
 * RainGuard - Cloudflare Worker proxy
 * ---------------------------------------------------------------------------
 * Sits between the public GitHub Pages site and the Google Apps Script
 * backend. Responsibilities:
 *   - Adds CORS headers (the browser talks to this Worker, never directly
 *     to Apps Script, so Apps Script doesn't need to handle CORS at all).
 *   - Edge-caches GET responses for a short TTL to reduce load/latency.
 *   - Forwards POST (form submissions) straight through, uncached.
 *   - Optional per-IP rate limiting on POST if a `RATE_LIMIT_KV` namespace
 *     is bound; silently skipped otherwise.
 *
 * Required environment vars (set in wrangler.toml or `wrangler secret put`):
 *   APPS_SCRIPT_URL  - the deployed Apps Script /exec URL
 *   ALLOWED_ORIGIN   - the site origin allowed to call this Worker
 *                      (e.g. https://yourusername.github.io)
 * Optional:
 *   RATE_LIMIT_KV           - KV namespace binding to enable rate limiting
 *   RATE_LIMIT_MAX_REQUESTS - requests allowed per window (default 20)
 *   RATE_LIMIT_WINDOW_SEC   - window length in seconds (default 60)
 *   CACHE_TTL_SECONDS       - edge cache TTL for GET responses (default 300)
 */

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = buildCorsHeaders(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!env.APPS_SCRIPT_URL) {
      return jsonResponse({ ok: false, error: 'APPS_SCRIPT_URL is not configured' }, 500, corsHeaders);
    }

    try {
      if (request.method === 'GET') {
        return await handleGet(request, env, ctx, corsHeaders);
      }
      if (request.method === 'POST') {
        return await handlePost(request, env, corsHeaders);
      }
      return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, corsHeaders);
    } catch (err) {
      return jsonResponse({ ok: false, error: String(err && err.message || err) }, 502, corsHeaders);
    }
  }
};

async function handleGet(request, env, ctx, corsHeaders) {
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);

  const cached = await cache.match(cacheKey);
  if (cached) {
    const response = new Response(cached.body, cached);
    applyCorsHeaders(response.headers, corsHeaders);
    response.headers.set('X-Cache', 'HIT');
    return response;
  }

  const incoming = new URL(request.url);
  const target = new URL(env.APPS_SCRIPT_URL);
  incoming.searchParams.forEach((value, key) => target.searchParams.set(key, value));

  const upstream = await fetch(target.toString(), { method: 'GET', redirect: 'follow' });
  const bodyText = await upstream.text();

  const ttl = Number(env.CACHE_TTL_SECONDS || 300);
  const response = new Response(bodyText, {
    status: upstream.status,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Cache-Control': `public, max-age=${ttl}`,
      'X-Cache': 'MISS'
    }
  });

  if (upstream.ok) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  applyCorsHeaders(response.headers, corsHeaders);
  return response;
}

async function handlePost(request, env, corsHeaders) {
  const rateLimited = await isRateLimited(request, env);
  if (rateLimited) {
    return jsonResponse({ ok: false, error: 'Too many requests, please try again shortly.' }, 429, corsHeaders);
  }

  const bodyText = await request.text();
  const upstream = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyText,
    redirect: 'follow'
  });

  const responseText = await upstream.text();
  const response = new Response(responseText, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8' }
  });
  applyCorsHeaders(response.headers, corsHeaders);
  return response;
}

/** Simple fixed-window per-IP counter stored in KV. No-op if unbound. */
async function isRateLimited(request, env) {
  if (!env.RATE_LIMIT_KV) return false;

  const max = Number(env.RATE_LIMIT_MAX_REQUESTS || 20);
  const windowSec = Number(env.RATE_LIMIT_WINDOW_SEC || 60);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${ip}:${window}`;

  const current = Number((await env.RATE_LIMIT_KV.get(key)) || 0);
  if (current >= max) return true;

  await env.RATE_LIMIT_KV.put(key, String(current + 1), { expirationTtl: windowSec * 2 });
  return false;
}

function buildCorsHeaders(env) {
  const origin = env.ALLOWED_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function applyCorsHeaders(headers, corsHeaders) {
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
}

function jsonResponse(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8', ...corsHeaders }
  });
}
