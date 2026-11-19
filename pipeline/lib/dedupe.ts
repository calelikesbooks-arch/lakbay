/**
 * Duplicate detection INSIDE one import batch.
 * OpenStreetMap often describes one stop several times (bus_stop node,
 * platform, stop_position). We keep the best one and point the others at it.
 * Nothing is deleted: duplicates stay in the review queue with a warning.
 *
 * (Duplicates against records ALREADY in LAKBAY are found by the database:
 *  public.match_staged_run.)
 */
import { distanceMeters } from './geo';
import { nameKey, similarity } from './text';
import type { DraftCandidate } from './types';

export interface DedupeOptions {
  stopRadiusM: number;
  terminalRadiusM: number;
  minNameSimilarity: number;
}

export const DEFAULT_DEDUPE: DedupeOptions = { stopRadiusM: 25, terminalRadiusM: 80, minNameSimilarity: 0.6 };

/** Returns external_id → external_id of the representative it duplicates. */
export function findBatchDuplicates(
  candidates: (DraftCandidate & { attributes: { priority?: number } })[],
  options: DedupeOptions = DEFAULT_DEDUPE,
): Map<string, string> {
  const points = candidates.filter((c) => c.kind !== 'route' && c.lon !== null && c.lat !== null);

  // Grid buckets (~110 m) so we only compare nearby points.
  const cell = 0.001;
  const grid = new Map<string, number[]>();
  const keyOf = (lon: number, lat: number) => `${Math.floor(lon / cell)}:${Math.floor(lat / cell)}`;
  points.forEach((c, i) => {
    const k = keyOf(c.lon!, c.lat!);
    grid.set(k, [...(grid.get(k) ?? []), i]);
  });

  // Union-find
  const parent = points.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  points.forEach((a, i) => {
    const cx = Math.floor(a.lon! / cell);
    const cy = Math.floor(a.lat! / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (j <= i) continue;
          const b = points[j];
          if (a.kind !== b.kind) continue;
          const radius = a.kind === 'terminal' ? options.terminalRadiusM : options.stopRadiusM;
          if (distanceMeters([a.lon!, a.lat!], [b.lon!, b.lat!]) > radius) continue;
          const sameName = nameKey(a.name) !== '' && nameKey(a.name) === nameKey(b.name);
          const similar = similarity(a.name, b.name) >= options.minNameSimilarity;
          const oneUnnamed = !a.name || !b.name;
          if (sameName || similar || oneUnnamed) union(i, j);
        }
      }
    }
  });

  // Pick a representative per group: higher priority, then named, then more tags.
  const groups = new Map<number, number[]>();
  points.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });

  const result = new Map<string, string>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const score = (c: DraftCandidate & { attributes: { priority?: number } }) =>
      (c.attributes.priority ?? 0) * 1000 + (c.name ? 100 : 0) + Object.keys(c.raw_tags).length;
    const sorted = [...members].sort((x, y) => score(points[y]) - score(points[x]) || points[x].external_id.localeCompare(points[y].external_id));
    const rep = points[sorted[0]].external_id;
    for (const idx of sorted.slice(1)) result.set(points[idx].external_id, rep);
  }
  return result;
}
