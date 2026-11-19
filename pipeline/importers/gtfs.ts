/**
 * GTFS importer (static feeds you downloaded and UNZIPPED yourself).
 * Only for providers marked 'approved' in the source registry: the database
 * refuses runs for providers whose license has not been reviewed.
 *
 * GTFS data from the Philippines (e.g. the Metro Manila feed from the
 * Philippine Transit App Challenge) is old. Everything is staged with an
 * "outdated dataset" warning and must be field-checked before verification.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bboxContains } from '../lib/geo';
import { parseCsvObjects } from '../lib/csv';
import { cleanName } from '../lib/text';
import { emptyDraft, type DraftCandidate, type Issue } from '../lib/types';

export interface GtfsOptions {
  providerCode: string;
  dir: string;
  /** Optional [west, south, east, north] filter typed by YOU on the command line. */
  bbox?: [number, number, number, number];
  today?: Date;
}

function readTable(dir: string, file: string, required: boolean): Record<string, string>[] {
  const path = join(dir, file);
  if (!existsSync(path)) {
    if (required) throw new Error(`${file} is missing in ${dir}. Unzip the GTFS feed into that folder first.`);
    return [];
  }
  return parseCsvObjects(readFileSync(path, 'utf8'));
}

function modeHints(routeType: string, text: string): { hints: string[]; confidence: 'tagged' | 'inferred' | 'unknown' } {
  const t = text;
  switch (routeType) {
    case '0':
    case '1':
    case '12': {
      const hints = [/\bLRT\b/i.test(t) && 'lrt', /\bMRT\b/i.test(t) && 'mrt'].filter(Boolean) as string[];
      return hints.length ? { hints, confidence: 'inferred' } : { hints: [], confidence: 'unknown' };
    }
    case '2':
      return { hints: [/\bLRT\b/i.test(t) ? 'lrt' : /\bMRT\b/i.test(t) ? 'mrt' : 'commuter_rail'], confidence: 'inferred' };
    case '4':
      return { hints: ['ferry'], confidence: 'tagged' };
    case '3':
    default:
      if (/\bPUJ\b|jeep/i.test(t)) return { hints: ['jeepney', 'modern_jeepney'], confidence: 'inferred' };
      if (/\bUV\b/i.test(t)) return { hints: ['uv_express'], confidence: 'inferred' };
      if (/\bP2P\b/i.test(t)) return { hints: ['p2p_bus'], confidence: 'inferred' };
      if (/\bPUB\b|bus/i.test(t)) return { hints: ['city_bus', 'provincial_bus'], confidence: 'inferred' };
      return { hints: [], confidence: 'unknown' };
  }
}

export function buildGtfsCandidates(options: GtfsOptions): { candidates: DraftCandidate[]; notes: string[] } {
  const { dir, providerCode, bbox } = options;
  const today = (options.today ?? new Date()).toISOString().slice(0, 10).replace(/-/g, '');
  const notes: string[] = [];

  const stops = readTable(dir, 'stops.txt', true);
  const routes = readTable(dir, 'routes.txt', true);
  const trips = readTable(dir, 'trips.txt', true);
  const stopTimes = readTable(dir, 'stop_times.txt', true);
  const shapes = readTable(dir, 'shapes.txt', false);
  const agencies = readTable(dir, 'agency.txt', false);
  const feedInfo = readTable(dir, 'feed_info.txt', false)[0];

  const datasetIssues: Issue[] = [];
  if (!feedInfo?.feed_end_date) {
    datasetIssues.push({ code: 'dataset_age_unknown', severity: 'warning', message: 'The feed does not say until when it is valid. Treat it as possibly outdated.' });
  } else if (feedInfo.feed_end_date < today) {
    datasetIssues.push({ code: 'dataset_expired', severity: 'warning', message: `The feed expired on ${feedInfo.feed_end_date}.` });
  }
  const feedVersion = feedInfo?.feed_version || null;
  const agencyName = new Map(agencies.map((a) => [a.agency_id || '', a.agency_name || '']));

  // ---- stops ----
  const stopById = new Map(stops.map((s) => [s.stop_id, s]));
  const inside = (s: Record<string, string>) => {
    const lon = Number(s.stop_lon);
    const lat = Number(s.stop_lat);
    return !bbox || (Number.isFinite(lon) && Number.isFinite(lat) && bboxContains(bbox, lon, lat));
  };
  const keptStopIds = new Set(stops.filter(inside).map((s) => s.stop_id));
  const sourceInfo = {
    type: 'other',
    title: `GTFS feed (${providerCode})${feedVersion ? ` version ${feedVersion}` : ''}`,
    document_number: feedVersion,
    published_on: feedInfo?.feed_start_date ? `${feedInfo.feed_start_date.slice(0, 4)}-${feedInfo.feed_start_date.slice(4, 6)}-${feedInfo.feed_start_date.slice(6, 8)}` : null,
  };

  const candidates: DraftCandidate[] = [];
  for (const s of stops) {
    if (!keptStopIds.has(s.stop_id)) continue;
    const lon = s.stop_lon === '' ? null : Number(s.stop_lon);
    const lat = s.stop_lat === '' ? null : Number(s.stop_lat);
    const isStation = s.location_type === '1';
    if (!['', '0', '1'].includes(s.location_type ?? '')) continue; // entrances, nodes, boarding areas
    candidates.push(
      emptyDraft({
        external_id: `gtfs:${providerCode}:stop/${s.stop_id}`,
        kind: isStation ? 'terminal' : 'stop',
        classification: isStation ? 'terminal' : 'designated_stop',
        name: cleanName(s.stop_name),
        lon: Number.isFinite(lon) ? lon : null,
        lat: Number.isFinite(lat) ? lat : null,
        raw_tags: Object.fromEntries(Object.entries(s).filter(([, v]) => v !== '')),
        attributes: { priority: isStation ? 3 : 2, source: sourceInfo, gtfs_parent_station: s.parent_station || null },
        issues: [...datasetIssues],
      }),
    );
  }

  // ---- routes: one candidate per route + direction, using its longest trip ----
  const stopTimesByTrip = new Map<string, { seq: number; stop_id: string }[]>();
  for (const st of stopTimes) {
    const list = stopTimesByTrip.get(st.trip_id) ?? [];
    list.push({ seq: Number(st.stop_sequence), stop_id: st.stop_id });
    stopTimesByTrip.set(st.trip_id, list);
  }
  const shapePoints = new Map<string, { seq: number; lon: number; lat: number }[]>();
  for (const p of shapes) {
    const list = shapePoints.get(p.shape_id) ?? [];
    list.push({ seq: Number(p.shape_pt_sequence), lon: Number(p.shape_pt_lon), lat: Number(p.shape_pt_lat) });
    shapePoints.set(p.shape_id, list);
  }

  for (const route of routes) {
    const routeTrips = trips.filter((t) => t.route_id === route.route_id);
    const directions = new Map<string, typeof routeTrips>();
    for (const t of routeTrips) directions.set(t.direction_id || '0', [...(directions.get(t.direction_id || '0') ?? []), t]);

    for (const [direction, dirTrips] of directions) {
      const best = dirTrips
        .map((t) => ({ trip: t, stops: (stopTimesByTrip.get(t.trip_id) ?? []).sort((a, b) => a.seq - b.seq) }))
        .sort((a, b) => b.stops.length - a.stops.length)[0];
      if (!best) continue;
      if (bbox && !best.stops.some((st) => keptStopIds.has(st.stop_id))) continue;

      const pts = best.trip.shape_id ? (shapePoints.get(best.trip.shape_id) ?? []).sort((a, b) => a.seq - b.seq) : [];
      const validPts = pts.filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
      const text = [route.route_short_name, route.route_long_name, route.route_desc, agencyName.get(route.agency_id || '')].join(' ');
      const { hints, confidence } = modeHints(route.route_type, text);
      const first = stopById.get(best.stops[0]?.stop_id ?? '');
      const last = stopById.get(best.stops[best.stops.length - 1]?.stop_id ?? '');

      candidates.push(
        emptyDraft({
          external_id: `gtfs:${providerCode}:route/${route.route_id}/dir/${direction}`,
          kind: 'route',
          classification: 'route',
          name: cleanName(route.route_long_name) ?? cleanName(route.route_short_name),
          ref: cleanName(route.route_short_name),
          operator_name: cleanName(agencyName.get(route.agency_id || '')),
          from_label: cleanName(first?.stop_name),
          to_label: cleanName(last?.stop_name),
          mode_hints: hints,
          mode_confidence: confidence,
          path: validPts.length >= 2 ? { type: 'LineString', coordinates: validPts.map((p) => [p.lon, p.lat] as [number, number]) } : null,
          path_complete: validPts.length >= 2 ? true : null,
          members: best.stops.map((st) => ({ external_id: `gtfs:${providerCode}:stop/${st.stop_id}`, role: 'stop' })),
          raw_tags: Object.fromEntries(Object.entries(route).filter(([, v]) => v !== '')),
          attributes: { source: sourceInfo, gtfs_trip_used: best.trip.trip_id, gtfs_route_type: route.route_type },
          issues: [...datasetIssues],
        }),
      );
    }
  }

  // Member stops outside the bbox are still needed to describe the route.
  if (bbox) {
    const present = new Set(candidates.map((c) => c.external_id));
    for (const c of candidates.filter((x) => x.kind === 'route')) {
      for (const m of c.members) {
        if (present.has(m.external_id)) continue;
        const s = stopById.get(m.external_id.slice(`gtfs:${providerCode}:stop/`.length));
        if (!s) continue;
        present.add(m.external_id);
        candidates.push(
          emptyDraft({
            external_id: m.external_id,
            kind: 'stop',
            classification: 'designated_stop',
            name: cleanName(s.stop_name),
            lon: s.stop_lon === '' ? null : Number(s.stop_lon),
            lat: s.stop_lat === '' ? null : Number(s.stop_lat),
            raw_tags: Object.fromEntries(Object.entries(s).filter(([, v]) => v !== '')),
            attributes: { priority: 2, source: sourceInfo },
            issues: [...datasetIssues],
          }),
        );
      }
    }
  }

  notes.push(`${stops.length} stops and ${routes.length} routes in the feed; ${candidates.length} candidates kept.`);
  return { candidates, notes };
}
