/**
 * Joins the ways of a route relation into ONE continuous line.
 *
 * If the ways do not connect (gaps, missing members, wrong order), we return
 * NO line at all and report the gaps. We never draw a straight segment across
 * a gap: that would invent a road connection that may not exist.
 */
import { distanceMeters } from './geo';

export type Coords = [number, number][];

export interface RoutePathResult {
  coordinates: Coords | null;
  complete: boolean;
  /** Number of disconnected pieces found (1 = continuous). */
  parts: number;
  missingWays: number;
}

function sameish(a: [number, number], b: [number, number], toleranceM: number): boolean {
  return distanceMeters(a, b) <= toleranceM;
}

/**
 * @param ways ordered way geometries as listed in the relation (null = geometry not available)
 * @param toleranceM endpoints closer than this are considered connected
 */
export function buildRoutePath(ways: (Coords | null)[], toleranceM = 15): RoutePathResult {
  const missingWays = ways.filter((w) => !w || w.length < 2).length;
  const usable = ways.filter((w): w is Coords => !!w && w.length >= 2);
  if (usable.length === 0) return { coordinates: null, complete: false, parts: 0, missingWays };

  let line: Coords = [...usable[0]];
  let parts = 1;

  // Orient the first way so that it connects to the second.
  if (usable.length > 1) {
    const next = usable[1];
    const end = line[line.length - 1];
    const start = line[0];
    const connectsAtEnd = sameish(end, next[0], toleranceM) || sameish(end, next[next.length - 1], toleranceM);
    const connectsAtStart = sameish(start, next[0], toleranceM) || sameish(start, next[next.length - 1], toleranceM);
    if (!connectsAtEnd && connectsAtStart) line.reverse();
  }

  for (let i = 1; i < usable.length; i++) {
    const way = usable[i];
    const tail = line[line.length - 1];
    if (sameish(tail, way[0], toleranceM)) {
      line = line.concat(way.slice(1));
    } else if (sameish(tail, way[way.length - 1], toleranceM)) {
      line = line.concat([...way].reverse().slice(1));
    } else {
      parts++;
      // Keep going to count the pieces, but the final line is discarded.
      line = line.concat(way);
    }
  }

  const complete = parts === 1 && missingWays === 0;
  return { coordinates: complete ? line : null, complete, parts, missingWays };
}
