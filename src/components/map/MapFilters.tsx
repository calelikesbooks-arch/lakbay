import { modeColor } from '../../lib/map/modes';
import type { TransportModeInfo } from '../../lib/map/data';

interface MapFiltersProps {
  modes: TransportModeInfo[];
  selectedModes: Set<string>;
  onToggleMode: (code: string) => void;
  onClearModes: () => void;
  showTerminals: boolean;
  showStops: boolean;
  onToggleTerminals: () => void;
  onToggleStops: () => void;
}

const chip = (on: boolean) =>
  `flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
    on ? 'border-navy-900 bg-navy-900 text-white dark:border-brand-300 dark:bg-brand-300 dark:text-navy-950' : 'border-line bg-surface text-muted hover:text-ink'
  }`;

/** Transport category filters + terminal/stop toggles. */
export function MapFilters(props: MapFiltersProps) {
  const { modes, selectedModes } = props;
  return (
    <div role="group" aria-label="Map filters" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
      <button type="button" aria-pressed={props.showTerminals} onClick={props.onToggleTerminals} className={chip(props.showTerminals)}>
        <span className="size-3 rounded-full border-2 border-sun-400 bg-navy-900" aria-hidden="true" /> Terminals
      </button>
      <button type="button" aria-pressed={props.showStops} onClick={props.onToggleStops} className={chip(props.showStops)}>
        <span className="size-2.5 rounded-full border-2 border-white bg-brand-600" aria-hidden="true" /> Stops
      </button>
      <span className="mx-1 w-px shrink-0 bg-line" aria-hidden="true" />
      <button type="button" aria-pressed={selectedModes.size === 0} onClick={props.onClearModes} className={chip(selectedModes.size === 0)}>
        All modes
      </button>
      {modes.map((mode) => {
        const on = selectedModes.has(mode.code);
        return (
          <button key={mode.code} type="button" aria-pressed={on} onClick={() => props.onToggleMode(mode.code)} className={chip(on)}>
            <span className="size-2.5 rounded-full" style={{ backgroundColor: modeColor(mode.code) }} aria-hidden="true" />
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
