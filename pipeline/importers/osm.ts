/**
 * OpenStreetMap importer: Overpass responses → candidates.
 * The pure part (buildOsmCandidates) is tested offline with fixtures.
 */
import type { ImportAreaConfig } from '../config/areas';
import { classifyOsmPlace, classifyOsmRoute } from '../lib/osmClassify';
import type { OsmElement, OverpassResponse } from '../lib/overpass';
import { buildRoutePath, type Coords } from '../lib/routeGeometry';
import { cleanName, splitList, uniqueStrings } from '../lib/text';
import { emptyDraft, type DraftCandidate } from '../lib/types';

/** Tags that may be stored. Everything else (and all user metadata) is dropped. */
function keepTags(tags: Record<string, string> | undefined): Record<string, string> {
  return { ...(tags ?? {}) };
}

function osmUrl(el: Pick<OsmElement, 'type' | 'id'>): string {
  return `https://www.openstreetmap.org/${el.type}/${el.id}`;
}

function osmId(el: Pick<OsmElement, 'type' | 'id'>): string {
  return `osm:${el.type}/${el.id}`;
}

function altNames(tags: Record<string, string>): string[] {
  const name = cleanName(tags.name);
  return uniqueStrings(
    ['alt_name', 'old_name', 'loc_name', 'official_name', 'short_name', 'name:en', 'name:tl', 'name:fil']
      .flatMap((k) => splitList(tags[k]))
      .filter((n) => n !== name),
  );
}

function pointOf(el: OsmElement): { lon: number | null; lat: number | null } {
  if (typeof el.lon === 'number' && typeof el.lat === 'number') return { lon: el.lon, lat: el.lat };
  if (el.center) return { lon: el.center.lon, lat: el.center.lat };
  return { lon: null, lat: null }; // never guessed
}

function placeDraft(el: OsmElement, area: ImportAreaConfig | null): DraftCandidate | null {
  const tags = el.tags ?? {};
  const cls = classifyOsmPlace(tags);
  if (!cls || cls.kind === 'route') return null;
  const { lon, lat } = pointOf(el);
  return emptyDraft({
    external_id: osmId(el),
    external_url: osmUrl(el),
    kind: cls.kind,
    classification: cls.classification,
    name: cleanName(tags.name),
    alt_names: altNames(tags),
    ref: cleanName(tags.ref),
    operator_name: cleanName(tags.operator),
    network: cleanName(tags.network),
    mode_hints: cls.mode_hints,
    mode_confidence: cls.mode_confidence,
    area_code: area?.code ?? null,
    municipality: area?.municipality ?? null,
    province: area?.province ?? null,
    lon,
    lat,
    raw_tags: keepTags(tags),
    attributes: { priority: cls.priority, osm_type: el.type },
    upstream_version: el.version != null ? String(el.version) : null,
    upstream_timestamp: el.timestamp ?? null,
  });
}

export interface OsmAreaResult {
  areaRelationId: number | null;
  candidates: DraftCandidate[];
  upstreamTimestamp: string | null;
  notes: string[];
}

export function buildOsmCandidates(area: ImportAreaConfig, places: OverpassResponse, routes: OverpassResponse): OsmAreaResult {
  const notes: string[] = [];
  const candidates: DraftCandidate[] = [];

  // The boundary relation(s) printed by "out ids tags" in the area selector.
  const boundaries = [...places.elements, ...routes.elements].filter(
    (e) => e.type === 'relation' && e.tags?.boundary === 'administrative',
  );
  const boundaryIds = [...new Set(boundaries.map((b) => b.id))];
  if (boundaryIds.length === 0) {
    throw new Error(`No OpenStreetMap boundary found for ${area.name}. Check osm.nameRegex/adminLevel in pipeline/config/areas.ts.`);
  }
  if (boundaryIds.length > 1) {
    throw new Error(`${boundaryIds.length} boundaries matched ${area.name} (${boundaryIds.join(', ')}). Make osm.nameRegex more specific.`);
  }

  // ---- places inside the area ----
  for (const el of places.elements) {
    if (el.tags?.boundary === 'administrative') continue;
    const draft = placeDraft(el, area);
    if (draft) candidates.push(draft);
  }

  // ---- route relations touching the area ----
  const ways = new Map<number, Coords>();
  const nodes = new Map<number, OsmElement>();
  for (const el of routes.elements) {
    if (el.type === 'way' && el.geometry) ways.set(el.id, el.geometry.map((g) => [g.lon, g.lat] as [number, number]));
    if (el.type === 'node') nodes.set(el.id, el);
  }

  for (const rel of routes.elements) {
    if (rel.type !== 'relation') continue;
    const tags = rel.tags ?? {};
    const cls = classifyOsmRoute(tags);
    if (!cls) continue; // not a public transport route (e.g. the boundary)

    const members = rel.members ?? [];
    const wayMembers = members.filter((m) => m.type === 'way' && !/platform/.test(m.role));
    const path = buildRoutePath(wayMembers.map((m) => ways.get(m.ref) ?? null));
    const stopMembers = members.filter((m) => m.type === 'node' && /^(stop|platform)(_entry_only|_exit_only)?$|^$/.test(m.role));

    // Member stops become candidates too (they may be outside the area).
    const memberRefs: { external_id: string; role: string }[] = [];
    for (const m of stopMembers) {
      const node = nodes.get(m.ref);
      if (!node) continue;
      const draft = placeDraft(node, null);
      if (!draft) continue; // a member node that is not tagged as a stop is ignored
      candidates.push(draft);
      memberRefs.push({ external_id: draft.external_id, role: m.role || 'stop' });
    }

    candidates.push(
      emptyDraft({
        external_id: osmId(rel),
        external_url: osmUrl(rel),
        kind: 'route',
        classification: 'route',
        name: cleanName(tags.name),
        alt_names: altNames(tags),
        ref: cleanName(tags.ref),
        operator_name: cleanName(tags.operator),
        network: cleanName(tags.network),
        from_label: cleanName(tags.from),
        to_label: cleanName(tags.to),
        mode_hints: cls.mode_hints,
        mode_confidence: cls.mode_confidence,
        area_code: area.code,
        path: path.coordinates ? { type: 'LineString', coordinates: path.coordinates } : null,
        path_complete: path.complete,
        members: memberRefs,
        raw_tags: keepTags(tags),
        attributes: {
          osm_type: 'relation',
          way_count: wayMembers.length,
          path_parts: path.parts,
          missing_ways: path.missingWays,
          ptv2: tags['public_transport:version'] === '2',
        },
        upstream_version: rel.version != null ? String(rel.version) : null,
        upstream_timestamp: rel.timestamp ?? null,
      }),
    );
  }

  // Prefer an area assignment over "found only as a route member".
  const byId = new Map<string, DraftCandidate>();
  for (const c of candidates) {
    const existing = byId.get(c.external_id);
    if (!existing || (!existing.area_code && c.area_code)) byId.set(c.external_id, c);
  }

  const upstream = places.osm3s?.timestamp_osm_base ?? routes.osm3s?.timestamp_osm_base ?? null;
  if (!upstream) notes.push('Overpass did not report the data timestamp.');
  return { areaRelationId: boundaryIds[0], candidates: [...byId.values()], upstreamTimestamp: upstream, notes };
}
