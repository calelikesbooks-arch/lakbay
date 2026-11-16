import { pilotAreas, pilotDestinationIds } from '../../data/pilot';
import type { PlaceRef } from '../../types/transport';
import { Icon } from '../ui/Icon';

interface QuickShortcutsProps {
  onPickDestination: (place: PlaceRef) => void;
  selectedId?: string;
}

/** One-tap destinations from the pilot scope (Monumento, SM North EDSA, Cubao). */
export function QuickShortcuts({ onPickDestination, selectedId }: QuickShortcutsProps) {
  const destinations = pilotDestinationIds
    .map((id) => pilotAreas.find((p) => p.id === id))
    .filter((p): p is PlaceRef => !!p);

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
      {destinations.map((place) => {
        const selected = place.id === selectedId;
        return (
          <button
            key={place.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onPickDestination(place)}
            className={`flex shrink-0 items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-left transition-colors ${
              selected
                ? 'border-sun-400 bg-sun-100 dark:border-sun-400/60 dark:bg-sun-400/15'
                : 'border-line bg-surface hover:border-sun-300'
            }`}
          >
            <span className="grid size-8 place-items-center rounded-xl bg-sun-400 text-navy-950">
              <Icon name="pin" className="size-4" />
            </span>
            <span>
              <span className="block text-sm font-bold text-ink">{place.name}</span>
              <span className="block text-xs text-muted">{place.locality?.split(',')[0]}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
