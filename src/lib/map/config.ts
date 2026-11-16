/**
 * Map view settings. These are VIEW extents (where the camera looks),
 * not transport data.
 */
export type Bbox = [west: number, south: number, east: number, north: number];

/** Default view: approximately Bocaue/Marilao/Meycauayan down to Cubao. */
export const PILOT_BOUNDS: Bbox = [120.88, 14.6, 121.07, 14.83];

/** Users can't pan far outside the Philippines. */
export const PH_MAX_BOUNDS: Bbox = [114.0, 4.0, 127.5, 21.5];

/** Below this zoom we don't ask the database for terminals and stops. */
export const MIN_DATA_ZOOM = 11;

/** Must stay below the 1 square degree limit in map_locations_in_bbox. */
export const MAX_QUERY_AREA_DEG2 = 0.95;

/** Grows a box by a fraction on every side (pre-loads just outside the screen). */
export function padBbox([w, s, e, n]: Bbox, fraction: number): Bbox {
  const dx = (e - w) * fraction;
  const dy = (n - s) * fraction;
  return [Math.max(-180, w - dx), Math.max(-90, s - dy), Math.min(180, e + dx), Math.min(90, n + dy)];
}

export function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

export function bboxArea([w, s, e, n]: Bbox): number {
  return (e - w) * (n - s);
}

/** Bounding box around a list of [lon, lat] positions. */
export function bboxOf(points: [number, number][]): Bbox | null {
  if (points.length === 0) return null;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of points) {
    w = Math.min(w, lon);
    s = Math.min(s, lat);
    e = Math.max(e, lon);
    n = Math.max(n, lat);
  }
  return [w, s, e, n];
}
