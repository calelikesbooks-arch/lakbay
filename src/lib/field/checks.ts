/**
 * Field verification (migration 20261121000800_field_verification.sql).
 * The database re-checks everything: role, GPS accuracy, distance, dates.
 * The limits below only mirror private.field_rules() to give early feedback.
 */
import { getSupabase } from '../supabase';
import type { GpsFix } from './useFieldGps';

export const FIELD_RULES = {
  maxAccuracy: { stop: 35, terminal: 60 },
  tolerance: { stop: 30, terminal: 120 },
  maxMove: 500,
} as const;

export type RecordStatus = 'draft' | 'pending_review' | 'verified' | 'needs_recheck' | 'retired';
export type Outcome = 'confirmed' | 'moved' | 'not_found' | 'closed' | 'unsure';

export interface NearbyRecord {
  kind: 'terminal' | 'stop';
  id: string;
  name: string;
  subtype: string;
  municipality: string;
  status: RecordStatus;
  last_verified_on: string | null;
  next_review_on: string | null;
  lon: number;
  lat: number;
  distance_m: number;
  due: boolean;
}

export interface RouteToRide {
  variant_id: string;
  route_id: string;
  route_name: string;
  mode_code: string;
  direction: string;
  variant_name: string;
  signboard_text: string | null;
  variant_status: RecordStatus;
  route_status: RecordStatus;
  last_verified_on: string | null;
  next_review_on: string | null;
  has_geometry: boolean;
  stops: { seq: number; id: string; name: string; status: RecordStatus }[];
}

export interface CheckResult {
  check_id: string;
  status_before: RecordStatus;
  status_after: RecordStatus;
  distance_m: number | null;
  messages: string[];
}

async function client() {
  const c = await getSupabase();
  if (!c) throw new Error('The LAKBAY database is not connected.');
  return c;
}

export async function fetchNearby(fix: GpsFix, radiusM: number): Promise<NearbyRecord[]> {
  const c = await client();
  const { data, error } = await c.rpc('field_check_nearby', { p_lon: fix.lon, p_lat: fix.lat, p_radius_m: radiusM });
  if (error) throw new Error(error.message);
  return (data ?? []) as NearbyRecord[];
}

export async function fetchRoutes(search: string): Promise<RouteToRide[]> {
  const c = await client();
  const { data, error } = await c.rpc('field_check_routes', { p_search: search.trim() || null });
  if (error) throw new Error(error.message);
  return (data ?? []) as RouteToRide[];
}

export interface PlaceCheckInput {
  kind: 'terminal' | 'stop';
  id: string;
  outcome: Outcome;
  fix: GpsFix | null;
  signboard: string;
  notes: string;
}

export interface RideCheckInput {
  variantId: string;
  outcome: Outcome;
  fix: GpsFix | null;
  boardedStopId: string | null;
  alightedStopId: string | null;
  farePaid: number | null;
  lineMatches: boolean | null;
  signboard: string;
  notes: string;
}

async function submit(args: Record<string, unknown>): Promise<CheckResult> {
  const c = await client();
  const { data, error } = await c.rpc('submit_field_check', args);
  if (error) throw new Error(error.message);
  return data as CheckResult;
}

export function submitPlaceCheck(input: PlaceCheckInput): Promise<CheckResult> {
  return submit({
    p_target_kind: input.kind,
    p_target_id: input.id,
    p_outcome: input.outcome,
    p_observed_at: new Date().toISOString(),
    p_lon: input.fix?.lon ?? null,
    p_lat: input.fix?.lat ?? null,
    p_accuracy_m: input.fix?.accuracy ?? null,
    p_signboard_text: input.signboard.trim() || null,
    p_notes: input.notes.trim() || null,
  });
}

export function submitRideCheck(input: RideCheckInput): Promise<CheckResult> {
  return submit({
    p_target_kind: 'route_variant',
    p_target_id: input.variantId,
    p_outcome: input.outcome,
    p_observed_at: new Date().toISOString(),
    p_lon: input.fix?.lon ?? null,
    p_lat: input.fix?.lat ?? null,
    p_accuracy_m: input.fix?.accuracy ?? null,
    p_signboard_text: input.signboard.trim() || null,
    p_fare_paid: input.farePaid,
    p_boarded_stop_id: input.boardedStopId,
    p_alighted_stop_id: input.alightedStopId,
    p_line_matches: input.lineMatches,
    p_notes: input.notes.trim() || null,
  });
}

export const statusLabel: Record<RecordStatus, string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  verified: 'Verified',
  needs_recheck: 'Needs re-check',
  retired: 'Retired',
};
