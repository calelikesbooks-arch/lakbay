import type { Itinerary, PesoRange, VerificationLevel } from '../../types/transport';

/**
 * Summary numbers for one itinerary, computed from its legs.
 * Pure functions (no React), so they can be unit-tested and reused on Android.
 */

const levelRank: Record<VerificationLevel, number> = { verified: 3, partial: 2, needs_recheck: 1, unverified: 0 };

export interface ItinerarySummary {
  /** null when ANY riding leg has no fare (we never guess a total). */
  fare: PesoRange | null;
  walkingMeters: number;
  totalMeters: number;
  /** Number of vehicle changes: rides − 1. */
  transfers: number;
  rides: number;
  /** Weakest-link rule: an itinerary is only as verified as its least verified leg. */
  verification: VerificationLevel;
  /** Oldest "last verified" date among legs. */
  oldestVerified?: string;
  sourceCount: number;
}

export function summarize(itinerary: Itinerary): ItinerarySummary {
  let fareMin = 0;
  let fareMax = 0;
  let fareKnown = true;
  let walkingMeters = 0;
  let totalMeters = 0;
  let rides = 0;
  let verification: VerificationLevel = 'verified';
  let oldestVerified: string | undefined;
  const sourceIds = new Set<string>();

  for (const leg of itinerary.legs) {
    totalMeters += leg.distanceMeters;
    if (leg.mode === 'walk') {
      walkingMeters += leg.distanceMeters;
    } else {
      rides += 1;
      if (leg.fare) {
        fareMin += leg.fare.regular.min;
        fareMax += leg.fare.regular.max;
      } else {
        fareKnown = false;
      }
    }
    if (levelRank[leg.verification.level] < levelRank[verification]) verification = leg.verification.level;
    const date = leg.verification.lastVerified;
    if (date && (!oldestVerified || date < oldestVerified)) oldestVerified = date;
    leg.sources.forEach((source) => sourceIds.add(source.id));
  }

  return {
    fare: fareKnown && rides > 0 ? { min: fareMin, max: fareMax } : null,
    walkingMeters,
    totalMeters,
    transfers: Math.max(0, rides - 1),
    rides,
    verification,
    oldestVerified,
    sourceCount: sourceIds.size,
  };
}

export type SortKey = 'cheapest' | 'fewest_transfers' | 'least_walking';

export function sortItineraries(itineraries: Itinerary[], key: SortKey): Itinerary[] {
  const withSummary = itineraries.map((itinerary) => ({ itinerary, s: summarize(itinerary) }));
  const fareOf = (s: ItinerarySummary) => (s.fare ? s.fare.max : Number.POSITIVE_INFINITY);
  withSummary.sort((a, b) => {
    switch (key) {
      case 'cheapest':
        return fareOf(a.s) - fareOf(b.s) || a.s.transfers - b.s.transfers;
      case 'fewest_transfers':
        return a.s.transfers - b.s.transfers || fareOf(a.s) - fareOf(b.s);
      case 'least_walking':
        return a.s.walkingMeters - b.s.walkingMeters || fareOf(a.s) - fareOf(b.s);
    }
  });
  return withSummary.map((item) => item.itinerary);
}
