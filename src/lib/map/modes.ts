import type { Mode } from '../../types/transport';

/**
 * Colors for database transport mode codes (transport_modes.code).
 * MapLibre needs real color values, so these are hex, chosen to match the
 * Tailwind mode colors used elsewhere in the app.
 */
const MODE_COLORS: Record<string, string> = {
  jeepney: '#eda70f',
  modern_jeepney: '#2a9a88',
  city_bus: '#0ea5e9',
  provincial_bus: '#0369a1',
  p2p_bus: '#6366f1',
  uv_express: '#8b5cf6',
  tricycle: '#f97316',
  e_trike: '#ea580c',
  lrt: '#e11d48',
  mrt: '#be123c',
  commuter_rail: '#9f1239',
  ferry: '#0891b2',
};

export function modeColor(code: string | undefined | null): string {
  return (code && MODE_COLORS[code]) || '#64748b';
}

/** Which of the app's icons to draw for a database mode code. */
export function iconModeFor(code: string): Mode | null {
  switch (code) {
    case 'jeepney':
      return 'jeepney';
    case 'modern_jeepney':
      return 'modern_jeepney';
    case 'city_bus':
    case 'provincial_bus':
    case 'p2p_bus':
      return 'bus';
    case 'uv_express':
      return 'uv_express';
    case 'tricycle':
    case 'e_trike':
      return 'tricycle';
    case 'lrt':
    case 'mrt':
    case 'commuter_rail':
      return 'rail';
    default:
      return null;
  }
}
