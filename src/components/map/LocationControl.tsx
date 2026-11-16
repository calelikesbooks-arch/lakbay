import { useState } from 'react';
import { locationPermission, type GeoState } from '../../lib/useGeolocation';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';

interface LocationControlProps {
  state: GeoState;
  onLocate: () => void;
  onClear: () => void;
  onUseAsStart: () => void;
}

/**
 * "My location" button. Before the browser's own permission prompt, LAKBAY
 * explains why it wants the location. Nothing happens without a tap.
 */
export function LocationControl({ state, onLocate, onClear, onUseAsStart }: LocationControlProps) {
  const [explaining, setExplaining] = useState(false);

  async function start() {
    const permission = await locationPermission();
    if (permission === 'granted') onLocate();
    else setExplaining(true);
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {explaining && (
        <div role="dialog" aria-labelledby="loc-title" className="w-72 rounded-2xl border border-line bg-surface p-4 text-left shadow-xl animate-rise">
          <p id="loc-title" className="font-bold">
            Use your location?
          </p>
          <p className="mt-1 text-sm text-muted">
            LAKBAY uses it only on this device to center the map and show verified stops nearby. It is not saved or shared.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setExplaining(false);
                onLocate();
              }}
            >
              Allow
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setExplaining(false)}>
              Not now
            </Button>
          </div>
        </div>
      )}

      {(state.status === 'denied' || state.status === 'error' || state.status === 'unsupported') && (
        <div role="alert" className="w-72 rounded-2xl border border-line bg-surface p-3 text-sm shadow-lg">
          <p>{state.message}</p>
          <button type="button" onClick={onClear} className="mt-1 text-xs font-semibold text-muted underline">
            Dismiss
          </button>
        </div>
      )}

      {state.status === 'located' && (
        <div className="w-72 rounded-2xl border border-line bg-surface p-3 text-sm shadow-lg">
          <p className="font-semibold">Showing your location</p>
          <p className="text-xs text-muted">Accuracy about {Math.round(state.accuracy)} m</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" onClick={onUseAsStart}>
              Use as start
            </Button>
            <Button size="sm" variant="ghost" onClick={onClear}>
              Stop
            </Button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={start}
        disabled={state.status === 'locating'}
        aria-label="Show my location"
        className="grid size-11 place-items-center rounded-2xl border border-line bg-surface text-ink shadow-lg hover:bg-surface-2"
      >
        {state.status === 'locating' ? <Spinner className="size-5" /> : <Icon name="origin" className="size-5" />}
      </button>
    </div>
  );
}
