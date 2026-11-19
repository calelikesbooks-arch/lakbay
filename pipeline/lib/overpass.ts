/**
 * Polite Overpass API client.
 *
 * Usage policy (https://wiki.openstreetmap.org/wiki/Overpass_API):
 *  - one-off use: about 10,000 queries / 1 GB per day; REGULAR use: divide by 100
 *  - limits count per application, not per user
 *  - identify the application with a custom User-Agent
 * LAKBAY: 2-3 queries per area per run, at least 10 s apart, cached 24 h,
 * backs off on 429/504, never runs in the browser or on a schedule by default.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ImportAreaConfig } from '../config/areas';
import { ROUTE_VALUES } from './osmClassify';
import { sha256 } from './hash';

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
  members?: { type: 'node' | 'way' | 'relation'; ref: number; role: string }[];
  version?: number;
  timestamp?: string;
  // Present in "out meta" responses; LAKBAY drops them (personal data).
  user?: string;
  uid?: number;
  changeset?: number;
}

export interface OverpassResponse {
  osm3s?: { timestamp_osm_base?: string; copyright?: string };
  elements: OsmElement[];
}

const MIN_GAP_MS = 10_000;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let lastRequestAt = 0;

/** Escapes a value for use inside an Overpass QL string literal. */
function q(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Selects the area of one municipality inside its parent (province/region). */
export function areaSelector(area: ImportAreaConfig): string {
  return [
    `rel["boundary"="administrative"]["admin_level"="${area.osm.parentAdminLevel}"]["name"="${q(area.osm.parentName)}"];`,
    'map_to_area->.parent;',
    `rel(area.parent)["boundary"="administrative"]["admin_level"="${area.osm.adminLevel}"]["name"~"${q(area.osm.nameRegex)}"];`,
    'out ids tags;',
    'map_to_area->.a;',
  ].join('\n');
}

/** Terminals and stops inside the area. No roads, no generic places. */
export function placesQuery(area: ImportAreaConfig): string {
  return [
    '[out:json][timeout:180];',
    areaSelector(area),
    '(',
    '  nwr["amenity"="bus_station"](area.a);',
    '  nwr["public_transport"="station"](area.a);',
    '  nwr["railway"~"^(station|halt)$"](area.a);',
    '  nwr["amenity"="taxi"]["taxi_vehicle"="auto_rickshaw"](area.a);',
    '  nwr["highway"="bus_stop"](area.a);',
    '  nwr["public_transport"~"^(platform|stop_position)$"](area.a);',
    '  nwr["share_taxi"="yes"](area.a);',
    ');',
    'out center meta;',
  ].join('\n');
}

/**
 * Public transport ROUTE RELATIONS with at least one member in the area
 * (this is how Bulacan-to-Metro Manila connections are found), plus their
 * ways (with geometry) and member nodes (stops), wherever those are.
 */
export function routesQuery(area: ImportAreaConfig): string {
  return [
    '[out:json][timeout:180];',
    areaSelector(area),
    `rel(area.a)["type"="route"]["route"~"^(${ROUTE_VALUES.join('|')})$"]->.routes;`,
    '.routes out meta;',
    'way(r.routes);',
    'out geom;',
    'node(r.routes);',
    'out meta;',
  ].join('\n');
}

export interface FetchOptions {
  endpoint: string;
  contact: string;
  cacheDir: string;
  refresh?: boolean;
  log?: (message: string) => void;
}

export interface FetchResult {
  data: OverpassResponse;
  sha256: string;
  fromCache: boolean;
}

export async function runOverpass(query: string, options: FetchOptions): Promise<FetchResult> {
  const log = options.log ?? (() => {});
  const key = sha256(`${options.endpoint}\n${query}`).slice(0, 24);
  mkdirSync(options.cacheDir, { recursive: true });
  const file = join(options.cacheDir, `${key}.json`);

  if (!options.refresh && existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, 'utf8')) as { fetchedAt: string; body: string };
    if (Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_MAX_AGE_MS) {
      log(`  using cached Overpass answer from ${cached.fetchedAt}`);
      return { data: JSON.parse(cached.body) as OverpassResponse, sha256: sha256(cached.body), fromCache: true };
    }
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    log(`  asking Overpass (attempt ${attempt})…`);

    const response = await fetch(options.endpoint, {
      method: 'POST',
      headers: {
        'User-Agent': `LAKBAY-data-pipeline/0.1 (+${options.contact})`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (response.status === 429 || response.status === 504) {
      const backoff = 60_000 * attempt;
      log(`  Overpass is busy (HTTP ${response.status}); waiting ${backoff / 1000} s before retrying.`);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    if (!response.ok) {
      throw new Error(`Overpass returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const body = await response.text();
    writeFileSync(file, JSON.stringify({ fetchedAt: new Date().toISOString(), query, body }));
    return { data: JSON.parse(body) as OverpassResponse, sha256: sha256(body), fromCache: false };
  }
  throw new Error('Overpass stayed busy after 3 attempts. Try again later (do not loop).');
}
