import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import maplibregl, {
  type GeoJSONSource,
  type LayerSpecification,
  type Map as MlMap,
  type Marker as MlMarker,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection, Point } from 'geojson';
import { PH_MAX_BOUNDS, PILOT_BOUNDS, type Bbox } from '../../lib/map/config';
import type { RouteFeature } from '../../lib/map/data';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';

/**
 * The MapLibre map. React owns the data; this component pushes it into
 * MapLibre sources/layers and reports clicks and view changes back.
 *
 * Tiles: OpenFreeMap (OpenStreetMap data). Attribution is part of the style
 * and is shown by MapLibre's attribution control. We never pre-download or
 * bulk-cache tiles; the browser caches them per the server's headers.
 */

export interface LngLat {
  lon: number;
  lat: number;
}

export interface LocationProps {
  id: string;
  kind: 'terminal' | 'stop';
  name: string;
  status: string;
}

export interface MapView {
  bbox: Bbox;
  zoom: number;
}

export interface MapApi {
  flyTo: (point: LngLat, zoom?: number) => void;
  fitBounds: (bbox: Bbox, maxZoom?: number) => void;
  resetView: () => void;
}

interface InteractiveMapProps {
  styleUrl: string;
  fallbackStyleUrl: string;
  locations: FeatureCollection<Point, LocationProps>;
  selectedId: string | null;
  route: RouteFeature | null;
  routeColor: string;
  origin: LngLat | null;
  destination: LngLat | null;
  searched: LngLat | null;
  user: (LngLat & { accuracy: number }) | null;
  onView: (view: MapView) => void;
  onSelect: (selection: { id: string; kind: 'terminal' | 'stop' }) => void;
  onReady: (api: MapApi) => void;
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const SOURCE_LOCATIONS = 'lakbay-locations';
const SOURCE_ROUTE = 'lakbay-route';
const POINT_LAYERS = ['lakbay-terminals', 'lakbay-stops'];

function routeData(route: RouteFeature | null, color: string): FeatureCollection {
  if (!route) return EMPTY;
  return { type: 'FeatureCollection', features: [{ ...route, properties: { ...route.properties, color } }] };
}

/** Adds LAKBAY's sources and layers on top of whatever base style is loaded. */
function addLakbayLayers(map: MlMap, props: InteractiveMapProps) {
  if (!map.getSource(SOURCE_ROUTE)) {
    map.addSource(SOURCE_ROUTE, { type: 'geojson', data: routeData(props.route, props.routeColor) });
  }
  if (!map.getSource(SOURCE_LOCATIONS)) {
    map.addSource(SOURCE_LOCATIONS, {
      type: 'geojson',
      data: props.locations,
      cluster: true,
      clusterRadius: 48,
      clusterMaxZoom: 15,
    });
  }

  const add = (layer: LayerSpecification) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  };

  add({
    id: 'lakbay-route-casing',
    type: 'line',
    source: SOURCE_ROUTE,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#0b1122', 'line-width': 9, 'line-opacity': 0.35 },
  });
  add({
    id: 'lakbay-route-line',
    type: 'line',
    source: SOURCE_ROUTE,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ['coalesce', ['get', 'color'], '#2a9a88'], 'line-width': 5 },
  });
  add({
    id: 'lakbay-clusters',
    type: 'circle',
    source: SOURCE_LOCATIONS,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#131d38',
      'circle-stroke-color': '#f9c440',
      'circle-stroke-width': 2.5,
      'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 26],
    },
  });
  add({
    id: 'lakbay-cluster-count',
    type: 'symbol',
    source: SOURCE_LOCATIONS,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#ffffff' },
  });
  add({
    id: 'lakbay-stops',
    type: 'circle',
    source: SOURCE_LOCATIONS,
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'kind'], 'stop']],
    paint: {
      'circle-color': '#1f7c6e',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 7],
      'circle-stroke-color': ['case', ['==', ['get', 'status'], 'needs_recheck'], '#f97316', '#ffffff'],
      'circle-stroke-width': 2,
    },
  });
  add({
    id: 'lakbay-terminals',
    type: 'circle',
    source: SOURCE_LOCATIONS,
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'kind'], 'terminal']],
    paint: {
      'circle-color': '#131d38',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 6, 16, 11],
      'circle-stroke-color': ['case', ['==', ['get', 'status'], 'needs_recheck'], '#f97316', '#f9c440'],
      'circle-stroke-width': 3,
    },
  });
  add({
    id: 'lakbay-selected',
    type: 'circle',
    source: SOURCE_LOCATIONS,
    filter: ['==', ['get', 'id'], props.selectedId ?? ''],
    paint: {
      'circle-color': 'rgba(0,0,0,0)',
      'circle-radius': 17,
      'circle-stroke-color': '#3fb6a2',
      'circle-stroke-width': 3,
    },
  });
  add({
    id: 'lakbay-terminal-labels',
    type: 'symbol',
    source: SOURCE_LOCATIONS,
    minzoom: 14,
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'kind'], 'terminal']],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-offset': [0, 1.3],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: { 'text-color': '#0b1122', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
  });
}

function markerElement(kind: 'origin' | 'destination' | 'searched' | 'user', label: string): HTMLElement {
  // MapLibre positions the outer element with CSS transform, so the shape
  // (which is rotated for pins) lives on an inner element.
  const el = document.createElement('div');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  el.className = 'lakbay-marker';
  const shape = document.createElement('div');
  shape.className = `lakbay-marker--${kind}`;
  el.appendChild(shape);
  return el;
}

export default function InteractiveMap(props: InteractiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const propsRef = useRef(props);
  const markersRef = useRef<Partial<Record<'origin' | 'destination' | 'searched' | 'user', MlMarker>>>({});
  const currentStyleRef = useRef(props.styleUrl);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);

  // Event handlers always read the latest props.
  useLayoutEffect(() => {
    propsRef.current = props;
  });

  // Create the map once (and again after "Try again").
  useEffect(() => {
    if (!containerRef.current) return;
    let loaded = false;
    setStatus('loading');
    currentStyleRef.current = propsRef.current.styleUrl;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: propsRef.current.styleUrl,
      bounds: PILOT_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      maxBounds: PH_MAX_BOUNDS,
      minZoom: 5,
      maxZoom: 19,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    const emitView = () => {
      const b = map.getBounds();
      propsRef.current.onView({ bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zoom: map.getZoom() });
    };

    map.on('style.load', () => addLakbayLayers(map, propsRef.current));
    map.on('load', () => {
      loaded = true;
      setStatus('ready');
      emitView();
      propsRef.current.onReady({
        flyTo: (p, zoom) => map.flyTo({ center: [p.lon, p.lat], zoom: zoom ?? Math.max(map.getZoom(), 15), essential: true }),
        fitBounds: (bbox, maxZoom = 16) =>
          map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 56, maxZoom, essential: true }),
        resetView: () => map.fitBounds([[PILOT_BOUNDS[0], PILOT_BOUNDS[1]], [PILOT_BOUNDS[2], PILOT_BOUNDS[3]]], { padding: 24 }),
      });
    });
    map.on('moveend', emitView);
    map.on('error', (event) => {
      console.error('[LAKBAY] Map error:', event.error);
      if (!loaded) {
        setStatus('error');
        return;
      }
      // A failed style switch (e.g. dark style unavailable): fall back to the light style.
      const message = String(event.error?.message ?? '');
      if (/style/i.test(message) && currentStyleRef.current !== propsRef.current.fallbackStyleUrl) {
        currentStyleRef.current = propsRef.current.fallbackStyleUrl;
        map.setStyle(propsRef.current.fallbackStyleUrl, { diff: false });
      }
    });

    map.on('click', 'lakbay-clusters', async (event) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id as number | undefined;
      if (!feature || clusterId === undefined) return;
      const source = map.getSource(SOURCE_LOCATIONS) as GeoJSONSource;
      const zoom = await source.getClusterExpansionZoom(clusterId);
      const [lon, lat] = (feature.geometry as Point).coordinates;
      map.easeTo({ center: [lon, lat], zoom });
    });
    for (const layer of POINT_LAYERS) {
      map.on('click', layer, (event) => {
        const p = event.features?.[0]?.properties as LocationProps | undefined;
        if (p?.id) propsRef.current.onSelect({ id: p.id, kind: p.kind });
      });
    }
    for (const layer of [...POINT_LAYERS, 'lakbay-clusters']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }

    return () => {
      Object.values(markersRef.current).forEach((m) => m?.remove());
      markersRef.current = {};
      map.remove();
      mapRef.current = null;
    };
  }, [attempt]);

  // Light / dark base map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || currentStyleRef.current === props.styleUrl) return;
    currentStyleRef.current = props.styleUrl;
    map.setStyle(props.styleUrl, { diff: false }); // 'style.load' re-adds LAKBAY layers
  }, [props.styleUrl, status]);

  // Data → sources.
  useEffect(() => {
    (mapRef.current?.getSource(SOURCE_LOCATIONS) as GeoJSONSource | undefined)?.setData(props.locations);
  }, [props.locations, status]);

  useEffect(() => {
    (mapRef.current?.getSource(SOURCE_ROUTE) as GeoJSONSource | undefined)?.setData(
      routeData(props.route, props.routeColor),
    );
  }, [props.route, props.routeColor, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer('lakbay-selected')) map.setFilter('lakbay-selected', ['==', ['get', 'id'], props.selectedId ?? '']);
  }, [props.selectedId, status]);

  // HTML markers for trip ends, searched place and the user's location.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    const wanted = {
      origin: props.origin ? { ...props.origin, label: 'Starting point' } : null,
      destination: props.destination ? { ...props.destination, label: 'Destination' } : null,
      searched: props.searched ? { ...props.searched, label: 'Search result' } : null,
      user: props.user ? { ...props.user, label: 'Your location' } : null,
    } as const;
    for (const key of Object.keys(wanted) as (keyof typeof wanted)[]) {
      const target = wanted[key];
      const existing = markersRef.current[key];
      if (!target) {
        existing?.remove();
        delete markersRef.current[key];
      } else if (existing) {
        existing.setLngLat([target.lon, target.lat]);
      } else {
        markersRef.current[key] = new maplibregl.Marker({
          element: markerElement(key, target.label),
          anchor: key === 'destination' || key === 'searched' ? 'bottom' : 'center',
        })
          .setLngLat([target.lon, target.lat])
          .addTo(map);
      }
    }
  }, [props.origin, props.destination, props.searched, props.user, status]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface-2">
      <div ref={containerRef} className="h-full w-full" aria-label="Interactive map of the LAKBAY pilot area" role="region" />

      {status === 'loading' && (
        <div role="status" className="absolute inset-0 grid place-items-center bg-surface/80">
          <div className="flex flex-col items-center gap-2">
            <Spinner className="size-8" />
            <p className="text-sm text-muted">Loading map…</p>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div role="alert" className="absolute inset-0 grid place-items-center bg-surface p-6 text-center">
          <div>
            <p className="font-bold">The map could not load.</p>
            <p className="mt-1 text-sm text-muted">Check your internet connection. Map tiles come from an online service.</p>
            <Button className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
