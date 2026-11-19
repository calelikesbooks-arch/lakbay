/**
 * Admin review queue (migration 20261120000700_data_acquisition.sql).
 * Every action is checked again in the database (moderators/admins only).
 */
import { getSupabase } from '../supabase';

export interface QueueIssue {
  code: string;
  severity: 'blocker' | 'warning';
  message: string;
}

export interface QueueItem {
  id: string;
  kind: 'terminal' | 'stop' | 'route';
  classification: string;
  name: string | null;
  alt_names: string[];
  ref: string | null;
  from_label: string | null;
  to_label: string | null;
  mode_hints: string[];
  mode_confidence: 'tagged' | 'inferred' | 'unknown';
  quality: 'ok' | 'warning' | 'blocked';
  issues: QueueIssue[];
  issue_count: number;
  review_status: 'pending' | 'needs_info' | 'promoted' | 'linked' | 'rejected';
  changed_since_review: boolean;
  missing_upstream: boolean;
  provider_code: string;
  provider_name: string;
  attribution_text: string;
  external_id: string;
  external_url: string | null;
  area_code: string | null;
  municipality: string | null;
  province: string | null;
  lon: number | null;
  lat: number | null;
  has_path: boolean;
  path_complete: boolean | null;
  member_count: number;
  batch_duplicate_of: string | null;
  matched_table: string | null;
  matched_id: string | null;
  match_distance_m: number | null;
  match_name_similarity: number | null;
  matched_name: string | null;
  raw_tags: Record<string, string>;
  upstream_timestamp: string | null;
  last_seen_at: string;
  review_notes: string | null;
}

export interface QueueFilter {
  kind: 'all' | 'terminal' | 'stop' | 'route';
  quality: 'all' | 'ok' | 'warning' | 'blocked';
}

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

async function client() {
  const c = await getSupabase();
  if (!c) throw new Error('The LAKBAY database is not connected.');
  return c;
}

export async function fetchQueue(filter: QueueFilter): Promise<QueueItem[]> {
  const c = await client();
  let query = c.from('admin_review_queue').select('*').limit(200);
  if (filter.kind !== 'all') query = query.eq('kind', filter.kind);
  if (filter.quality !== 'all') query = query.eq('quality', filter.quality);
  const { data, error } = await query.order('changed_since_review', { ascending: false }).order('quality').order('kind');
  if (error) throw new Error(error.message);
  return (data ?? []) as QueueItem[];
}

async function rpc(fn: string, args: Record<string, unknown>, success: string): Promise<ActionResult> {
  const c = await client();
  const { data, error } = await c.rpc(fn, args);
  if (error) return { ok: false, message: error.message };
  if (fn === 'promote_staged_route' && data) {
    const r = data as { stops_linked: number; stops_skipped: number; geometry_added: boolean };
    return {
      ok: true,
      message: `${success} ${r.stops_linked} stops linked, ${r.stops_skipped} skipped (promote their stops first), line ${r.geometry_added ? 'added' : 'not available'}.`,
    };
  }
  return { ok: true, message: success };
}

export const reviewActions = {
  promote: (id: string, municipality: string, province: string, notes: string) =>
    rpc('promote_staged_feature', { p_staged_id: id, p_municipality: municipality || null, p_province: province || null, p_notes: notes || null },
      'Created as a DRAFT record with the import cited as evidence.'),
  promoteRoute: (id: string, mode: string, direction: string, notes: string) =>
    rpc('promote_staged_route', { p_staged_id: id, p_mode_code: mode, p_direction: direction, p_notes: notes || null },
      'Created a DRAFT route.'),
  link: (id: string, targetId: string, notes: string) =>
    rpc('link_staged_feature', { p_staged_id: id, p_target_id: targetId, p_notes: notes || null },
      'Linked to the existing record and cited as evidence.'),
  needsInfo: (id: string, note: string) => rpc('mark_staged_needs_info', { p_staged_id: id, p_note: note }, 'Marked as needing more information.'),
  reject: (id: string, reason: string) => rpc('reject_staged_feature', { p_staged_id: id, p_reason: reason }, 'Rejected.'),
};

export interface ProviderRow {
  code: string;
  name: string;
  provider_type: string;
  license_name: string;
  attribution_text: string;
  usage_status: 'approved' | 'restricted' | 'pending_review' | 'rejected';
  can_verify: boolean;
  usage_notes: string | null;
  homepage_url: string | null;
}

export async function fetchProviders(): Promise<ProviderRow[]> {
  const c = await client();
  const { data, error } = await c.from('data_providers').select('*').order('usage_status').order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as ProviderRow[];
}

export interface RunRow {
  id: string;
  provider_code: string;
  run_kind: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  stats: Record<string, unknown>;
  params: Record<string, unknown>;
  error: string | null;
}

export async function fetchRuns(): Promise<RunRow[]> {
  const c = await client();
  const { data, error } = await c.from('import_runs').select('*').order('started_at', { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as RunRow[];
}

/** Active transport modes for the route mode picker. */
export async function fetchModeOptions(): Promise<{ code: string; label: string }[]> {
  const c = await client();
  const { data } = await c.from('transport_modes').select('code, label').eq('is_active', true).order('sort_order');
  return (data ?? []) as { code: string; label: string }[];
}
