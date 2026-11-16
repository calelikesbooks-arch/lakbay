import { verifiedItineraries } from '../../data/pilot';
import type { Itinerary, PlaceRef } from '../../types/transport';

export type RouteSearchResult =
  | { status: 'ok'; itineraries: Itinerary[] }
  /** One or both places are free text that LAKBAY doesn't know. */
  | { status: 'unknown_place'; which: ('from' | 'to')[] }
  | { status: 'same_place' }
  /** Both places known, but no verified route connects them yet. */
  | { status: 'no_verified_route' };

/**
 * Looks up routes between two places using ONLY verified data.
 *
 * Milestone 2 replaces this lookup with the graph router described in the
 * architecture doc (Section 7). The return shape will stay the same, so the
 * screens won't need to change. It is async because data will be fetched
 * from compiled JSON files.
 */
export async function findRoutes(from: PlaceRef | null, to: PlaceRef | null): Promise<RouteSearchResult> {
  const unknown: ('from' | 'to')[] = [];
  if (!from) unknown.push('from');
  if (!to) unknown.push('to');
  if (unknown.length) return { status: 'unknown_place', which: unknown };
  if (from!.id === to!.id) return { status: 'same_place' };

  const itineraries = verifiedItineraries.filter(
    (itinerary) =>
      itinerary.legs.every((leg) => leg.verification.level !== 'unverified') &&
      itinerary.from.id === from!.id &&
      itinerary.to.id === to!.id,
  );
  return itineraries.length ? { status: 'ok', itineraries } : { status: 'no_verified_route' };
}
