/**
 * Fills in the municipality/province of stops and terminals that lie OUTSIDE
 * the imported areas (e.g. Metro Manila stops of a Bulacan route), using the
 * official OpenStreetMap administrative boundaries.
 *
 * This is a geometric lookup on real boundary data, never a guess from the
 * stop's name. Points that fall in no boundary stay unknown, and the result is
 * recorded in attributes.municipality_source so the reviewer can see where it
 * came from (and edit it).
 */
import type { OverpassResponse } from './overpass';
import type { DraftCandidate } from './types';

/** Lookups are limited to the pilot corridor (Bulacan to Metro Manila). */
export const LOOKUP_BBOX = { south: 14.5, west: 120.85, north: 14.95, east: 121.15 };

type Segment = [number, number, number, number]; // lon1, lat1, lon2, lat2

export interface Boundary {
  id: number;
  name: string;
  level: number;
  segments: Segment[];
  box: { minLon: number; minLat: number; maxLon: number; maxLat: number };
}

export function boundaryQuery(bbox = LOOKUP_BBOX): string {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return [
    '[out:json][timeout:180];',
    '(',
    `  rel["boundary"="administrative"]["admin_level"~"^(4|6)$"](${b});`,
    '  rel["boundary"="administrative"]["admin_level"="3"]["name"="Metro Manila"];',
    ');',
    'out geom;',
  ].join('\n');
}

export function boundariesFromOverpass(data: OverpassResponse): Boundary[] {
  const result: Boundary[] = [];
  for (const el of data.elements) {
    if (el.type !== 'relation' || !el.tags?.name) continue;
    const level = Number(el.tags.admin_level);
    const segments: Segment[] = [];
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const m of el.members ?? []) {
      if (m.type !== 'way' || !m.geometry || !/^(outer|inner|)$/.test(m.role)) continue;
      for (let i = 1; i < m.geometry.length; i++) {
        const a = m.geometry[i - 1];
        const c = m.geometry[i];
        segments.push([a.lon, a.lat, c.lon, c.lat]);
        minLon = Math.min(minLon, a.lon, c.lon);
        maxLon = Math.max(maxLon, a.lon, c.lon);
        minLat = Math.min(minLat, a.lat, c.lat);
        maxLat = Math.max(maxLat, a.lat, c.lat);
      }
    }
    if (segments.length) result.push({ id: el.id, name: el.tags.name, level, segments, box: { minLon, minLat, maxLon, maxLat } });
  }
  return result;
}

/**
 * Even-odd test over all boundary segments. Works without assembling rings,
 * because outer and inner rings are closed: each crossing flips in/out.
 */
export function containsPoint(b: Boundary, lon: number, lat: number): boolean {
  if (lon < b.box.minLon || lon > b.box.maxLon || lat < b.box.minLat || lat > b.box.maxLat) return false;
  let inside = false;
  for (const [x1, y1, x2, y2] of b.segments) {
    if (y1 > lat !== y2 > lat && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

function inBox(lon: number, lat: number, bbox = LOOKUP_BBOX) {
  return lat >= bbox.south && lat <= bbox.north && lon >= bbox.west && lon <= bbox.east;
}

/** Candidates (not routes) without a municipality that the lookup could help. */
export function needsBoundaryLookup(d: DraftCandidate): boolean {
  return d.kind !== 'route' && !d.municipality && d.lon != null && d.lat != null && inBox(d.lon, d.lat);
}

/** Sets municipality/province from the boundaries. Returns how many were filled. */
export function assignFromBoundaries(drafts: DraftCandidate[], boundaries: Boundary[]): number {
  const towns = boundaries.filter((b) => b.level === 6);
  const provinces = boundaries.filter((b) => b.level === 4);
  const regions = boundaries.filter((b) => b.level === 3);
  let filled = 0;
  for (const d of drafts) {
    if (!needsBoundaryLookup(d)) continue;
    const town = towns.filter((b) => containsPoint(b, d.lon!, d.lat!));
    if (town.length !== 1) continue; // none, or ambiguous: leave it to the reviewer
    const province = provinces.find((b) => containsPoint(b, d.lon!, d.lat!)) ?? regions.find((b) => containsPoint(b, d.lon!, d.lat!));
    d.municipality = town[0].name;
    d.province = province?.name ?? null;
    d.attributes = {
      ...d.attributes,
      municipality_source: `OpenStreetMap boundary relation/${town[0].id}${province ? ` and relation/${province.id}` : ''}`,
    };
    filled++;
  }
  return filled;
}
