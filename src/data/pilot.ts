import type { Itinerary, PlaceRef, Terminal } from '../types/transport';

/**
 * PILOT COVERAGE AREAS
 * These are the coverage areas named in the project scope: town and district
 * names only. They carry NO coordinates and NO transport claims.
 */
export const pilotAreas: PlaceRef[] = [
  { id: 'area-marilao', name: 'Marilao', kind: 'area', locality: 'Bulacan' },
  { id: 'area-meycauayan', name: 'Meycauayan', kind: 'area', locality: 'Bulacan' },
  { id: 'area-bocaue', name: 'Bocaue', kind: 'area', locality: 'Bulacan' },
  { id: 'area-monumento', name: 'Monumento', kind: 'area', locality: 'Caloocan, Metro Manila' },
  { id: 'area-sm-north-edsa', name: 'SM North EDSA', kind: 'area', locality: 'Quezon City, Metro Manila' },
  { id: 'area-cubao', name: 'Cubao', kind: 'area', locality: 'Quezon City, Metro Manila' },
];

/** Destinations shown as quick shortcuts on the Home screen. */
export const pilotDestinationIds = ['area-monumento', 'area-sm-north-edsa', 'area-cubao'];

/**
 * VERIFIED DATA
 * Empty on purpose. Records are added only after field survey or official
 * documents, each with sources and a verification date (see docs/).
 * In the data milestone these will be loaded from data/build/*.json instead.
 */
export const verifiedPlaces: PlaceRef[] = [];
export const verifiedItineraries: Itinerary[] = [];
export const verifiedTerminals: Terminal[] = [];
