/**
 * Sign-in for LAKBAY staff (moderators/admins). Regular commuters do not
 * need an account. Uses Supabase Auth with email + password.
 */
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

export type SessionState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; session: Session | null };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    getSupabase().then((client) => {
      if (cancelled) return;
      if (!client) {
        setState({ status: 'unavailable' });
        return;
      }
      client.auth.getSession().then(({ data }) => !cancelled && setState({ status: 'ready', session: data.session }));
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        if (!cancelled) setState({ status: 'ready', session });
      });
      unsubscribe = () => data.subscription.unsubscribe();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return state;
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const client = await getSupabase();
  if (!client) return 'The LAKBAY database is not connected.';
  const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  return error ? 'Wrong email or password, or the account is not confirmed.' : null;
}

export async function signOut(): Promise<void> {
  const client = await getSupabase();
  await client?.auth.signOut();
}

/** Roles of the signed-in user (RLS only returns the user's own roles). */
export async function fetchMyRoles(userId: string): Promise<string[]> {
  const client = await getSupabase();
  if (!client) return [];
  const { data, error } = await client.from('user_roles').select('role').eq('user_id', userId);
  if (error) return [];
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}
