import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import type { PlacePoint } from './types';

interface TripBarProps {
  origin: PlacePoint | null;
  destination: PlacePoint | null;
  onClear: (which: 'origin' | 'destination') => void;
  onSwap: () => void;
  onFit: () => void;
  onPlan: () => void;
}

/** Shows the chosen start and destination, and hands them to commute search. */
export function TripBar({ origin, destination, onClear, onSwap, onFit, onPlan }: TripBarProps) {
  if (!origin && !destination) return null;

  const row = (which: 'origin' | 'destination', place: PlacePoint | null) => (
    <div className="flex min-w-0 items-center gap-2">
      {which === 'origin' ? (
        <span className="size-3 shrink-0 rounded-full border-[3px] border-brand-500" aria-hidden="true" />
      ) : (
        <Icon name="pin" className="size-4 shrink-0 text-sun-500" />
      )}
      <span className="sr-only">{which === 'origin' ? 'Start:' : 'Destination:'}</span>
      <span className={`min-w-0 flex-1 truncate text-sm ${place ? 'font-semibold' : 'text-muted'}`}>
        {place ? place.label : which === 'origin' ? 'Choose a starting point' : 'Choose a destination'}
      </span>
      {place && (
        <button
          type="button"
          aria-label={`Clear ${which === 'origin' ? 'starting point' : 'destination'}`}
          onClick={() => onClear(which)}
          className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2"
        >
          <Icon name="x" className="size-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <section aria-label="Your trip" className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 animate-rise">
      <div className="min-w-0 flex-1 space-y-1.5">
        {row('origin', origin)}
        {row('destination', destination)}
      </div>
      <div className="flex gap-1">
        <button type="button" onClick={onSwap} aria-label="Swap start and destination" className="grid size-10 place-items-center rounded-xl hover:bg-surface-2">
          <Icon name="swap" className="size-4" />
        </button>
        <button type="button" onClick={onFit} aria-label="Show both on the map" className="grid size-10 place-items-center rounded-xl hover:bg-surface-2">
          <Icon name="map" className="size-4" />
        </button>
        <Button size="sm" className="h-10" disabled={!origin || !destination} onClick={onPlan}>
          Plan trip
        </Button>
      </div>
    </section>
  );
}
