/**
 * Cloudflare Pages Function: GET /api/geocode?q=...
 *
 * A small proxy in front of the public Nominatim service so LAKBAY follows
 * the Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 *   - identifies LAKBAY with a proper User-Agent and the site as Referer
 *   - caches every answer for 7 days at Cloudflare (repeat searches never
 *     reach Nominatim)
 *   - lets only the search text through; every other parameter is fixed
 *   - spaces requests at least 1.1 s apart per server instance
 *   - KILL SWITCH: set GEOCODER_ENABLED=false in the Cloudflare dashboard
 *     (Pages project -> Settings -> Environment variables) to stop all
 *     Nominatim traffic immediately, without changing or redeploying code.
 *
 * Environment variables (Cloudflare dashboard, NOT VITE_ variables):
 *   GEOCODER_ENABLED   "true" (default) or "false"
 *   GEOCODER_CONTACT   a URL or email for the User-Agent, e.g. your GitHub repo URL
 *   GEOCODER_UPSTREAM  optional: another Nominatim server (e.g. self-hosted)
 */
import {
  fixedSearchParams,
  NOMINATIM_SEARCH_URL,
  normalizeQuery,
  QUERY_MAX_LENGTH,
  QUERY_MIN_LENGTH,
} from '../../shared/geocoder';

interface Env {
  GEOCODER_ENABLED?: string;
  GEOCODER_CONTACT?: string;
  GEOCODER_UPSTREAM?: string;
}

interface PagesContext {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}

const CACHE_SECONDS = 7 * 24 * 60 * 60;
const MIN_GAP_MS = 1100;
let lastUpstreamCall = 0;

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const { request, env } = context;

  if ((env.GEOCODER_ENABLED ?? 'true').toLowerCase() !== 'true') {
    return json({ error: 'geocoder_disabled' }, 503);
  }

  const incoming = new URL(request.url);
  const q = normalizeQuery(incoming.searchParams.get('q') ?? '');
  if (q.length < QUERY_MIN_LENGTH || q.length > QUERY_MAX_LENGTH) {
    return json({ error: 'bad_query' }, 400);
  }

  const upstream = new URL(env.GEOCODER_UPSTREAM || NOMINATIM_SEARCH_URL);
  for (const [key, value] of Object.entries(fixedSearchParams())) upstream.searchParams.set(key, value);
  upstream.searchParams.set('q', q);

  // Cache lookup (Cloudflare edge cache, per data center).
  const cache = (globalThis as unknown as { caches: { default: Cache } }).caches.default;
  const cacheKey = new Request(upstream.toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) {
    const response = new Response(hit.body, hit);
    response.headers.set('x-lakbay-cache', 'HIT');
    return response;
  }

  // Space out calls from this server instance.
  const wait = lastUpstreamCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastUpstreamCall = Date.now();

  const contact = env.GEOCODER_CONTACT || 'contact-not-configured';
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstream.toString(), {
      headers: {
        'User-Agent': `LAKBAY-commuting-app/0.4 (${contact})`,
        Referer: incoming.origin,
        Accept: 'application/json',
      },
    });
  } catch {
    return json({ error: 'upstream_unreachable' }, 502);
  }

  if (upstreamResponse.status === 429 || upstreamResponse.status === 403) {
    // Nominatim is limiting or has blocked us: tell the app to fall back.
    return json({ error: 'upstream_limited' }, 429, { 'retry-after': '60' });
  }
  if (!upstreamResponse.ok) {
    return json({ error: `upstream_${upstreamResponse.status}` }, 502);
  }

  const body = await upstreamResponse.text();
  const response = new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
      'x-lakbay-cache': 'MISS',
    },
  });
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
