/**
 * Supabase client setup.
 *
 * LAKBAY is "static-first": the public app must work even when Supabase is
 * not configured or the free project is paused. So:
 *  - the client is created only when the env values are valid;
 *  - the library is loaded lazily (only when something actually needs it),
 *    which keeps the first page load small.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let clientPromise: Promise<SupabaseClient | null> | null = null;

/** Returns the shared Supabase client, or null when Supabase is not configured. */
export function getSupabase(): Promise<SupabaseClient | null> {
  const config = env.supabase;
  if (config.state !== 'configured') return Promise.resolve(null);

  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      }),
    );
  }
  return clientPromise;
}

export type ConnectionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Checks that the Supabase project answers. Uses the Auth health endpoint,
 * which works before any tables exist. A paused free project will fail here.
 */
export async function testSupabaseConnection(timeoutMs = 8000): Promise<ConnectionResult> {
  const config = env.supabase;
  if (config.state === 'not-configured') {
    return { ok: false, message: 'Supabase is not configured (this is fine for Milestone 1).' };
  }
  if (config.state === 'invalid') {
    return { ok: false, message: config.reason };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.url}/auth/v1/health`, {
      headers: { apikey: config.anonKey },
      signal: controller.signal,
    });
    if (response.ok) return { ok: true, message: 'Supabase answered. Connection works.' };
    return {
      ok: false,
      message: `Supabase answered with HTTP ${response.status}. Check the URL and key, or whether the project is paused.`,
    };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    return {
      ok: false,
      message: aborted
        ? 'No answer within 8 seconds. The project may be paused, or you are offline.'
        : 'Could not reach Supabase. Check your internet connection and the project URL.',
    };
  } finally {
    clearTimeout(timer);
  }
}
