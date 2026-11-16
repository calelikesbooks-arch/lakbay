import { useNavigate } from 'react-router';
import {
  clearRecentSearches,
  isPlaceSaved,
  recentSearchesStore,
  removeRecentSearch,
  savedPlacesStore,
  searchUrl,
  toggleSavedPlace,
} from '../../lib/trips';
import { useLocalStore } from '../../lib/localStore';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';

/** Last searches made on this device. Tap to search again; star to save the destination. */
export function RecentSearches({ limit = 5 }: { limit?: number }) {
  const navigate = useNavigate();
  const recents = useLocalStore(recentSearchesStore);
  const saved = useLocalStore(savedPlacesStore);

  if (recents.length === 0) {
    return (
      <EmptyState icon="history" title="No recent searches">
        Your searches will appear here. They are stored only on this device.
      </EmptyState>
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface">
      <ul className="divide-y divide-line">
        {recents.slice(0, limit).map((item) => {
          const destination = item.to.place;
          const starred = destination ? isPlaceSaved(saved, destination.id) : false;
          return (
            <li key={item.id} className="flex items-center gap-1 pr-2">
              <button
                type="button"
                onClick={() => navigate(searchUrl(item))}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-l-[var(--radius-card)] p-3.5 text-left hover:bg-surface-2/60"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
                  <Icon name="history" className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{item.to.text}</span>
                  <span className="block truncate text-xs text-muted">from {item.from.text}</span>
                </span>
              </button>
              {destination && (
                <button
                  type="button"
                  onClick={() => toggleSavedPlace(destination)}
                  aria-pressed={starred}
                  aria-label={starred ? `Remove ${destination.name} from saved destinations` : `Save ${destination.name} as a destination`}
                  className="grid size-9 place-items-center rounded-full hover:bg-surface-2"
                >
                  <Icon name="star" className={`size-4.5 ${starred ? 'fill-sun-400 text-sun-500' : 'text-muted'}`} />
                </button>
              )}
              <button
                type="button"
                onClick={() => removeRecentSearch(item.id)}
                aria-label={`Remove search to ${item.to.text}`}
                className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2"
              >
                <Icon name="x" className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-line px-3.5 py-2 text-right">
        <button type="button" onClick={clearRecentSearches} className="text-xs font-semibold text-muted hover:text-ink">
          Clear history
        </button>
      </div>
    </div>
  );
}
