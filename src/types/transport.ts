/**
 * Transport data types used by the UI.
 * The full data dictionary (docs/data-dictionary.md) will refine these in the
 * data milestone; the UI components are written against these shapes.
 */

export type Mode = 'walk' | 'jeepney' | 'modern_jeepney' | 'uv_express' | 'bus' | 'tricycle' | 'rail';

export type PlaceKind = 'area' | 'landmark' | 'terminal' | 'stop';

export interface PlaceRef {
  id: string;
  name: string;
  kind: PlaceKind;
  /** Town or city, e.g. "Marilao, Bulacan". */
  locality?: string;
  /** [longitude, latitude]. Only set for surveyed places. */
  coordinates?: [number, number];
}

export type SourceType = 'field_survey' | 'official_document' | 'operator' | 'openstreetmap' | 'community' | 'news' | 'other';

export interface Source {
  id: string;
  type: SourceType;
  title: string;
  url?: string;
  /** ISO date (YYYY-MM-DD) the information was observed or published. */
  observedOn: string;
  observer?: string;
}

/**
 * verified      = surveyed or confirmed by an official document recently
 * partial       = some parts confirmed, others not
 * needs_recheck = was verified, but a moderator flagged it for re-checking
 * unverified    = not confirmed (never shown as a recommended route)
 */
export type VerificationLevel = 'verified' | 'partial' | 'needs_recheck' | 'unverified';

export interface Verification {
  level: VerificationLevel;
  /** ISO date. */
  lastVerified?: string;
  nextReview?: string;
}

export interface PesoRange {
  min: number;
  max: number;
}

export interface FareEstimate {
  regular: PesoRange;
  /** Student / senior / PWD discounted fare, once the rule is confirmed. */
  discounted?: PesoRange;
  /** Where the fare comes from, e.g. the LTFRB circular number. */
  basis: string;
}

export interface Leg {
  id: string;
  mode: Mode;
  from: PlaceRef;
  to: PlaceRef;
  /** Plain-language instruction, e.g. "Ride a jeepney with the signboard …". */
  instruction: string;
  /** Text painted on the vehicle's signboard, when known. */
  signboard?: string;
  distanceMeters: number;
  fare?: FareEstimate;
  sources: Source[];
  verification: Verification;
}

export interface Itinerary {
  id: string;
  from: PlaceRef;
  to: PlaceRef;
  legs: Leg[];
}

export interface Terminal {
  id: string;
  name: string;
  locality: string;
  modes: Mode[];
  /** Destinations served, as written on signboards. */
  servesDestinations: string[];
  landmark?: string;
  operatingHours?: string;
  notes?: string;
  sources: Source[];
  verification: Verification;
}
