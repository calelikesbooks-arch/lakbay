import { useRef, useState, type FormEvent } from 'react';
import { env } from '../../lib/env';
import { geocode, type GeocodeResult } from '../../lib/geocoding';
import { searchLocations, type LocationSearchHit } from '../../lib/map/data';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import type { PlacePoint } from './types';

interface MapSearchProps {
  onShow: (place: PlacePoint) => void;
  onSetOrigin: (place: PlacePoint) => void;
  onSetDestination: (place: PlacePoint) => void;
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | {
      status: 'done';
      query: string;
      lakbay: LocationSearchHit[];
      lakbayNote: string | null;
      osm: GeocodeResult[];
      osmNote: string | null;
    };

const placeTypeLabel = (t: string) =>
  ({
    village: 'Barangay / village',
    suburb: 'District',
    quarter: 'District',
    neighbourhood: 'Neighbourhood',
    city: 'City',
    town: 'Municipality',
    municipality: 'Municipality',
    state: 'Province',
    province: 'Province',
    road: 'Street',
    bus_station: 'Station',
    station: 'Station',
  })[t] ?? t.replace(/_/g, ' ');

/**
 * Search by address, landmark, barangay, city or municipality.
 * Runs ONLY when the user presses Search (Nominatim forbids autocomplete).
 */
export function MapSearch({ onShow, onSetOrigin, onSetDestination }: MapSearchProps) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const controller = useRef<AbortController | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setState({ status: 'loading', query: q });

    const [own, osm] = await Promise.all([
      env.supabase.state === 'configured' ? searchLocations(q, ac.signal) : Promise.resolve(null),
      geocode(q, ac.signal),
    ]);
    if (ac.signal.aborted) return;

    setState({
      status: 'done',
      query: q,
      lakbay: own && own.ok ? own.data : [],
      lakbayNote: own === null ? 'LAKBAY database not connected.' : own.ok ? null : own.message,
      osm: osm.status === 'ok' ? osm.results : [],
      osmNote: osm.status === 'ok' ? null : osm.message,
    });
  }

  const rows: { key: string; place: PlacePoint; title: string; subtitle: string; badge: 'lakbay' | 'osm' }[] =
    state.status === 'done'
      ? [
          ...state.lakbay.map((hit) => ({
            key: `l-${hit.id}`,
            title: hit.name,
            subtitle: `${hit.kind === 'terminal' ? 'Terminal' : 'Stop'} · ${hit.municipality}`,
            badge: 'lakbay' as const,
            place: {
              lon: hit.lon,
              lat: hit.lat,
              label: hit.name,
              origin: 'lakbay' as const,
              location: { kind: hit.kind, id: hit.id },
            },
          })),
          ...state.osm.map((r) => ({
            key: r.id,
            title: r.name,
            subtitle: `${placeTypeLabel(r.placeType)} · ${r.context}`,
            badge: 'osm' as const,
            place: { lon: r.lon, lat: r.lat, label: r.name, origin: 'osm' as const, bbox: r.bbox },
          })),
        ]
      : [];

  return (
    <div className="relative">
      <form onSubmit={submit} role="search" className="flex gap-2">
        <label htmlFor="map-search" className="sr-only">
          Search for a place
        </label>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-line bg-surface px-3.5 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15">
          <Icon name="search" className="size-5 shrink-0 text-muted" />
          <input
            id="map-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Address, landmark, barangay, city…"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={120}
            className="h-12 w-full min-w-0 bg-transparent text-base text-ink placeholder:text-muted/70 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                setState({ status: 'idle' });
              }}
              className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2"
            >
              <Icon name="x" className="size-4" />
            </button>
          )}
        </div>
        <Button type="submit" variant="navy" className="h-12 shrink-0" disabled={query.trim().length < 2 || state.status === 'loading'}>
          {state.status === 'loading' ? <Spinner className="size-4 text-current" /> : 'Search'}
        </Button>
      </form>

      {state.status === 'done' && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 max-h-[min(60vh,28rem)] overflow-auto rounded-2xl border border-line bg-surface shadow-xl shadow-navy-950/10 animate-fade">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-sm text-muted">
              Results for <strong className="text-ink">"{state.query}"</strong>
            </p>
            <button type="button" onClick={() => setState({ status: 'idle' })} className="text-sm font-semibold text-muted hover:text-ink">
              Close
            </button>
          </div>

          {rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">No places found. Try a barangay or town name, e.g. "Poblacion, Bocaue".</p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <li key={row.key} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      onShow(row.place);
                      setState({ status: 'idle' });
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left hover:bg-surface-2"
                  >
                    <span
                      className={`grid size-9 shrink-0 place-items-center rounded-xl ${
                        row.badge === 'lakbay' ? 'bg-navy-900 text-sun-400' : 'bg-surface-2 text-muted'
                      }`}
                    >
                      <Icon name={row.badge === 'lakbay' ? 'route' : 'pin'} className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink">{row.title}</span>
                      <span className="block truncate text-xs text-muted">{row.subtitle}</span>
                    </span>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="secondary" onClick={() => { onSetOrigin(row.place); setState({ status: 'idle' }); }}>
                      Start
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => { onSetDestination(row.place); setState({ status: 'idle' }); }}>
                      Go here
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-1 border-t border-line px-4 py-2.5 text-[11px] text-muted">
            {state.lakbayNote && <p>LAKBAY places: {state.lakbayNote}</p>}
            {state.osmNote && <p>OpenStreetMap places: {state.osmNote}</p>}
            <p>
              Place search by{' '}
              <a href="https://nominatim.org/" target="_blank" rel="noopener noreferrer" className="underline">
                Nominatim
              </a>{' '}
              · Data ©{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">
                OpenStreetMap contributors
              </a>
              . Places from OpenStreetMap are for finding locations only, not LAKBAY transport data.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
