/**
 * Turns OpenStreetMap tags into LAKBAY candidate types.
 *
 * Based on the Philippine tagging guide:
 * https://wiki.openstreetmap.org/wiki/Philippines/Public_transportation
 *  - jeepney, multicab and UV Express routes use route=bus; stops use share_taxi=yes
 *  - terminals: amenity=bus_station / public_transport=station
 *  - tricycle terminals: amenity=taxi + taxi_vehicle=auto_rickshaw
 *
 * IMPORTANT: roads (highway=primary, residential, ...) are NEVER transport
 * routes. Only route RELATIONS tagged as public transport become route
 * candidates, and even those are only "someone mapped this", not proof
 * that the service runs.
 */
import type { CandidateKind, ModeConfidence } from './types';

export type Tags = Record<string, string>;

export interface Classification {
  kind: CandidateKind;
  classification: string;
  mode_hints: string[];
  mode_confidence: ModeConfidence;
  /** Preference when several objects describe the same stop (higher wins). */
  priority: number;
}

const has = (tags: Tags, key: string, value?: string) =>
  value === undefined ? tags[key] !== undefined && tags[key] !== 'no' : tags[key] === value;

function text(tags: Tags): string {
  return [tags.name, tags.ref, tags.network, tags.operator, tags['name:en']].filter(Boolean).join(' ');
}

/** Mode hints from names/networks for rail (LRT, MRT, PNR). */
function railHints(tags: Tags): { hints: string[]; confidence: ModeConfidence } {
  const t = text(tags);
  const hints: string[] = [];
  if (/\bLRT\b|Light Rail/i.test(t)) hints.push('lrt');
  if (/\bMRT\b|Metro Rail/i.test(t)) hints.push('mrt');
  if (/\bPNR\b|Philippine National Railways|North.South Commuter|NSCR/i.test(t)) hints.push('commuter_rail');
  return hints.length ? { hints, confidence: 'inferred' } : { hints: [], confidence: 'unknown' };
}

/** Mode hints for road public transport stops/terminals. */
function roadHints(tags: Tags): { hints: string[]; confidence: ModeConfidence } {
  const hints = new Set<string>();
  const t = text(tags);
  if (has(tags, 'share_taxi') || /\bjeep(ney)?\b|\bPUJ\b/i.test(t)) {
    hints.add('jeepney');
    hints.add('modern_jeepney');
  }
  if (has(tags, 'share_taxi') || /\bUV\b|UV Express/i.test(t)) hints.add('uv_express');
  if (has(tags, 'bus') || /\bbus\b|\bPUB\b/i.test(t)) {
    hints.add('city_bus');
    hints.add('provincial_bus');
  }
  if (/\bP2P\b|point.to.point/i.test(t)) hints.add('p2p_bus');
  return hints.size ? { hints: [...hints], confidence: 'inferred' } : { hints: [], confidence: 'unknown' };
}

/** Classifies an OSM node/way (stop, terminal). Returns null when it is not public transport. */
export function classifyOsmPlace(tags: Tags): Classification | null {
  const isRail = has(tags, 'train') || has(tags, 'light_rail') || has(tags, 'subway') || has(tags, 'railway');

  // Rail stations
  if (tags.railway === 'station' || tags.railway === 'halt' || (tags.public_transport === 'station' && isRail)) {
    const { hints, confidence } = railHints(tags);
    return { kind: 'terminal', classification: 'rail_station', mode_hints: hints, mode_confidence: confidence, priority: 3 };
  }
  // Rail stop positions / platforms: part of a station, not separate places.
  if (isRail && (tags.public_transport === 'stop_position' || tags.public_transport === 'platform' || tags.railway === 'stop' || tags.railway === 'platform')) {
    return null;
  }

  // Road terminals
  if (tags.amenity === 'bus_station' || tags.public_transport === 'station') {
    const { hints, confidence } = roadHints(tags);
    return { kind: 'terminal', classification: 'terminal', mode_hints: hints, mode_confidence: confidence, priority: 3 };
  }

  // Tricycle terminals (can't tell tricycle from e-trike from tags)
  if (tags.amenity === 'taxi') {
    if (tags.taxi_vehicle === 'auto_rickshaw') {
      return { kind: 'terminal', classification: 'loading_bay', mode_hints: ['tricycle'], mode_confidence: 'tagged', priority: 2 };
    }
    return null; // ordinary taxi stands are out of scope
  }

  // Stops
  if (tags.highway === 'bus_stop' || tags.public_transport === 'platform') {
    const { hints, confidence } = roadHints(tags);
    return { kind: 'stop', classification: 'designated_stop', mode_hints: hints, mode_confidence: confidence, priority: 3 };
  }
  if (tags.public_transport === 'stop_position') {
    const { hints, confidence } = roadHints(tags);
    return { kind: 'stop', classification: 'designated_stop', mode_hints: hints, mode_confidence: confidence, priority: 1 };
  }
  if (has(tags, 'share_taxi', 'yes')) {
    return { kind: 'stop', classification: 'designated_stop', mode_hints: ['jeepney', 'modern_jeepney', 'uv_express'], mode_confidence: 'inferred', priority: 2 };
  }
  return null;
}

/** Public transport route relation values LAKBAY imports. Roads are never included. */
export const ROUTE_VALUES = ['bus', 'share_taxi', 'minibus', 'trolleybus', 'train', 'light_rail', 'subway', 'monorail', 'tram', 'ferry'] as const;

/** Classifies a route relation. Returns null when it is not a public transport route. */
export function classifyOsmRoute(tags: Tags): Classification | null {
  if (tags.type !== 'route' || !(ROUTE_VALUES as readonly string[]).includes(tags.route)) return null;
  const t = text(tags);
  let hints: string[] = [];
  let confidence: ModeConfidence = 'inferred';

  switch (tags.route) {
    case 'bus':
    case 'trolleybus':
      if (tags.bus === 'share_taxi' || has(tags, 'share_taxi') || has(tags, 'jeepney') || /\bjeep(ney)?\b|\bPUJ\b/i.test(t)) {
        hints = ['jeepney', 'modern_jeepney'];
      } else if (/\bUV\b|UV Express/i.test(t)) {
        hints = ['uv_express'];
      } else if (/\bP2P\b|point.to.point/i.test(t)) {
        hints = ['p2p_bus'];
      } else if (/Interregional|provincial/i.test(t)) {
        hints = ['provincial_bus'];
      } else if (/\bbus\b|\bPUB\b|City Bus/i.test(t)) {
        hints = ['city_bus', 'provincial_bus'];
      } else {
        // Philippine tagging uses route=bus for buses, jeepneys AND UV Express.
        hints = [];
        confidence = 'unknown';
      }
      break;
    case 'share_taxi':
    case 'minibus':
      hints = /\bUV\b/i.test(t) ? ['uv_express'] : ['jeepney', 'modern_jeepney', 'uv_express'];
      break;
    case 'train':
      hints = railHints(tags).hints.length ? railHints(tags).hints : ['commuter_rail'];
      break;
    case 'light_rail':
    case 'subway':
    case 'monorail':
    case 'tram': {
      const r = railHints(tags);
      hints = r.hints;
      confidence = r.confidence;
      break;
    }
    case 'ferry':
      hints = ['ferry'];
      confidence = 'tagged';
      break;
  }
  return { kind: 'route', classification: 'route', mode_hints: hints, mode_confidence: confidence, priority: 1 };
}
