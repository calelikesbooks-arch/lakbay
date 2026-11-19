import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Live GPS for field checks. Starts ONLY when the moderator taps "Get my
 * position", keeps the most accurate fix while it runs, and stops by itself
 * after 45 s (or when the page closes) to save battery. Positions are never
 * cached (maximumAge 0): an old fix must not verify anything.
 */
export interface GpsFix {
  lon: number;
  lat: number;
  accuracy: number;
  at: number;
}

export type FieldGpsState =
  | { status: 'idle' }
  | { status: 'unsupported' | 'denied' | 'error'; message: string }
  | { status: 'watching'; best: GpsFix | null; samples: number }
  | { status: 'done'; best: GpsFix | null; samples: number };

const MAX_WATCH_MS = 45_000;

export function useFieldGps() {
  const [state, setState] = useState<FieldGpsState>({ status: 'idle' });
  const watchId = useRef<number | null>(null);
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    if (timer.current != null) window.clearTimeout(timer.current);
    watchId.current = null;
    timer.current = null;
    setState((s) => (s.status === 'watching' ? { status: 'done', best: s.best, samples: s.samples } : s));
  }, []);

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState({ status: 'unsupported', message: 'This browser cannot share your location.' });
      return;
    }
    if (!window.isSecureContext) {
      setState({ status: 'unsupported', message: 'Location only works on https:// or localhost.' });
      return;
    }
    stop();
    setState({ status: 'watching', best: null, samples: 0 });
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const fix: GpsFix = { lon: p.coords.longitude, lat: p.coords.latitude, accuracy: p.coords.accuracy, at: p.timestamp };
        setState((s) => {
          if (s.status !== 'watching') return s;
          const best = !s.best || fix.accuracy <= s.best.accuracy ? fix : s.best;
          return { status: 'watching', best, samples: s.samples + 1 };
        });
      },
      (error) => {
        stop();
        setState(
          error.code === error.PERMISSION_DENIED
            ? { status: 'denied', message: "Location permission is off for LAKBAY. Allow it in the browser's site settings." }
            : { status: 'error', message: 'Could not get your location. Go outdoors and try again.' },
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    timer.current = window.setTimeout(stop, MAX_WATCH_MS);
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    setState({ status: 'idle' });
  }, [stop]);

  useEffect(() => stop, [stop]);

  const best = state.status === 'watching' || state.status === 'done' ? state.best : null;
  return { state, best, start, stop, reset };
}

/** Distance in meters between two points (haversine). */
export function metersBetween(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const r = 6_371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
