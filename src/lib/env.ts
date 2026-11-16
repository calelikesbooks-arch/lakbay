/**
 * Reads and checks environment variables in ONE place.
 * Other files import from here instead of touching import.meta.env directly.
 */

const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

function clean(value: string | undefined): string {
  return (value ?? '').trim();
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** True if the key is a Supabase SECRET key, which must never be in a website. */
function looksLikeSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  // Legacy keys are JWTs: header.payload.signature. The payload says the role.
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload?.role === 'service_role';
    } catch {
      return false;
    }
  }
  return false;
}

export type SupabaseConfigStatus =
  | { state: 'not-configured' }
  | { state: 'invalid'; reason: string }
  | { state: 'configured'; url: string; anonKey: string };

function readSupabaseConfig(): SupabaseConfigStatus {
  const url = clean(import.meta.env.VITE_SUPABASE_URL);
  const anonKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY);

  if (!url && !anonKey) return { state: 'not-configured' };
  if (!url || !anonKey) {
    return { state: 'invalid', reason: 'Set both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or leave both empty.' };
  }
  if (!isHttpUrl(url)) {
    return { state: 'invalid', reason: 'VITE_SUPABASE_URL is not a valid URL.' };
  }
  if (looksLikeSecretKey(anonKey)) {
    return {
      state: 'invalid',
      reason: 'VITE_SUPABASE_ANON_KEY is a SECRET key. Remove it now and use the publishable/anon key instead.',
    };
  }
  return { state: 'configured', url: url.replace(/\/+$/, ''), anonKey };
}

const DEFAULT_MAP_STYLE_URL_DARK = 'https://tiles.openfreemap.org/styles/dark';
const DEFAULT_GEOCODER_ENDPOINT = '/api/geocode';

function readUrl(value: string | undefined, fallback: string): string {
  const v = clean(value);
  return v && isHttpUrl(v) ? v : fallback;
}

function readGeocoderEndpoint(): string {
  const v = clean(import.meta.env.VITE_GEOCODER_ENDPOINT);
  // Allow a same-site path ("/api/geocode") or a full https URL.
  return v && (v.startsWith('/') || isHttpUrl(v)) ? v : DEFAULT_GEOCODER_ENDPOINT;
}

const mapStyleUrl = readUrl(import.meta.env.VITE_MAP_STYLE_URL, DEFAULT_MAP_STYLE_URL);

export const env = {
  mode: import.meta.env.MODE,
  isDev: import.meta.env.DEV,
  supabase: readSupabaseConfig(),
  mapStyleUrl,
  mapStyleUrlDark: readUrl(import.meta.env.VITE_MAP_STYLE_URL_DARK, DEFAULT_MAP_STYLE_URL_DARK),
  usingDefaultMapStyle: mapStyleUrl === DEFAULT_MAP_STYLE_URL,
  geocoder: {
    enabled: clean(import.meta.env.VITE_GEOCODER_ENABLED).toLowerCase() !== 'false',
    endpoint: readGeocoderEndpoint(),
  },
} as const;

if (env.isDev && env.supabase.state === 'invalid') {
  console.warn(`[LAKBAY] Supabase config problem: ${env.supabase.reason}`);
}
