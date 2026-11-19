/**
 * Database side of the pipeline. Signs in as a moderator/admin user and
 * calls the RPC functions from migration 20261120000700_data_acquisition.sql.
 * All permission checks happen in the database.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImportAreaConfig } from '../config/areas';
import { readDbEnv } from './env';
import type { Candidate } from './types';

const BATCH_SIZE = 200;

export async function connect(): Promise<SupabaseClient> {
  const env = readDbEnv();
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: true },
  });
  const { error } = await client.auth.signInWithPassword({ email: env.email, password: env.password });
  if (error) throw new Error(`Could not sign in as ${env.email}: ${error.message}`);
  return client;
}

function fail(step: string, error: { message: string; code?: string } | null): never {
  throw new Error(`${step} failed: ${error?.message ?? 'unknown error'}${error?.code ? ` (${error.code})` : ''}`);
}

export async function upsertArea(client: SupabaseClient, area: ImportAreaConfig, relationId: number | null) {
  const { error } = await client.rpc('upsert_import_area', {
    p_code: area.code,
    p_name: area.name,
    p_municipality: area.municipality,
    p_province: area.province,
    p_region: area.region,
    p_admin_level: area.osm.adminLevel,
    p_parent_name: area.osm.parentName,
    p_parent_level: area.osm.parentAdminLevel,
    p_relation_id: relationId,
  });
  if (error) fail('Saving import area', error);
}

export async function startRun(
  client: SupabaseClient,
  providerCode: string,
  runKind: 'osm_overpass' | 'gtfs' | 'csv',
  params: Record<string, unknown>,
  areaCode: string | null = null,
): Promise<string> {
  const { data, error } = await client.rpc('start_import_run', {
    p_provider_code: providerCode,
    p_area_code: areaCode,
    p_run_kind: runKind,
    p_params: params,
  });
  if (error) fail('Starting the import run', error);
  return data as string;
}

export interface UploadTotals {
  inserted: number;
  updated: number;
  unchanged: number;
  changed_after_review: number;
}

export async function uploadCandidates(
  client: SupabaseClient,
  runId: string,
  candidates: Candidate[],
  log: (m: string) => void,
): Promise<UploadTotals> {
  const totals: UploadTotals = { inserted: 0, updated: 0, unchanged: 0, changed_after_review: 0 };
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const { data, error } = await client.rpc('upsert_staged_features', { p_run_id: runId, p_features: batch });
    if (error) fail(`Uploading candidates ${i + 1}-${i + batch.length}`, error);
    const r = data as UploadTotals;
    totals.inserted += r.inserted;
    totals.updated += r.updated;
    totals.unchanged += r.unchanged;
    totals.changed_after_review += r.changed_after_review;
    log(`  uploaded ${Math.min(i + BATCH_SIZE, candidates.length)}/${candidates.length}`);
  }
  return totals;
}

export async function matchRun(client: SupabaseClient, runId: string): Promise<number> {
  const { data, error } = await client.rpc('match_staged_run', { p_run_id: runId });
  if (error) fail('Matching against existing LAKBAY records', error);
  return data as number;
}

export async function finishRun(
  client: SupabaseClient,
  runId: string,
  status: 'completed' | 'failed',
  stats: Record<string, unknown>,
  snapshotSha256: string | null,
  upstreamTimestamp: string | null,
  errorText: string | null = null,
) {
  const { error } = await client.rpc('finish_import_run', {
    p_run_id: runId,
    p_status: status,
    p_stats: stats,
    p_snapshot_sha256: snapshotSha256,
    p_upstream_timestamp: upstreamTimestamp,
    p_error: errorText,
  });
  if (error) fail('Finishing the import run', error);
}
