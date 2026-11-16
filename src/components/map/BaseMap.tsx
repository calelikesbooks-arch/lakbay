import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { env } from '../../lib/env';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';

/**
 * Starting view only: roughly between Bocaue and Monumento so the whole pilot
 * corridor fits on screen. This is NOT a stop, terminal or route data point.
 */
const PILOT_VIEW = { center: [120.97, 14.73] as [number, number], zoom: 10.5 };

type MapStatus = 'loading' | 'ready' | 'error';

/**
 * A plain MapLibre base map. Kept in its own file so the large MapLibre
 * library is only downloaded when the Map page is opened.
 */
export default function BaseMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<MapStatus>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    let loaded = false;
    setStatus('loading');

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: env.mapStyleUrl,
      center: PILOT_VIEW.center,
      zoom: PILOT_VIEW.zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      loaded = true;
      setStatus('ready');
    });
    map.on('error', (event) => {
      console.error('[LAKBAY] Map error:', event.error);
      // Errors after loading are usually one missing tile; ignore those.
      if (!loaded) setStatus('error');
    });

    return () => map.remove();
  }, [attempt]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-line">
      <div ref={containerRef} className="h-full w-full" />

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
            <p className="font-semibold">The map could not load.</p>
            <p className="mt-1 text-sm text-muted">
              Check your internet connection. The map tiles come from an online service.
            </p>
            <Button className="mt-4" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
