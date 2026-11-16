import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { searchPlaces } from '../../lib/places';
import type { PlaceInput } from '../../lib/trips';
import type { PlaceRef } from '../../types/transport';
import { Icon } from '../ui/Icon';

interface PlaceComboboxProps {
  label: string;
  placeholder: string;
  value: PlaceInput;
  onChange: (value: PlaceInput) => void;
  /** Visual marker: teal dot for origin, yellow pin for destination. */
  marker: 'origin' | 'destination';
  invalid?: boolean;
  describedById?: string;
}

const kindLabel: Record<PlaceRef['kind'], string> = {
  area: 'Coverage area',
  landmark: 'Landmark',
  terminal: 'Terminal',
  stop: 'Stop',
};

/**
 * Text box with place suggestions (accessible "combobox" pattern):
 * ↑/↓ to move, Enter to pick, Esc to close.
 */
export function PlaceCombobox({ label, placeholder, value, onChange, marker, invalid, describedById }: PlaceComboboxProps) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const suggestions = useMemo(() => searchPlaces(value.text), [value.text]);
  const showList = open && suggestions.length > 0;

  function pick(place: PlaceRef) {
    onChange({ text: place.name, place });
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && showList) {
      event.preventDefault();
      const place = suggestions.at(active);
      if (place) pick(place);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div
        className={`flex items-center gap-3 rounded-2xl border bg-surface px-3.5 transition-[border-color,box-shadow] focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15 ${
          invalid ? 'border-red-500' : 'border-line'
        }`}
      >
        {marker === 'origin' ? (
          <span className="grid size-5 shrink-0 place-items-center" aria-hidden="true">
            <span className="size-3 rounded-full border-[3px] border-brand-500" />
          </span>
        ) : (
          <Icon name="pin" className="size-5 shrink-0 text-sun-500" />
        )}
        <div className="min-w-0 flex-1 py-2">
          <span className="block text-[11px] font-bold tracking-wider text-muted uppercase">{label}</span>
          <input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList ? `${id}-opt-${active}` : undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={describedById}
            autoComplete="off"
            enterKeyHint="next"
            className="w-full bg-transparent text-base font-semibold text-ink placeholder:font-normal placeholder:text-muted/70 focus:outline-none"
            placeholder={placeholder}
            value={value.text}
            onChange={(e) => {
              onChange({ text: e.target.value, place: null });
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          />
        </div>
        {value.text && (
          <button
            type="button"
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2"
            aria-label={`Clear ${label}`}
            onClick={() => {
              onChange({ text: '', place: null });
              inputRef.current?.focus();
            }}
          >
            <Icon name="x" className="size-4" />
          </button>
        )}
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute inset-x-0 top-full z-40 mt-2 max-h-72 overflow-auto rounded-2xl border border-line bg-surface p-1.5 shadow-xl shadow-navy-950/10 animate-fade"
        >
          {suggestions.map((place, index) => (
            <li
              key={place.id}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={index === active}
              // mousedown (not click) so the input doesn't lose focus first
              onMouseDown={(e) => {
                e.preventDefault();
                pick(place);
              }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ${index === active ? 'bg-surface-2' : ''}`}
            >
              <Icon name={place.kind === 'terminal' ? 'route' : 'pin'} className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{place.name}</span>
                {place.locality && <span className="block truncate text-xs text-muted">{place.locality}</span>}
              </span>
              <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted">
                {kindLabel[place.kind]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
