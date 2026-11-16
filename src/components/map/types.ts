import type { Bbox } from '../../lib/map/config';

/** A point the user picked: from LAKBAY data, an OpenStreetMap search, or GPS. */
export interface PlacePoint {
  lon: number;
  lat: number;
  label: string;
  origin: 'lakbay' | 'osm' | 'gps';
  bbox?: Bbox;
  /** Set when the place is a LAKBAY terminal or stop. */
  location?: { kind: 'terminal' | 'stop'; id: string };
}

export interface Selection {
  kind: 'terminal' | 'stop';
  id: string;
  name: string;
  lon: number;
  lat: number;
}
