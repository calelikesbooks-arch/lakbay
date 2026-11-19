/**
 * Geographic and data validation. Produces issues; never fixes data by guessing.
 *   blocker = cannot be promoted until resolved (e.g. no coordinates, no name)
 *   warning = reviewer must look closely (e.g. mode unknown, low precision)
 */
import { decimals, inPhilippines, isFiniteCoordinate } from './geo';
import { nameKey } from './text';
import type { DraftCandidate, Issue, Quality } from './types';
import { MODE_CODES, STOP_KINDS, TERMINAL_KINDS } from './types';

const STALE_AFTER_DAYS = 3 * 365;

export function validateCandidate(c: DraftCandidate, now = new Date()): Issue[] {
  const issues: Issue[] = [...(c.issues ?? [])];
  const add = (code: string, severity: Issue['severity'], message: string) => {
    if (!issues.some((i) => i.code === code)) issues.push({ code, severity, message });
  };

  // ---- classification ----
  if (c.kind === 'terminal' && !(TERMINAL_KINDS as readonly string[]).includes(c.classification)) {
    add('invalid_classification', 'blocker', `Unknown terminal type "${c.classification}".`);
  }
  if (c.kind === 'stop' && !(STOP_KINDS as readonly string[]).includes(c.classification)) {
    add('invalid_classification', 'blocker', `Unknown stop type "${c.classification}".`);
  }
  const badModes = c.mode_hints.filter((m) => !(MODE_CODES as readonly string[]).includes(m));
  if (badModes.length) add('invalid_mode_hint', 'blocker', `Unknown transport mode(s): ${badModes.join(', ')}.`);

  // ---- names: never invented ----
  const hasName = !!c.name || (c.kind === 'route' && !!c.ref);
  if (!hasName) {
    add('missing_name', 'blocker', 'No name in the source. LAKBAY does not invent names; confirm it in the field.');
  }

  // ---- points ----
  if (c.kind !== 'route') {
    if (!isFiniteCoordinate(c.lon, c.lat)) {
      add('missing_coordinates', 'blocker', 'No coordinates in the source. LAKBAY does not invent coordinates.');
    } else {
      const lon = c.lon as number;
      const lat = c.lat as number;
      if (Math.abs(lon) < 1e-6 && Math.abs(lat) < 1e-6) {
        add('null_island', 'blocker', 'Coordinates are 0,0 (a data error).');
      } else if (!inPhilippines(lon, lat)) {
        const swapped = inPhilippines(lat, lon);
        add(
          'outside_philippines',
          'blocker',
          swapped ? 'Coordinates are outside the Philippines; latitude and longitude look swapped.' : 'Coordinates are outside the Philippines.',
        );
      }
      if (Math.min(decimals(lon), decimals(lat)) < 4) {
        add('low_precision', 'warning', 'Coordinates have fewer than 4 decimals (about 10 m or worse).');
      }
    }
    if (!c.municipality) {
      add('municipality_unknown', 'warning', 'Outside the imported areas: the reviewer must enter the municipality.');
    }
    if (c.kind === 'stop' && /\bterminal\b/i.test(c.name ?? '')) {
      add('name_suggests_terminal', 'warning', 'Named like a terminal but tagged as a stop. Check which it is.');
    }
  }

  // ---- routes: a mapped line is not a verified service ----
  if (c.kind === 'route') {
    add('route_unconfirmed', 'warning', 'Mapped route only. It must be ridden/confirmed before it can be verified.');
    if (!c.path) {
      add(
        c.path_complete === false ? 'route_geometry_gaps' : 'route_geometry_missing',
        'warning',
        c.path_complete === false
          ? 'Route line has gaps or missing pieces, so no line is stored (gaps are never joined by guessing).'
          : 'No route line in the source.',
      );
    } else if (c.path.coordinates.some(([x, y]) => !inPhilippines(x, y))) {
      add('route_outside_philippines', 'blocker', 'Part of the route line is outside the Philippines.');
    }
    if (c.members.length === 0) add('route_no_stops', 'warning', 'No stops listed for this route.');
    if (c.raw_tags['disused:route'] || c.raw_tags.disused === 'yes' || c.raw_tags['abandoned:route']) {
      add('route_disused', 'blocker', 'Tagged as disused or abandoned in the source.');
    }
  }

  // ---- modes ----
  if ((c.kind === 'route' || c.kind === 'terminal') && c.mode_confidence === 'unknown') {
    add('mode_unknown', 'warning', 'Transport mode cannot be told from the source. The reviewer must choose it.');
  }

  // ---- source freshness / notes ----
  if (c.upstream_timestamp) {
    const ageDays = (now.getTime() - new Date(c.upstream_timestamp).getTime()) / 86_400_000;
    if (ageDays > STALE_AFTER_DAYS) add('stale_upstream', 'warning', 'Not edited in the source for over 3 years.');
  }
  if (c.raw_tags.fixme || c.raw_tags.FIXME) add('source_fixme', 'warning', `Source note: "${c.raw_tags.fixme ?? c.raw_tags.FIXME}".`);
  if (nameKey(c.name) && nameKey(c.name).length < 3) add('name_too_short', 'warning', 'Very short name; check it.');

  return issues;
}

export function qualityOf(issues: Issue[]): Quality {
  if (issues.some((i) => i.severity === 'blocker')) return 'blocked';
  if (issues.length > 0) return 'warning';
  return 'ok';
}
