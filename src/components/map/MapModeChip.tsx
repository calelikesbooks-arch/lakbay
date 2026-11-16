import { iconModeFor, modeColor } from '../../lib/map/modes';
import { TransportIcon } from '../ui/TransportIcon';

/** Chip for a DATABASE mode code (e.g. "city_bus", "lrt"), with its map color. */
export function MapModeChip({ code, label }: { code: string; label: string }) {
  const icon = iconModeFor(code);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pr-2.5 pl-1 text-xs font-semibold text-ink">
      <span className="grid size-5 place-items-center rounded-full text-white" style={{ backgroundColor: modeColor(code) }}>
        {icon ? <TransportIcon mode={icon} className="size-3.5" /> : <span className="size-1.5 rounded-full bg-white" />}
      </span>
      {label}
    </span>
  );
}
