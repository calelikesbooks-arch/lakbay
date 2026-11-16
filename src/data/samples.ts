import type { Itinerary, PlaceRef, Source, Terminal } from '../types/transport';

/**
 * ⚠️ FICTIONAL SAMPLE DATA, for the Design System preview page ONLY.
 * Every name, fare and date here is made up and deliberately looks fake.
 * Never import this file from a real feature page.
 */

const place = (id: string, name: string, kind: PlaceRef['kind'] = 'stop'): PlaceRef => ({ id, name, kind, locality: 'Sample Town' });

const survey: Source = { id: 'sample-src-1', type: 'field_survey', title: 'Sample field survey (fictional)', observedOn: '2026-10-01', observer: 'Sample Mapper' };
const official: Source = { id: 'sample-src-2', type: 'official_document', title: 'Sample fare circular (fictional)', observedOn: '2026-09-15' };
const oldSurvey: Source = { id: 'sample-src-3', type: 'field_survey', title: 'Older sample survey (fictional)', observedOn: '2026-01-10' };

const A = place('s-a', 'Sample Plaza', 'landmark');
const B = place('s-b', 'Sample Terminal Uno', 'terminal');
const C = place('s-c', 'Halimbawa Junction');
const D = place('s-d', 'Sample Station');
const Z = place('s-z', 'Sample Destination Mall', 'landmark');

export const sampleItineraries: Itinerary[] = [
  {
    id: 'sample-1',
    from: A,
    to: Z,
    legs: [
      { id: 's1-1', mode: 'walk', from: A, to: B, instruction: 'Walk to the loading bay beside the sample fountain.', distanceMeters: 260, sources: [survey], verification: { level: 'verified', lastVerified: '2026-10-01' } },
      { id: 's1-2', mode: 'jeepney', from: B, to: C, instruction: 'Ride a jeepney going to Sample Route A. Pay the driver as you board.', signboard: 'Sample – Route A', distanceMeters: 5400, fare: { regular: { min: 20, max: 20 }, discounted: { min: 16, max: 16 }, basis: 'Sample circular (fictional)' }, sources: [survey, official], verification: { level: 'verified', lastVerified: '2026-10-01' } },
      { id: 's1-3', mode: 'bus', from: C, to: Z, instruction: 'Cross the footbridge and ride a bus marked Sample Route B.', signboard: 'Sample Route B', distanceMeters: 9100, fare: { regular: { min: 30, max: 34 }, basis: 'Sample circular (fictional)' }, sources: [official], verification: { level: 'partial', lastVerified: '2026-09-15' } },
    ],
  },
  {
    id: 'sample-2',
    from: A,
    to: Z,
    legs: [
      { id: 's2-1', mode: 'tricycle', from: A, to: D, instruction: 'Take a tricycle from the sample plaza queue to Sample Station.', distanceMeters: 1800, fare: { regular: { min: 25, max: 30 }, basis: 'Observed during sample survey' }, sources: [oldSurvey], verification: { level: 'verified', lastVerified: '2026-01-10' } },
      { id: 's2-2', mode: 'rail', from: D, to: Z, instruction: 'Board the sample train southbound and get off at the last stop.', distanceMeters: 11200, fare: { regular: { min: 25, max: 25 }, basis: 'Sample operator fare table' }, sources: [official], verification: { level: 'verified', lastVerified: '2026-09-15' } },
      { id: 's2-3', mode: 'walk', from: Z, to: Z, instruction: 'Use the covered walkway to the mall entrance.', distanceMeters: 150, sources: [oldSurvey], verification: { level: 'verified', lastVerified: '2026-01-10' } },
    ],
  },
  {
    id: 'sample-3',
    from: A,
    to: Z,
    legs: [
      { id: 's3-1', mode: 'walk', from: A, to: B, instruction: 'Walk to Sample Terminal Uno.', distanceMeters: 260, sources: [survey], verification: { level: 'verified', lastVerified: '2026-10-01' } },
      { id: 's3-2', mode: 'uv_express', from: B, to: Z, instruction: 'Ride a UV Express going directly to Sample Destination Mall.', signboard: 'Sample Mall', distanceMeters: 14800, sources: [survey], verification: { level: 'partial', lastVerified: '2026-10-01' } },
    ],
  },
];

export const sampleTerminal: Terminal = {
  id: 'sample-terminal',
  name: 'Sample Terminal Uno',
  locality: 'Sample Town',
  modes: ['jeepney', 'uv_express', 'tricycle'],
  servesDestinations: ['Sample – Route A', 'Sample Mall'],
  landmark: 'Beside the sample fountain',
  operatingHours: 'Sample hours (fictional)',
  notes: 'Fictional terminal used to preview the card design.',
  sources: [survey],
  verification: { level: 'verified', lastVerified: '2026-10-01' },
};
