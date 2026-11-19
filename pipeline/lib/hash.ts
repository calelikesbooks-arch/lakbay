import { createHash } from 'node:crypto';
import type { DraftCandidate } from './types';

export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

/** JSON with sorted keys, so the same content always gives the same hash. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * Hash of everything that matters for review. If it changes between runs,
 * the database flags the candidate as changed upstream.
 * (Timestamps/versions are excluded: a re-save with no real change is not a change.)
 */
export function contentHash(c: DraftCandidate): string {
  return sha256(
    stableStringify({
      kind: c.kind,
      classification: c.classification,
      name: c.name,
      alt_names: c.alt_names,
      ref: c.ref,
      operator_name: c.operator_name,
      network: c.network,
      from_label: c.from_label,
      to_label: c.to_label,
      mode_hints: c.mode_hints,
      lon: c.lon === null ? null : Number(c.lon.toFixed(7)),
      lat: c.lat === null ? null : Number(c.lat.toFixed(7)),
      path: c.path?.coordinates.map(([x, y]) => [Number(x.toFixed(7)), Number(y.toFixed(7))]) ?? null,
      members: c.members,
      raw_tags: c.raw_tags,
    }),
  );
}
