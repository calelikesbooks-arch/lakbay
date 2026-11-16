import type { MapLocation } from '../../lib/map/data';
import { formatDistance } from '../../lib/format';
import { Icon } from '../ui/Icon';
import { MapModeChip } from './MapModeChip';

interface VisibleLocationsListProps {
  locations: MapLocation[];
  center: { lon: number; lat: number } | null;
  modeLabels: Record<string, string>;
  selectedId: string | null;
  onSelect: (location: MapLocation) => void;
}

function metersBetween(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

/**
 * Text list of the locations on the map, nearest to the map center first.
 * Also the keyboard- and screen-reader-friendly way to pick a marker.
 */
export function VisibleLocationsList({ locations, center, modeLabels, selectedId, onSelect }: VisibleLocationsListProps) {
  if (locations.length === 0) return null;
  const sorted = center
    ? [...locations].map((l) => ({ l, d: metersBetween(center, l) })).sort((a, b) => a.d - b.d)
    : locations.map((l) => ({ l, d: null as number | null }));

  return (
    <section aria-labelledby="visible-heading">
      <h2 id="visible-heading" className="mb-2.5 text-xs font-bold tracking-wider text-muted uppercase">
        On the map ({locations.length})
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {sorted.slice(0, 30).map(({ l, d }) => (
          <li key={l.id}>
            <button
              type="button"
              onClick={() => onSelect(l)}
              aria-pressed={selectedId === l.id}
              className={`flex w-full items-start gap-3 rounded-2xl border bg-surface p-3 text-left ${
                selectedId === l.id ? 'border-brand-500' : 'border-line hover:bg-surface-2/60'
              }`}
            >
              <span
                className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl ${
                  l.kind === 'terminal' ? 'bg-navy-900 text-sun-400' : 'bg-brand-600 text-white'
                }`}
              >
                <Icon name={l.kind === 'terminal' ? 'route' : 'pin'} className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{l.name}</span>
                <span className="block text-xs text-muted">
                  {l.kind === 'terminal' ? 'Terminal' : 'Stop'} · {l.municipality}
                  {d !== null && ` · ${formatDistance(d)} from map center`}
                </span>
                {l.modes.length > 0 && (
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {l.modes.map((m) => (
                      <MapModeChip key={m} code={m} label={modeLabels[m] ?? m} />
                    ))}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {locations.length > 30 && <p className="mt-2 text-xs text-muted">Showing the 30 nearest. Zoom in to narrow the list.</p>}
    </section>
  );
}
