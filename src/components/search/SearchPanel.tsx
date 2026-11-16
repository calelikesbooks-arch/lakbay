import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { findPlaceByName } from '../../lib/places';
import { addRecentSearch, searchUrl, type PlaceInput, type TripQuery } from '../../lib/trips';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { PlaceCombobox } from './PlaceCombobox';

interface SearchPanelProps {
  query: TripQuery;
  onQueryChange: (query: TripQuery) => void;
  /** Big "Find routes" button (Home) or a compact one (results page). */
  size?: 'large' | 'compact';
  /** Called after a valid search is submitted. */
  onSubmitted?: () => void;
}

/** If the user typed a known place name without picking it, link it to that place. */
function resolve(input: PlaceInput): PlaceInput {
  if (input.place) return input;
  const match = findPlaceByName(input.text);
  return match ? { text: match.name, place: match } : { text: input.text.trim(), place: null };
}

/**
 * Origin + destination search. Controlled: the parent owns the query,
 * so shortcuts and saved places elsewhere on the page can fill it in.
 */
export function SearchPanel({ query, onQueryChange, size = 'large', onSubmitted }: SearchPanelProps) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [swapTurns, setSwapTurns] = useState(0);
  const errorId = 'search-panel-error';

  function update(part: Partial<TripQuery>) {
    setError(null);
    onQueryChange({ ...query, ...part });
  }

  function swap() {
    setSwapTurns((n) => n + 1);
    update({ from: query.to, to: query.from });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const from = resolve(query.from);
    const to = resolve(query.to);
    if (!from.text || !to.text) {
      setError(!from.text ? 'Saan ka manggagaling? Enter a starting point.' : 'Saan ang punta mo? Enter a destination.');
      return;
    }
    const same = from.place && to.place ? from.place.id === to.place.id : from.text.toLowerCase() === to.text.toLowerCase();
    if (same) {
      setError('Your starting point and destination are the same.');
      return;
    }
    const resolved = { from, to };
    onQueryChange(resolved);
    addRecentSearch(resolved);
    navigate(searchUrl(resolved));
    onSubmitted?.();
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Commute search">
      {/* pr-12 leaves a column on the right for the swap button */}
      <div className="relative space-y-2 pr-12">
        <PlaceCombobox
          label="From"
          placeholder="Saan ka manggagaling?"
          marker="origin"
          value={query.from}
          onChange={(from) => update({ from })}
          invalid={!!error && !query.from.text}
          describedById={error ? errorId : undefined}
        />
        <PlaceCombobox
          label="To"
          placeholder="Saan ang punta mo?"
          marker="destination"
          value={query.to}
          onChange={(to) => update({ to })}
          invalid={!!error && !query.to.text}
          describedById={error ? errorId : undefined}
        />
        <button
          type="button"
          onClick={swap}
          aria-label="Swap starting point and destination"
          className="absolute top-1/2 right-0 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-ink shadow-sm hover:bg-surface-2"
        >
          <span className="transition-transform duration-300" style={{ transform: `rotate(${swapTurns * 180}deg)` }}>
            <Icon name="swap" className="size-4" />
          </span>
        </button>
      </div>

      {error && (
        <p id={errorId} role="alert" className="mt-2 flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-300">
          <Icon name="alert" className="size-4" /> {error}
        </p>
      )}

      <Button type="submit" size={size === 'large' ? 'lg' : 'md'} className="mt-3 w-full">
        <Icon name="search" className="size-5" /> Hanapin ang ruta · Find routes
      </Button>
    </form>
  );
}
