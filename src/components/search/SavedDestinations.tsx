import { useLocalStore } from '../../lib/localStore';
import { savedPlacesStore, toggleSavedPlace } from '../../lib/trips';
import type { PlaceRef } from '../../types/transport';
import { Icon } from '../ui/Icon';

interface SavedDestinationsProps {
  /** When given, tapping a destination fills the search instead of nothing. */
  onPick?: (place: PlaceRef) => void;
  allowRemove?: boolean;
}

export function SavedDestinations({ onPick, allowRemove = false }: SavedDestinationsProps) {
  const saved = useLocalStore(savedPlacesStore);

  if (saved.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-line p-4 text-sm text-muted">
        No saved destinations yet. Tap the <Icon name="star" className="inline size-4 align-text-bottom" /> on a recent
        search to keep a destination here.
      </p>
    );
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {saved.map((place) => (
        <li key={place.id} className="flex items-center rounded-2xl border border-line bg-surface">
          <button
            type="button"
            disabled={!onPick}
            onClick={() => onPick?.(place)}
            className="flex items-center gap-2 rounded-l-2xl py-2 pr-2 pl-3 text-sm font-semibold text-ink enabled:hover:bg-surface-2"
          >
            <Icon name="star" className="size-4 fill-sun-400 text-sun-500" />
            {place.name}
          </button>
          {allowRemove && (
            <button
              type="button"
              onClick={() => toggleSavedPlace(place)}
              aria-label={`Remove ${place.name}`}
              className="grid size-9 place-items-center rounded-r-2xl text-muted hover:bg-surface-2"
            >
              <Icon name="x" className="size-4" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
