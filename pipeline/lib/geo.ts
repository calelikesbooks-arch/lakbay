/** Geographic helpers (no external libraries). */

/** Rough Philippines box, same as private.in_philippines in the database. */
export const PH_BOUNDS = { west: 114, south: 4, east: 127, north: 22 } as const;

export function isFiniteCoordinate(lon: unknown, lat: unknown): lon is number {
  return typeof lon === 'number' && typeof lat === 'number' && Number.isFinite(lon) && Number.isFinite(lat);
}

export function inPhilippines(lon: number, lat: number): boolean {
  return lon >= PH_BOUNDS.west && lon <= PH_BOUNDS.east && lat >= PH_BOUNDS.south && lat <= PH_BOUNDS.north;
}

/** Great-circle distance in meters. */
export function distanceMeters(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

/** Number of decimals actually written in a coordinate. */
export function decimals(value: number): number {
  const text = String(value);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

export function bboxContains(bbox: [number, number, number, number], lon: number, lat: number): boolean {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}
