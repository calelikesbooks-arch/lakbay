import { Fragment } from 'react';
import { formatDistance, formatPesoRange } from '../../lib/format';
import { modeMeta } from '../../lib/modes';
import { summarize } from '../../lib/routing/itinerary';
import type { Itinerary } from '../../types/transport';
import { VerificationBadge } from '../evidence/VerificationBadge';
import { Icon } from '../ui/Icon';
import { TransportIcon } from '../ui/TransportIcon';

interface RouteCardProps {
  itinerary: Itinerary;
  selected: boolean;
  onSelect: () => void;
  /** e.g. "Cheapest". Only pass when the label is true for the shown data. */
  highlight?: string;
  detailsId: string;
}

/** One route option in the comparison list. Tapping it opens the full steps. */
export function RouteCard({ itinerary, selected, onSelect, highlight, detailsId }: RouteCardProps) {
  const s = summarize(itinerary);
  const rides = itinerary.legs.filter((leg) => leg.mode !== 'walk');

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-expanded={selected}
      aria-controls={detailsId}
      className={`w-full rounded-[var(--radius-card)] border bg-surface p-4 text-left transition-[border-color,box-shadow] ${
        selected ? 'border-brand-500 shadow-[0_0_0_3px] shadow-brand-500/15' : 'border-line hover:border-navy-300 dark:hover:border-navy-600'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1" aria-label={`Modes: ${itinerary.legs.map((l) => modeMeta[l.mode].label).join(', then ')}`}>
          {itinerary.legs.map((leg, i) => (
            <Fragment key={leg.id}>
              {i > 0 && <Icon name="chevronRight" className="size-3.5 text-muted" />}
              <span
                className={`grid size-8 place-items-center rounded-xl ${
                  leg.mode === 'walk' ? 'bg-surface-2 text-muted' : `${modeMeta[leg.mode].dot} text-navy-950`
                }`}
                title={modeMeta[leg.mode].label}
              >
                <TransportIcon mode={leg.mode} className="size-4.5" />
              </span>
            </Fragment>
          ))}
        </div>
        <div className="text-right">
          <p className="text-xl font-extrabold tracking-tight text-ink">{formatPesoRange(s.fare)}</p>
          <p className="text-xs text-muted">estimated fare</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        <span>
          <strong className="text-ink">{s.transfers}</strong> {s.transfers === 1 ? 'transfer' : 'transfers'}
        </span>
        <span>
          <strong className="text-ink">{formatDistance(s.walkingMeters)}</strong> walking
        </span>
        <span>
          <strong className="text-ink">{formatDistance(s.totalMeters)}</strong> total
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <VerificationBadge verification={{ level: s.verification, lastVerified: s.oldestVerified }} />
          {highlight && (
            <span className="rounded-full bg-sun-400 px-2.5 py-1 text-xs font-bold text-navy-950">{highlight}</span>
          )}
        </div>
        <span className="flex items-center gap-1 text-sm font-semibold text-brand-700 dark:text-brand-300">
          {selected ? 'Hide steps' : `${rides.length} ${rides.length === 1 ? 'ride' : 'rides'} · View steps`}
          <Icon name="chevronDown" className={`size-4 transition-transform ${selected ? 'rotate-180' : ''}`} />
        </span>
      </div>
    </button>
  );
}
