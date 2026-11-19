/**
 * Shared types for the LAKBAY import pipeline.
 * A "candidate" is something a provider says MAY be a terminal, stop or
 * route. It is never treated as fact until a person reviews it.
 */

export type CandidateKind = 'terminal' | 'stop' | 'route';
export type Severity = 'blocker' | 'warning';
export type Quality = 'ok' | 'warning' | 'blocked';
export type ModeConfidence = 'tagged' | 'inferred' | 'unknown';

export interface Issue {
  code: string;
  severity: Severity;
  message: string;
}

export interface LineStringGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface RouteMember {
  external_id: string;
  role: string;
}

/** Matches what public.upsert_staged_features expects (snake_case on purpose). */
export interface Candidate {
  external_id: string;
  external_url: string | null;
  kind: CandidateKind;
  /** terminal: terminal_kind; stop: stop_kind; route: 'route' */
  classification: string;
  name: string | null;
  alt_names: string[];
  ref: string | null;
  operator_name: string | null;
  network: string | null;
  from_label: string | null;
  to_label: string | null;
  /** Possible transport_modes codes. Hints only. */
  mode_hints: string[];
  mode_confidence: ModeConfidence;
  area_code: string | null;
  municipality: string | null;
  province: string | null;
  lon: number | null;
  lat: number | null;
  path: LineStringGeometry | null;
  path_complete: boolean | null;
  members: RouteMember[];
  raw_tags: Record<string, string>;
  attributes: Record<string, unknown>;
  issues: Issue[];
  quality: Quality;
  upstream_version: string | null;
  upstream_timestamp: string | null;
  content_hash: string;
  batch_duplicate_of: string | null;
}

/** A candidate before validation/hashing fills in the computed fields. */
export type DraftCandidate = Omit<Candidate, 'issues' | 'quality' | 'content_hash' | 'batch_duplicate_of'> & {
  issues?: Issue[];
};

export const TERMINAL_KINDS = ['terminal', 'transport_hub', 'rail_station', 'loading_bay'] as const;
export const STOP_KINDS = ['designated_stop', 'loading_area', 'rail_station', 'terminal_bay', 'informal_stop'] as const;

/** Mirror of public.transport_modes codes (migration 1). */
export const MODE_CODES = [
  'jeepney', 'modern_jeepney', 'city_bus', 'provincial_bus', 'p2p_bus', 'uv_express',
  'tricycle', 'e_trike', 'lrt', 'mrt', 'commuter_rail', 'ferry',
] as const;

export function emptyDraft(partial: Partial<DraftCandidate> & Pick<DraftCandidate, 'external_id' | 'kind' | 'classification'>): DraftCandidate {
  return {
    external_url: null,
    name: null,
    alt_names: [],
    ref: null,
    operator_name: null,
    network: null,
    from_label: null,
    to_label: null,
    mode_hints: [],
    mode_confidence: 'unknown',
    area_code: null,
    municipality: null,
    province: null,
    lon: null,
    lat: null,
    path: null,
    path_complete: null,
    members: [],
    raw_tags: {},
    attributes: {},
    upstream_version: null,
    upstream_timestamp: null,
    ...partial,
  };
}
