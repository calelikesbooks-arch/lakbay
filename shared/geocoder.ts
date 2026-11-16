/**
 * Geocoder settings shared by the Cloudflare Pages Function (production)
 * and the Vite dev proxy (local development).
 *
 * Provider: the public Nominatim instance, run by the OpenStreetMap Foundation.
 * Usage policy (read it!): https://operations.osmfoundation.org/policies/nominatim/
 *   - absolute maximum 1 request per second, for ALL LAKBAY users combined
 *   - identify the app (User-Agent / Referer)
 *   - NO autocomplete / search-as-you-type
 *   - cache results; show OpenStreetMap attribution
 *   - the app must be switchable off without a software update
 */

export const NOMINATIM_ORIGIN = 'https://nominatim.openstreetmap.org';
export const NOMINATIM_SEARCH_PATH = '/search';
export const NOMINATIM_SEARCH_URL = `${NOMINATIM_ORIGIN}${NOMINATIM_SEARCH_PATH}`;

/**
 * Prefer results around the pilot area (Bulacan to Quezon City).
 * Format: left,top,right,bottom. Only a preference (bounded=0), so other
 * Philippine places can still be found. This is a search hint, not data.
 */
export const PILOT_VIEWBOX = '120.85,14.90,121.12,14.55';

/** Parameters fixed by LAKBAY. The browser may only choose the text (q). */
export function fixedSearchParams(): Record<string, string> {
  return {
    format: 'jsonv2',
    countrycodes: 'ph',
    limit: '6',
    addressdetails: '1',
    'accept-language': 'en,fil',
    viewbox: PILOT_VIEWBOX,
    bounded: '0',
  };
}

/**
 * "a=1&b=2" from an object. Written by hand (instead of URLSearchParams) so
 * it also works in vite.config.ts, whose TypeScript settings have no browser types.
 */
export function toQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export const QUERY_MIN_LENGTH = 3;
export const QUERY_MAX_LENGTH = 120;

/** Same query → same cache entry ("  Cubao " and "cubao" share one). */
export function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, ' ').toLowerCase();
}