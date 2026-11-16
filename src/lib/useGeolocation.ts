import { useCallback, useState } from 'react';

/**
 * The user's position, ONLY after they tap a button and the browser asks
 * for permission. Nothing is requested automatically. The position stays in
 * this page's memory: it is not saved and not sent anywhere by this hook.
 */
export type GeoState =
  | { status: 'idle' }
  | { status: 'unsupported'; message: string }
  | { status: 'locating' }
  | { status: 'located'; lon: number; lat: number; accuracy: number; at: number }
  | { status: 'denied'; message: string }
  | { status: 'error'; message: string };

export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: 'idle' });

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState({ status: 'unsupported', message: 'This browser cannot share your location.' });
      return;
    }
    if (!window.isSecureContext) {
      setState({
        status: 'unsupported',
        message: 'Location only works on a secure (https://) page or on localhost.',
      });
      return;
    }
    setState({ status: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setState({
          status: 'located',
          lon: position.coords.longitude,
          lat: position.coords.latitude,
          accuracy: position.coords.accuracy,
          at: position.timestamp,
        }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setState({
            status: 'denied',
            message: 'Location permission is off for LAKBAY. You can allow it in your browser\'s site settings.',
          });
        } else if (error.code === error.TIMEOUT) {
          setState({ status: 'error', message: 'Finding your location took too long. Try again outdoors or near a window.' });
        } else {
          setState({ status: 'error', message: 'Your location is unavailable right now.' });
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }, []);

  const clear = useCallback(() => setState({ status: 'idle' }), []);

  return { state, locate, clear };
}

/** Whether the browser already has a decision for this site (no prompt shown). */
export async function locationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    if (!navigator.permissions) return 'unknown';
    const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return result.state;
  } catch {
    return 'unknown';
  }
}
