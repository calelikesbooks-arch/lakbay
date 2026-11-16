import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { FeatureCollection, Point } from 'geojson';
import { LoadingScreen } from '../components/feedback/LoadingScreen';
import type { LocationProps, MapApi, MapView } from '../components/map/InteractiveMap';
import { LocationControl } from '../components/map/LocationControl';
import { LocationDetailsPanel } from '../components/map/LocationDetailsPanel';
import { MapFilters } from '../components/map/MapFilters';
import { MapSearch } from '../components/map/MapSearch';
import { MapStatus } from '../components/map/MapStatus';
import { TripBar } from '../components/map/TripBar';
import type { PlacePoint, Selection } from '../components/map/types';
import { VisibleLocationsList } from '../components/map/VisibleLocationsList';
import { Icon } from '../components/ui/Icon';
import { PageHeader } from '../components/ui/PageHeader';
import { env } from '../lib/env';
import { bboxOf } from '../lib/map/config';
import {
  fetchLocationCounts,
  fetchModes,
  fetchRouteGeometry,
  type MapLocation,
  type RouteFeature,
  type ServingRoute,
  type TransportModeInfo,
} from '../lib/map/data';
import { modeColor } from '../lib/map/modes';
import { useMapLocations } from '../lib/map/useMapLocations';
import { useGeolocation } from '../lib/useGeolocation';
import { useTheme } from '../theme/ThemeContext';

// MapLibre is large: load it only when this page opens.
const InteractiveMap = lazy(() => import('../components/map/InteractiveMap'));

export default function MapPage() {
  const navigate = useNavigate();
  const { resolved: theme } = useTheme();
  const apiRef = useRef<MapApi | null>(null);

  // ---- view + data -------------------------------------------------------
  const [view, setView] = useState<MapView | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const { status, locations } = useMapLocations(view, reloadToken);
  const [totals, setTotals] = useState<{ terminals: number; stops: number } | null>(null);
  const [modes, setModes] = useState<TransportModeInfo[]>([]);

  useEffect(() => {
    if (env.supabase.state !== 'configured') return;
    fetchLocationCounts().then((r) => r.ok && setTotals(r.data));
    fetchModes().then((r) => r.ok && setModes(r.data));
  }, [reloadToken]);

  // ---- filters --------------------------------------------------------------
  const [selectedModes, setSelectedModes] = useState<Set<string>>(new Set());
  const [showTerminals, setShowTerminals] = useState(true);
  const [showStops, setShowStops] = useState(true);

  const filtered = useMemo(
    () =>
      locations.filter((l) => {
        if (l.kind === 'terminal' && !showTerminals) return false;
        if (l.kind === 'stop' && !showStops) return false;
        if (selectedModes.size === 0) return true;
        return l.modes.some((m) => selectedModes.has(m));
      }),
    [locations, showTerminals, showStops, selectedModes],
  );

  const featureCollection = useMemo<FeatureCollection<Point, LocationProps>>(
    () => ({
      type: 'FeatureCollection',
      features: filtered.map((l) => ({
        type: 'Feature',
        id: l.id,
        geometry: { type: 'Point', coordinates: [l.lon, l.lat] },
        properties: { id: l.id, kind: l.kind, name: l.name, status: l.status },
      })),
    }),
    [filtered],
  );

  const modeLabels = useMemo(() => Object.fromEntries(modes.map((m) => [m.code, m.label])), [modes]);

  // ---- selection, route line ------------------------------------------------
  const [selection, setSelection] = useState<Selection | null>(null);
  const [route, setRoute] = useState<{ variantId: string; feature: RouteFeature; color: string } | null>(null);
  const [routeLoadingId, setRouteLoadingId] = useState<string | null>(null);
  const [routeMessage, setRouteMessage] = useState<string | null>(null);

  const selectLocation = useCallback((l: MapLocation, fly = false) => {
    setSelection({ kind: l.kind, id: l.id, name: l.name, lon: l.lon, lat: l.lat });
    setRouteMessage(null);
    if (fly) apiRef.current?.flyTo({ lon: l.lon, lat: l.lat }, 16);
  }, []);

  const onMapSelect = useCallback(
    ({ id }: { id: string; kind: 'terminal' | 'stop' }) => {
      const l = locations.find((x) => x.id === id);
      if (l) selectLocation(l);
    },
    [locations, selectLocation],
  );

  async function toggleRoute(r: ServingRoute) {
    if (route?.variantId === r.variantId) {
      setRoute(null);
      return;
    }
    setRouteLoadingId(r.variantId);
    setRouteMessage(null);
    const result = await fetchRouteGeometry(r.variantId);
    setRouteLoadingId(null);
    if (!result.ok) {
      setRouteMessage(result.message);
      return;
    }
    if (!result.data) {
      setRouteMessage('This route line is not verified yet, so it is not shown.');
      return;
    }
    setRoute({ variantId: r.variantId, feature: result.data, color: modeColor(r.modeCode) });
    const box = bboxOf(result.data.geometry.coordinates as [number, number][]);
    if (box) apiRef.current?.fitBounds(box);
  }

  // ---- trip ends, search, location -----------------------------------------
  const [origin, setOrigin] = useState<PlacePoint | null>(null);
  const [destination, setDestination] = useState<PlacePoint | null>(null);
  const [searched, setSearched] = useState<PlacePoint | null>(null);
  const geo = useGeolocation();

  const showPlace = (p: PlacePoint) => {
    setSearched(p.location ? null : p);
    if (p.bbox && p.bbox[2] - p.bbox[0] > 0.005) apiRef.current?.fitBounds(p.bbox, 16);
    else apiRef.current?.flyTo(p, 16);
    if (p.location) {
      const known = locations.find((l) => l.id === p.location?.id);
      setSelection({ kind: p.location.kind, id: p.location.id, name: p.label, lon: p.lon, lat: p.lat });
      if (known) selectLocation(known);
    }
  };

  const fitTrip = useCallback((a: PlacePoint | null, b: PlacePoint | null) => {
    const points = [a, b].filter((p): p is PlacePoint => !!p).map((p) => [p.lon, p.lat] as [number, number]);
    const box = bboxOf(points);
    if (!box) return;
    if (points.length === 1) apiRef.current?.flyTo({ lon: points[0][0], lat: points[0][1] }, 15);
    else apiRef.current?.fitBounds(box, 15);
  }, []);

  const setTripEnd = (which: 'origin' | 'destination', p: PlacePoint) => {
    setSearched(null);
    if (which === 'origin') {
      setOrigin(p);
      fitTrip(p, destination);
    } else {
      setDestination(p);
      fitTrip(origin, p);
    }
  };

  // Center on the user once their location arrives.
  useEffect(() => {
    if (geo.state.status === 'located') apiRef.current?.flyTo({ lon: geo.state.lon, lat: geo.state.lat }, 16);
  }, [geo.state]);

  const userPoint = geo.state.status === 'located' ? { lon: geo.state.lon, lat: geo.state.lat, accuracy: geo.state.accuracy } : null;

  const planTrip = () => {
    if (!origin || !destination) return;
    const params = new URLSearchParams({ from: origin.label, to: destination.label });
    navigate(`/search?${params.toString()}`);
  };

  const center = view ? { lon: (view.bbox[0] + view.bbox[2]) / 2, lat: (view.bbox[1] + view.bbox[3]) / 2 } : null;
  const styleUrl = theme === 'dark' ? env.mapStyleUrlDark : env.mapStyleUrl;

  return (
    <div className="space-y-3">
      <PageHeader eyebrow="Mapa" title="Interactive map" description="Verified terminals and stops in the pilot area. Search a place, tap a marker for details." />

      <MapSearch onShow={showPlace} onSetOrigin={(p) => setTripEnd('origin', p)} onSetDestination={(p) => setTripEnd('destination', p)} />

      <TripBar
        origin={origin}
        destination={destination}
        onClear={(w) => (w === 'origin' ? setOrigin(null) : setDestination(null))}
        onSwap={() => {
          setOrigin(destination);
          setDestination(origin);
        }}
        onFit={() => fitTrip(origin, destination)}
        onPlan={planTrip}
      />

      {modes.length > 0 && (
        <MapFilters
          modes={modes}
          selectedModes={selectedModes}
          onToggleMode={(code) =>
            setSelectedModes((prev) => {
              const next = new Set(prev);
              if (next.has(code)) next.delete(code);
              else next.add(code);
              return next;
            })
          }
          onClearModes={() => setSelectedModes(new Set())}
          showTerminals={showTerminals}
          showStops={showStops}
          onToggleTerminals={() => setShowTerminals((v) => !v)}
          onToggleStops={() => setShowStops((v) => !v)}
        />
      )}

      <div className="relative h-[64dvh] min-h-96 md:h-[70dvh]">
        <Suspense fallback={<LoadingScreen label="Loading map…" />}>
          <InteractiveMap
            styleUrl={styleUrl}
            fallbackStyleUrl={env.mapStyleUrl}
            locations={featureCollection}
            selectedId={selection?.id ?? null}
            route={route?.feature ?? null}
            routeColor={route?.color ?? '#2a9a88'}
            origin={origin}
            destination={destination}
            searched={searched}
            user={userPoint}
            onView={setView}
            onSelect={onMapSelect}
            onReady={(api) => (apiRef.current = api)}
          />
        </Suspense>

        {/* Status / empty state */}
        <div className="pointer-events-none absolute top-3 left-3 right-16 z-10 flex">
          <MapStatus
            status={status}
            totals={totals}
            shownCount={filtered.length}
            loadedCount={locations.length}
            onRetry={() => setReloadToken((n) => n + 1)}
          />
        </div>

        {/* Map buttons */}
        <div className={`absolute right-3 z-10 flex flex-col items-end gap-2 ${selection ? 'bottom-3 max-md:hidden md:right-[25.5rem]' : 'bottom-10'}`}>
          <button
            type="button"
            onClick={() => apiRef.current?.resetView()}
            aria-label="Show the whole pilot area"
            title="Pilot area"
            className="grid size-11 place-items-center rounded-2xl border border-line bg-surface text-ink shadow-lg hover:bg-surface-2"
          >
            <Icon name="compass" className="size-5" />
          </button>
          <LocationControl
            state={geo.state}
            onLocate={geo.locate}
            onClear={geo.clear}
            onUseAsStart={() => {
              if (geo.state.status === 'located') {
                setTripEnd('origin', { lon: geo.state.lon, lat: geo.state.lat, label: 'My location', origin: 'gps' });
              }
            }}
          />
        </div>

        {selection && (
          <LocationDetailsPanel
            selection={selection}
            activeVariantId={route?.variantId ?? null}
            routeLoadingId={routeLoadingId}
            routeMessage={routeMessage}
            onClose={() => {
              setSelection(null);
              setRoute(null);
            }}
            onToggleRoute={toggleRoute}
            onSetOrigin={() => setTripEnd('origin', { lon: selection.lon, lat: selection.lat, label: selection.name, origin: 'lakbay', location: { kind: selection.kind, id: selection.id } })}
            onSetDestination={() =>
              setTripEnd('destination', { lon: selection.lon, lat: selection.lat, label: selection.name, origin: 'lakbay', location: { kind: selection.kind, id: selection.id } })
            }
          />
        )}
      </div>

      <VisibleLocationsList
        locations={filtered}
        center={center}
        modeLabels={modeLabels}
        selectedId={selection?.id ?? null}
        onSelect={(l) => selectLocation(l, true)}
      />

      <p className="text-xs text-muted">
        Map tiles: OpenFreeMap · Map data © OpenStreetMap contributors. Terminals, stops and routes are LAKBAY's verified research data.
        Your location is used only on this device and only after you allow it.
      </p>
    </div>
  );
}
