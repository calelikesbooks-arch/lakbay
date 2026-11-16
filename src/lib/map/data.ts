/**
 * Reads map data from Supabase (migration 20261117000600_map_queries.sql).
 * Row Level Security makes sure the public only receives VERIFIED records.
 * Nothing here invents or fills in locations.
 */
import type { Feature, LineString } from 'geojson';
import { getSupabase } from '../supabase';
import type { Source, SourceType, Verification } from '../../types/transport';
import type { Bbox } from './config';

export type RecordStatus = 'draft' | 'pending_review' | 'verified' | 'needs_recheck' | 'retired';

export interface MapLocation {
  kind: 'terminal' | 'stop';
  id: string;
  name: string;
  subtype: string;
  municipality: string;
  status: RecordStatus;
  lastVerifiedOn: string | null;
  lon: number;
  lat: number;
  terminalId: string | null;
  modes: string[];
}

export interface TransportModeInfo {
  code: string;
  label: string;
  category: string;
}

export type DataResult<T> = { ok: true; data: T } | { ok: false; reason: 'not_configured' | 'error' | 'aborted'; message: string };

const notConfigured = <T>(): DataResult<T> => ({
  ok: false,
  reason: 'not_configured',
  message: 'The LAKBAY database is not connected.',
});

function failure<T>(error: { message?: string; code?: string } | null, signal?: AbortSignal): DataResult<T> {
  if (signal?.aborted) return { ok: false, reason: 'aborted', message: 'Cancelled' };
  console.error('[LAKBAY] map data error:', error);
  return { ok: false, reason: 'error', message: 'Could not load map data. Please try again.' };
}

export function toVerification(status: RecordStatus, lastVerifiedOn: string | null): Verification {
  const level = status === 'verified' ? 'verified' : status === 'needs_recheck' ? 'needs_recheck' : 'unverified';
  return { level, lastVerified: lastVerifiedOn ?? undefined };
}

interface LocationRow {
  kind: 'terminal' | 'stop';
  id: string;
  name: string;
  subtype: string;
  municipality: string;
  status: RecordStatus;
  last_verified_on: string | null;
  lon: number;
  lat: number;
  terminal_id: string | null;
  modes: string[] | null;
}

export async function fetchLocationsInBbox(bbox: Bbox, signal?: AbortSignal): Promise<DataResult<MapLocation[]>> {
  const client = await getSupabase();
  if (!client) return notConfigured();
  const [w, s, e, n] = bbox;
  let request = client.rpc('map_locations_in_bbox', { p_west: w, p_south: s, p_east: e, p_north: n, p_limit: 600 });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) return failure(error, signal);
  const rows = (data ?? []) as LocationRow[];
  return {
    ok: true,
    data: rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      name: r.name,
      subtype: r.subtype,
      municipality: r.municipality,
      status: r.status,
      lastVerifiedOn: r.last_verified_on,
      lon: r.lon,
      lat: r.lat,
      terminalId: r.terminal_id,
      modes: r.modes ?? [],
    })),
  };
}

export async function fetchLocationCounts(): Promise<DataResult<{ terminals: number; stops: number }>> {
  const client = await getSupabase();
  if (!client) return notConfigured();
  const { data, error } = await client.rpc('map_location_counts');
  if (error) return failure(error);
  const row = (Array.isArray(data) ? data[0] : data) as { terminals: number; stops: number } | undefined;
  return { ok: true, data: { terminals: Number(row?.terminals ?? 0), stops: Number(row?.stops ?? 0) } };
}

export async function fetchModes(): Promise<DataResult<TransportModeInfo[]>> {
  const client = await getSupabase();
  if (!client) return notConfigured();
  const { data, error } = await client
    .from('transport_modes')
    .select('code, label, category')
    .eq('is_active', true)
    .order('sort_order');
  if (error) return failure(error);
  return { ok: true, data: (data ?? []) as TransportModeInfo[] };
}

export interface LocationSearchHit {
  kind: 'terminal' | 'stop';
  id: string;
  name: string;
  municipality: string;
  status: RecordStatus;
  lon: number;
  lat: number;
}

export async function searchLocations(query: string, signal?: AbortSignal): Promise<DataResult<LocationSearchHit[]>> {
  const client = await getSupabase();
  if (!client) return notConfigured();
  let request = client.rpc('search_locations', { p_query: query, p_limit: 6 });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) return failure(error, signal);
  return { ok: true, data: (data ?? []) as LocationSearchHit[] };
}

// ---------- Details panel ----------------------------------------------

export interface LocationDetail {
  kind: 'terminal' | 'stop';
  id: string;
  name: string;
  altNames: string[];
  subtype: string;
  municipality: string;
  province: string;
  address?: string | null;
  landmark?: string | null;
  operatingHours?: string | null;
  notes?: string | null;
  status: RecordStatus;
  lastVerifiedOn: string | null;
  nextReviewOn: string | null;
  sources: Source[];
}

export interface ServingRoute {
  variantId: string;
  routeId: string;
  routeName: string;
  modeCode: string;
  modeLabel: string;
  direction: string;
  variantName: string;
  signboard: string | null;
  status: RecordStatus;
  lastVerifiedOn: string | null;
  hasGeometry: boolean;
}

const sourceTypes: SourceType[] = ['field_survey', 'official_document', 'operator', 'openstreetmap', 'community', 'news', 'other'];

interface EvidenceRow {
  source: {
    id: string;
    source_type: string;
    title: string;
    url: string | null;
    published_on: string | null;
    observed_on: string | null;
  } | null;
}

export async function fetchLocationDetail(kind: 'terminal' | 'stop', id: string): Promise<DataResult<LocationDetail | null>> {
  const client = await getSupabase();
  if (!client) return notConfigured();

  const table = kind === 'terminal' ? 'terminals' : 'stops';
  const columns =
    kind === 'terminal'
      ? 'id, name, alt_names, terminal_kind, municipality, province, address_text, landmark_text, operating_hours, notes, status, last_verified_on, next_review_on'
      : 'id, name, alt_names, stop_kind, municipality, province, landmark_text, notes, status, last_verified_on, next_review_on';

  const [record, evidence] = await Promise.all([
    client.from(table).select(columns).eq('id', id).maybeSingle(),
    client
      .from('evidence')
      .select('source:sources(id, source_type, title, url, published_on, observed_on)')
      .eq(kind === 'terminal' ? 'terminal_id' : 'stop_id', id),
  ]);
  if (record.error) return failure(record.error);
  if (!record.data) return { ok: true, data: null };

  const r = record.data as unknown as Record<string, unknown>;
  const sources: Source[] = ((evidence.data ?? []) as unknown as EvidenceRow[])
    .map((row) => row.source)
    .filter((s): s is NonNullable<EvidenceRow['source']> => !!s)
    .map((s) => ({
      id: s.id,
      type: (sourceTypes as string[]).includes(s.source_type) ? (s.source_type as SourceType) : 'other',
      title: s.title,
      url: s.url ?? undefined,
      observedOn: s.observed_on ?? s.published_on ?? '',
    }));

  return {
    ok: true,
    data: {
      kind,
      id: String(r.id),
      name: String(r.name),
      altNames: (r.alt_names as string[] | null) ?? [],
      subtype: String(r.terminal_kind ?? r.stop_kind ?? ''),
      municipality: String(r.municipality),
      province: String(r.province),
      address: (r.address_text as string | null) ?? null,
      landmark: (r.landmark_text as string | null) ?? null,
      operatingHours: (r.operating_hours as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      status: r.status as RecordStatus,
      lastVerifiedOn: (r.last_verified_on as string | null) ?? null,
      nextReviewOn: (r.next_review_on as string | null) ?? null,
      sources,
    },
  };
}

interface ServingRow {
  variant_id: string;
  route_id: string;
  route_name: string;
  mode_code: string;
  mode_label: string;
  direction: string;
  variant_name: string;
  signboard_text: string | null;
  status: RecordStatus;
  last_verified_on: string | null;
  has_geometry: boolean;
}

export async function fetchRoutesServing(kind: 'terminal' | 'stop', id: string): Promise<DataResult<ServingRoute[]>> {
  const client = await getSupabase();
  if (!client) return notConfigured();
  const { data, error } = await client.rpc(
    'routes_serving',
    kind === 'terminal' ? { p_terminal_id: id } : { p_stop_id: id },
  );
  if (error) return failure(error);
  return {
    ok: true,
    data: ((data ?? []) as ServingRow[]).map((r) => ({
      variantId: r.variant_id,
      routeId: r.route_id,
      routeName: r.route_name,
      modeCode: r.mode_code,
      modeLabel: r.mode_label,
      direction: r.direction,
      variantName: r.variant_name,
      signboard: r.signboard_text,
      status: r.status,
      lastVerifiedOn: r.last_verified_on,
      hasGeometry: r.has_geometry,
    })),
  };
}

export type RouteFeature = Feature<LineString, { variant_id: string; mode_code: string; length_m: number | null }>;

export async function fetchRouteGeometry(variantId: string): Promise<DataResult<RouteFeature | null>> {
  const client = await getSupabase();
  if (!client) return notConfigured();
  const { data, error } = await client.rpc('route_variant_geojson', { p_variant_id: variantId });
  if (error) return failure(error);
  const feature = data as RouteFeature | null;
  return { ok: true, data: feature && feature.geometry?.type === 'LineString' ? feature : null };
}
