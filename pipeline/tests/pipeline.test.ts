/**
 * Offline tests for the import pipeline (no network, no database).
 * Run: npm run test:pipeline
 * Fixtures in ./fixtures are INVENTED test data, not transport data.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ImportAreaConfig } from '../config/areas';
import { AREAS } from '../config/areas';
import { buildGtfsCandidates } from '../importers/gtfs';
import { buildOsmCandidates } from '../importers/osm';
import { buildSurveyCandidates } from '../importers/survey';
import { parseCsv } from '../lib/csv';
import { findBatchDuplicates } from '../lib/dedupe';
import { finalizeCandidates, summarize } from '../lib/finalize';
import { contentHash } from '../lib/hash';
import { classifyOsmPlace, classifyOsmRoute } from '../lib/osmClassify';
import { placesQuery, routesQuery, type OverpassResponse } from '../lib/overpass';
import { buildRoutePath } from '../lib/routeGeometry';
import { assignFromBoundaries, boundariesFromOverpass, containsPoint } from '../lib/boundaries';
import { similarity } from '../lib/text';
import { emptyDraft } from '../lib/types';
import { validateCandidate } from '../lib/validate';

const here = import.meta.dirname;
const fixture = (name: string) => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8')) as OverpassResponse;
const NOW = new Date('2026-11-20T00:00:00Z');

const TEST_AREA: ImportAreaConfig = {
  code: 'test-fixtureville',
  name: 'Fixtureville',
  municipality: 'Fixtureville',
  province: 'Fixture Province',
  region: 'Test',
  osm: { nameRegex: '^Fixtureville$', adminLevel: 6, parentName: 'Fixture Province', parentAdminLevel: 4 },
  enabledByDefault: false,
};

// ---------------------------------------------------------------- classify
test('roads are never classified as public transport', () => {
  assert.equal(classifyOsmPlace({ highway: 'primary', name: 'MacArthur Highway' }), null);
  assert.equal(classifyOsmPlace({ highway: 'residential' }), null);
  assert.equal(classifyOsmRoute({ type: 'route', route: 'road', name: 'Some road' }), null);
  assert.equal(classifyOsmRoute({ type: 'route', route: 'hiking' }), null);
});

test('stops, terminals and tricycle terminals follow Philippine tagging', () => {
  const stop = classifyOsmPlace({ highway: 'bus_stop', share_taxi: 'yes' });
  assert.equal(stop?.kind, 'stop');
  assert.ok(stop?.mode_hints.includes('jeepney'));
  assert.equal(stop?.mode_confidence, 'inferred');

  const trike = classifyOsmPlace({ amenity: 'taxi', taxi_vehicle: 'auto_rickshaw' });
  assert.deepEqual([trike?.kind, trike?.classification, trike?.mode_hints], ['terminal', 'loading_bay', ['tricycle']]);
  assert.equal(classifyOsmPlace({ amenity: 'taxi' }), null, 'plain taxi stands are out of scope');

  const station = classifyOsmPlace({ railway: 'station', network: 'Manila LRT' });
  assert.deepEqual([station?.classification, station?.mode_hints], ['rail_station', ['lrt']]);
  assert.equal(classifyOsmPlace({ public_transport: 'stop_position', train: 'yes' }), null, 'rail stop positions are part of a station');
});

test('route=bus mode is only a hint, and unknown when nothing says which vehicle', () => {
  assert.deepEqual(classifyOsmRoute({ type: 'route', route: 'bus', bus: 'share_taxi' })?.mode_hints, ['jeepney', 'modern_jeepney']);
  assert.deepEqual(classifyOsmRoute({ type: 'route', route: 'bus', name: 'UV Express X' })?.mode_hints, ['uv_express']);
  const unknown = classifyOsmRoute({ type: 'route', route: 'bus', name: 'Route 7' });
  assert.deepEqual([unknown?.mode_hints, unknown?.mode_confidence], [[], 'unknown']);
});

// ---------------------------------------------------------------- geometry
test('route ways are joined, including reversed ways', () => {
  const r = buildRoutePath([
    [[120.95, 14.76], [120.96, 14.75]],
    [[120.97, 14.74], [120.96, 14.75]], // reversed
    [[120.97, 14.74], [120.98, 14.73]],
  ]);
  assert.equal(r.complete, true);
  assert.equal(r.coordinates?.length, 4);
  assert.deepEqual(r.coordinates?.[0], [120.95, 14.76]);
  assert.deepEqual(r.coordinates?.[3], [120.98, 14.73]);
});

test('gaps are never bridged: no line is produced', () => {
  const r = buildRoutePath([
    [[120.95, 14.76], [120.96, 14.75]],
    [[121.0, 14.6], [121.01, 14.59]],
  ]);
  assert.equal(r.complete, false);
  assert.equal(r.coordinates, null);
  assert.equal(r.parts, 2);
  assert.equal(buildRoutePath([null, [[1, 1], [2, 2]]]).coordinates, null, 'missing way geometry = incomplete');
});

// ---------------------------------------------------------------- validation
test('missing names and coordinates are blockers; nothing is invented', () => {
  const base = { external_id: 'x:1', kind: 'stop' as const, classification: 'designated_stop', municipality: 'T' };
  const noName = validateCandidate(emptyDraft({ ...base, lon: 120.95, lat: 14.76 }), NOW);
  assert.ok(noName.some((i) => i.code === 'missing_name' && i.severity === 'blocker'));
  const noCoords = validateCandidate(emptyDraft({ ...base, name: 'A' + 'bc' }), NOW);
  assert.ok(noCoords.some((i) => i.code === 'missing_coordinates' && i.severity === 'blocker'));
  const swapped = validateCandidate(emptyDraft({ ...base, name: 'Abc', lon: 14.76, lat: 120.95 }), NOW);
  assert.match(swapped.find((i) => i.code === 'outside_philippines')?.message ?? '', /swapped/);
  const lowPrecision = validateCandidate(emptyDraft({ ...base, name: 'Abc', lon: 120.9, lat: 14.7 }), NOW);
  assert.ok(lowPrecision.some((i) => i.code === 'low_precision'));
});

test('every route is flagged as unconfirmed', () => {
  const issues = validateCandidate(
    emptyDraft({ external_id: 'r', kind: 'route', classification: 'route', name: 'R1', mode_confidence: 'inferred' }),
    NOW,
  );
  assert.ok(issues.some((i) => i.code === 'route_unconfirmed'));
  assert.ok(issues.some((i) => i.code === 'route_geometry_missing'));
});

// ---------------------------------------------------------------- dedupe
test('platform and stop_position of the same stop are grouped; the platform wins', () => {
  const a = emptyDraft({ external_id: 'osm:node/1', kind: 'stop', classification: 'designated_stop', name: 'Plaza', lon: 120.95, lat: 14.76, attributes: { priority: 3 } });
  const b = emptyDraft({ external_id: 'osm:node/2', kind: 'stop', classification: 'designated_stop', name: 'Plaza', lon: 120.95003, lat: 14.76002, attributes: { priority: 1 } });
  const far = emptyDraft({ external_id: 'osm:node/3', kind: 'stop', classification: 'designated_stop', name: 'Plaza', lon: 120.96, lat: 14.77, attributes: { priority: 3 } });
  const dups = findBatchDuplicates([a, b, far] as never);
  assert.equal(dups.get('osm:node/2'), 'osm:node/1');
  assert.equal(dups.has('osm:node/3'), false);
  assert.ok(similarity('Plaza Stop', 'plaza stop') > 0.99);
});

// ---------------------------------------------------------------- OSM end to end
test('OSM fixture: classification, validation and route import', () => {
  const result = buildOsmCandidates(TEST_AREA, fixture('overpass-places.json'), fixture('overpass-routes.json'));
  assert.equal(result.areaRelationId, 900001);
  const candidates = finalizeCandidates(result.candidates, NOW);
  const byId = new Map(candidates.map((c) => [c.external_id, c]));

  assert.equal(byId.has('osm:node/1005'), false, 'ordinary taxi stand skipped');
  assert.equal(byId.get('osm:node/1002')?.batch_duplicate_of, 'osm:node/1001', 'stop_position duplicates platform');
  assert.equal(byId.get('osm:node/1003')?.quality, 'blocked', 'unnamed stop blocked');
  assert.ok(byId.get('osm:node/1003')?.issues.some((i) => i.code === 'stale_upstream'));
  assert.equal(byId.get('osm:node/1006')?.quality, 'blocked', 'swapped coordinates blocked');
  assert.equal(byId.get('osm:way/2001')?.kind, 'terminal');
  assert.deepEqual([byId.get('osm:way/2001')?.lon, byId.get('osm:way/2001')?.lat], [120.955, 14.765], 'way uses Overpass center, not a guess');
  assert.equal(byId.get('osm:node/1004')?.classification, 'loading_bay');
  assert.equal(byId.get('osm:node/1007')?.classification, 'rail_station');

  // No user metadata is kept
  assert.equal(JSON.stringify(candidates).includes('someone'), false);

  const jeep = byId.get('osm:relation/3001')!;
  assert.equal(jeep.path_complete, true);
  assert.equal(jeep.path?.coordinates.length, 4);
  assert.deepEqual(jeep.members.map((m) => m.external_id), ['osm:node/1001', 'osm:node/1101']);
  assert.deepEqual(jeep.mode_hints, ['jeepney', 'modern_jeepney']);
  assert.ok(jeep.issues.some((i) => i.code === 'route_unconfirmed'));

  // A member stop outside the area (Metro Manila end of a connection)
  const outside = byId.get('osm:node/1101')!;
  assert.equal(outside.area_code, null);
  assert.ok(outside.issues.some((i) => i.code === 'municipality_unknown'));
  assert.equal(byId.get('osm:node/1001')?.area_code, 'test-fixtureville', 'area assignment wins over route-member-only');

  const mystery = byId.get('osm:relation/3002')!;
  assert.equal(mystery.path, null, 'gapped route has no invented line');
  assert.ok(mystery.issues.some((i) => i.code === 'route_geometry_gaps'));
  assert.ok(mystery.issues.some((i) => i.code === 'mode_unknown'));

  const summary = summarize(candidates);
  assert.equal(summary.total, candidates.length);
  assert.ok(candidates.findIndex((c) => c.batch_duplicate_of) > candidates.findIndex((c) => c.external_id === 'osm:node/1001'),
    'representatives are uploaded before their duplicates');
});

test('an area query that matches no or several boundaries stops the import', () => {
  const routes = fixture('overpass-routes.json');
  const noBoundary = { ...fixture('overpass-places.json'), elements: [] };
  assert.throws(() => buildOsmCandidates(TEST_AREA, noBoundary, { ...routes, elements: [] }), /No OpenStreetMap boundary/);
  const two = fixture('overpass-places.json');
  two.elements.push({ type: 'relation', id: 900002, tags: { boundary: 'administrative', name: 'Fixtureville' } });
  assert.throws(() => buildOsmCandidates(TEST_AREA, two, routes), /2 boundaries/);
});

test('Overpass queries select public transport only (no roads) and stay inside the area', () => {
  for (const area of AREAS) {
    const pq = placesQuery(area);
    const rq = routesQuery(area);
    assert.match(pq, /\(area\.a\)/);
    assert.match(rq, /rel\(area\.a\)\["type"="route"\]/);
    assert.doesNotMatch(pq + rq, /way\["highway"\]|\["highway"~/, 'no road queries');
    assert.match(pq, /\[timeout:180\]/);
  }
});

// ---------------------------------------------------------------- hashing
test('content hash ignores edit timestamps but notices real changes', () => {
  const a = emptyDraft({ external_id: 'x', kind: 'stop', classification: 'designated_stop', name: 'A', lon: 120.95, lat: 14.76, upstream_timestamp: '2020-01-01T00:00:00Z' });
  assert.equal(contentHash(a), contentHash({ ...a, upstream_timestamp: '2026-01-01T00:00:00Z', upstream_version: '9' }));
  assert.notEqual(contentHash(a), contentHash({ ...a, lon: 120.9501 }));
});

// ---------------------------------------------------------------- CSV
test('CSV parser handles quotes, commas, newlines and Excel BOM', () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'say "hi"', 'line1\nline2']]);
  assert.throws(() => parseCsv('a,"b'), /quoted/);
});

test('survey CSV: rows without real coordinates or sources are rejected, not guessed', () => {
  const header = 'record_id,kind,name,alt_names,classification,mode_codes,lon,lat,municipality,province,landmark,source_type,source_title,source_url,document_number,observed_on,published_on,observer,notes';
  const good = 'T-01,terminal,Test Terminal,,terminal,jeepney;uv_express,120.950123,14.760456,Test Town,Test Province,Beside fixture,field_survey,Survey of test terminal,,,2026-11-01,,Test Observer,';
  const noCoords = 'S-02,stop,Test Stop,,designated_stop,,,,Test Town,Test Province,,field_survey,Survey,,,2026-11-01,,Test Observer,';
  const noSource = 'S-03,stop,Test Stop 3,,designated_stop,,120.95,14.76,Test Town,Test Province,,,,,,2026-11-01,,Test Observer,';
  const future = 'S-04,stop,Test Stop 4,,designated_stop,,120.95,14.76,Test Town,Test Province,,field_survey,Survey,,,2099-01-01,,Test Observer,';
  const badMode = 'S-05,stop,Test Stop 5,,designated_stop,horse,120.95,14.76,Test Town,Test Province,,field_survey,Survey,,,2026-11-01,,Test Observer,';
  const { candidates, rejected } = buildSurveyCandidates([header, good, noCoords, noSource, future, badMode].join('\n'), NOW);
  assert.equal(candidates.length, 1);
  assert.deepEqual(rejected.map((r) => r.record_id), ['S-02', 'S-03', 'S-04', 'S-05']);
  assert.ok(rejected[0].reasons.some((r) => /never invented/.test(r)));
  const t = candidates[0];
  assert.deepEqual([t.kind, t.mode_hints, t.mode_confidence], ['terminal', ['jeepney', 'uv_express'], 'tagged']);
  assert.equal((t.attributes.source as { type: string }).type, 'field_survey');
});

test('the CSV template is well-formed, but its EXAMPLE rows can never be imported', () => {
  const template = readFileSync(join(here, '..', '..', 'data', 'templates', 'survey_locations.csv'), 'utf8');
  const { candidates, rejected } = buildSurveyCandidates(template, NOW);
  assert.equal(candidates.length, 0);
  assert.equal(rejected.length, 2);
  for (const r of rejected) assert.deepEqual(r.reasons, ['EXAMPLE row from the template: replace it with real surveyed data']);
});

// ---------------------------------------------------------------- GTFS
test('GTFS: stops, routes with shape and members; old feeds are flagged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lakbay-gtfs-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agency.txt'), 'agency_id,agency_name\nA1,Fixture Agency\n');
  writeFileSync(join(dir, 'stops.txt'), 'stop_id,stop_name,stop_lat,stop_lon,location_type\nS1,Fixture One,14.7601,120.9501,0\nS2,Fixture Two,14.7501,120.9601,0\nS3,Fixture Far,14.0001,121.5001,0\n');
  writeFileSync(join(dir, 'routes.txt'), 'route_id,agency_id,route_short_name,route_long_name,route_type\nR1,A1,PUJ 1,Fixture One - Fixture Two,3\n');
  writeFileSync(join(dir, 'trips.txt'), 'route_id,service_id,trip_id,direction_id,shape_id\nR1,X,T1,0,SH1\n');
  writeFileSync(join(dir, 'stop_times.txt'), 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,,,S1,1\nT1,,,S2,2\n');
  writeFileSync(join(dir, 'shapes.txt'), 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nSH1,14.7601,120.9501,1\nSH1,14.7501,120.9601,2\n');
  writeFileSync(join(dir, 'feed_info.txt'), 'feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version\nX,https://example.org,en,20150101,20151231,v1\n');

  const { candidates } = buildGtfsCandidates({ providerCode: 'test_gtfs', dir, bbox: [120.9, 14.7, 121.0, 14.8], today: NOW });
  const ids = candidates.map((c) => c.external_id).sort();
  assert.deepEqual(ids, ['gtfs:test_gtfs:route/R1/dir/0', 'gtfs:test_gtfs:stop/S1', 'gtfs:test_gtfs:stop/S2']);
  const route = candidates.find((c) => c.kind === 'route')!;
  assert.deepEqual(route.mode_hints, ['jeepney', 'modern_jeepney']);
  assert.equal(route.path?.coordinates.length, 2);
  assert.deepEqual(route.members.map((m) => m.external_id), ['gtfs:test_gtfs:stop/S1', 'gtfs:test_gtfs:stop/S2']);
  assert.ok(route.issues?.some((i) => i.code === 'dataset_expired'));
});

test('a stop found via another area\'s route keeps the municipality of its own area', () => {
  const asMember = emptyDraft({ external_id: 'osm:node/1', kind: 'stop', classification: 'designated_stop', name: 'X', lon: 120.96, lat: 14.75 });
  const asPlace = { ...asMember, area_code: 'ph-bulacan-meycauayan', municipality: 'Meycauayan', province: 'Bulacan' };
  const [only] = finalizeCandidates([asMember, asPlace], new Date('2026-11-20'));
  assert.equal(only.municipality, 'Meycauayan');
  assert.ok(!only.issues.some((i) => i.code === 'municipality_unknown'));
});

test('municipality outside the areas comes from boundaries (with holes), never from the name', () => {
  // INVENTED squares: a town with a hole, inside a province.
  const ring = (x1: number, y1: number, x2: number, y2: number) =>
    [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]].map(([lon, lat]) => ({ lon, lat }));
  const data: OverpassResponse = {
    elements: [
      { type: 'relation', id: 6, tags: { name: 'Testtown', admin_level: '6' }, members: [
        { type: 'way', ref: 1, role: 'outer', geometry: ring(121.0, 14.6, 121.1, 14.7) },
        { type: 'way', ref: 2, role: 'inner', geometry: ring(121.04, 14.64, 121.06, 14.66) },
      ] },
      { type: 'relation', id: 4, tags: { name: 'Testprovince', admin_level: '4' }, members: [
        { type: 'way', ref: 3, role: 'outer', geometry: ring(120.9, 14.5, 121.14, 14.9) },
      ] },
    ],
  };
  const b = boundariesFromOverpass(data);
  assert.equal(containsPoint(b[0], 121.02, 14.62), true);
  assert.equal(containsPoint(b[0], 121.05, 14.65), false, 'inside the hole');
  const stop = (id: string, lon: number, lat: number, name: string) =>
    emptyDraft({ external_id: id, kind: 'stop', classification: 'designated_stop', name, lon, lat });
  const inTown = stop('a', 121.02, 14.62, 'Somewhere Else Stop');
  const inHole = stop('b', 121.05, 14.65, 'Testtown Stop');
  assert.equal(assignFromBoundaries([inTown, inHole], b), 1);
  assert.equal(inTown.municipality, 'Testtown');
  assert.equal(inTown.province, 'Testprovince');
  assert.match(String(inTown.attributes.municipality_source), /relation\/6/);
  assert.equal(inHole.municipality, null, 'a name mentioning the town is not used');
});
