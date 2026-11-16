/**
 * Place search (addresses, landmarks, barangays, cities, municipalities)
 * using OpenStreetMap data via Nominatim, through LAKBAY's proxy.
 *
 * Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/
 * How this file follows it:
 *  - Search runs ONLY when the user presses Search. There is no autocomplete.
 *  - At most one request per 1.1 s from this browser (the proxy spaces and
 *    caches too).
 *  - Results are cached on this device for 7 days.
 *  - The UI shows "© OpenStreetMap contributors" next to the results.
 *  - If the service is switched off or blocks us, the app keeps working with
 *    LAKBAY's own data and says so.
 *
 * Results are PLACES for positioning the map and trip ends. They are never
 * stored as LAKBAY transport data.
 */
import { normalizeQuery, QUERY_MAX_LENGTH, QUERY_MIN_LENGTH } from '../../shared/geocoder';
import { env } from './env';
import { storage } from './storage';

export interface GeocodeResult {
  id: string;
  name: string;
  /** e.g. "Barangay, Municipality, Province" */
  context: string;
  /** OSM place type, e.g. "village", "city", "bus_station" */
  placeType: string;
  lon: number;
  lat: number;
  /** [west, south, east, north] when the place is an area */
  bbox?: [number, number, number, number];
}

export type GeocodeOutcome =
  | { status: 'ok'; results: GeocodeResult[]; fromCache: boolean }
  | { status: 'disabled' | 'too_short' | 'busy' | 'error'; message: string };

const CACHE_KEY = 'lakbay-geocode-cache-v1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 40;
const MIN_GAP_MS = 1100;

interface CacheEntry {
  at: number;
  results: GeocodeResult[];
}

function readCache(): Record<string, CacheEntry> {
  try {
    const parsed: unknown = JSON.parse(storage.get(CACHE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, CacheEntry>) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CacheEntry>) {
  const entries = Object.entries(cache)
    .filter(([, e]) => Date.now() - e.at < CACHE_TTL_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, CACHE_MAX_ENTRIES);
  storage.set(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

// Request pacing: every call waits for the previous one + 1.1 s.
let nextAllowedAt = 0;
async function waitForSlot() {
  const now = Date.now();
  const startAt = Math.max(now, nextAllowedAt);
  nextAllowedAt = startAt + MIN_GAP_MS;
  if (startAt > now) await new Promise((resolve) => setTimeout(resolve, startAt - now));
}

interface NominatimItem {
  place_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  type?: string;
  addresstype?: string;
  boundingbox?: [string, string, string, string]; // [south, north, west, east]
  address?: Record<string, string>;
}

function toResult(item: NominatimItem): GeocodeResult | null {
  const lat = Number(item.lat);
  const lon = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const a = item.address ?? {};
  const name = item.name || item.display_name.split(',')[0];
  const locality = a.city || a.town || a.municipality || a.village;
  const parts = [a.quarter || a.suburb || a.neighbourhood || a.hamlet, locality, a.state || a.province || a.region]
    .filter((p): p is string => !!p && p !== name);
  const bb = item.boundingbox?.map(Number);
  return {
    id: `osm-${item.place_id}`,
    name,
    context: [...new Set(parts)].join(', ') || item.display_name,
    placeType: item.addresstype || item.type || 'place',
    lon,
    lat,
    bbox: bb && bb.every(Number.isFinite) ? [bb[2], bb[0], bb[3], bb[1]] : undefined,
  };
}

export async function geocode(query: string, signal?: AbortSignal): Promise<GeocodeOutcome> {
  if (!env.geocoder.enabled) {
    return { status: 'disabled', message: 'OpenStreetMap place search is turned off.' };
  }
  const q = normalizeQuery(query);
  if (q.length < QUERY_MIN_LENGTH) {
    return { status: 'too_short', message: `Type at least ${QUERY_MIN_LENGTH} letters.` };
  }
  if (q.length > QUERY_MAX_LENGTH) {
    return { status: 'too_short', message: 'That search is too long.' };
  }

  const cache = readCache();
  const cached = cache[q];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { status: 'ok', results: cached.results, fromCache: true };
  }

  await waitForSlot();
  if (signal?.aborted) return { status: 'error', message: 'Search cancelled.' };

  let response: Response;
  try {
    const url = `${env.geocoder.endpoint}${env.geocoder.endpoint.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}`;
    response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch {
    return { status: 'error', message: 'Place search is unreachable. Check your connection.' };
  }

  if (response.status === 503) {
    return { status: 'disabled', message: 'OpenStreetMap place search is paused right now.' };
  }
  if (response.status === 429) {
    return { status: 'busy', message: 'Place search is busy. Please try again in a minute.' };
  }
  if (!response.ok) {
    return { status: 'error', message: 'Place search failed. Please try again later.' };
  }

  try {
    const items = (await response.json()) as NominatimItem[];
    const results = (Array.isArray(items) ? items : []).map(toResult).filter((r): r is GeocodeResult => !!r);
    cache[q] = { at: Date.now(), results };
    writeCache(cache);
    return { status: 'ok', results, fromCache: false };
  } catch {
    return { status: 'error', message: 'Place search returned an unexpected answer.' };
  }
}
