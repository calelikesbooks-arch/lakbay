import { useEffect, useRef, useState } from 'react';
import { env } from '../env';
import { bboxArea, bboxContains, MAX_QUERY_AREA_DEG2, MIN_DATA_ZOOM, padBbox, type Bbox } from './config';
import { fetchLocationsInBbox, type MapLocation } from './data';

export type LocationsStatus =
  | 'not_configured'
  | 'zoom_in'
  | 'loading'
  | 'ready'
  | 'error';

/**
 * Loads verified terminals and stops for the visible map area.
 * Efficiency:
 *  - waits until the map stops moving (350 ms)
 *  - loads a box 30% larger than the screen, and skips new requests while
 *    the view stays inside it
 *  - cancels a request that is outdated by a newer view
 *  - asks nothing below zoom 11 (too wide an area)
 */
export function useMapLocations(view: { bbox: Bbox; zoom: number } | null, reloadToken: number) {
  const [status, setStatus] = useState<LocationsStatus>(
    env.supabase.state === 'configured' ? 'loading' : 'not_configured',
  );
  const [locations, setLocations] = useState<MapLocation[]>([]);
  const loadedBox = useRef<Bbox | null>(null);
  const lastToken = useRef(reloadToken);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (env.supabase.state !== 'configured') {
      setStatus('not_configured');
      return;
    }
    if (!view) return;
    if (view.zoom < MIN_DATA_ZOOM) {
      setStatus('zoom_in');
      return;
    }

    const forced = lastToken.current !== reloadToken;
    lastToken.current = reloadToken;
    if (!forced && loadedBox.current && bboxContains(loadedBox.current, view.bbox)) {
      setStatus('ready');
      return;
    }

    const timer = window.setTimeout(async () => {
      let box = padBbox(view.bbox, 0.3);
      if (bboxArea(box) > MAX_QUERY_AREA_DEG2) box = view.bbox;
      if (bboxArea(box) > MAX_QUERY_AREA_DEG2) {
        setStatus('zoom_in');
        return;
      }
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      setStatus('loading');
      const result = await fetchLocationsInBbox(box, ac.signal);
      if (ac.signal.aborted) return;
      if (result.ok) {
        loadedBox.current = box;
        setLocations(result.data);
        setStatus('ready');
      } else if (result.reason === 'not_configured') {
        setStatus('not_configured');
      } else if (result.reason === 'error') {
        loadedBox.current = null;
        setStatus('error');
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [view, reloadToken]);

  useEffect(() => () => controller.current?.abort(), []);

  return { status, locations };
}
