import { formatDistance, formatPesoRange } from '../../lib/format';
import { modeMeta } from '../../lib/modes';
import type { Itinerary } from '../../types/transport';
import { VerificationBadge } from '../evidence/VerificationBadge';
import { Icon } from '../ui/Icon';
import { ModeChip, TransportIcon } from '../ui/TransportIcon';
import { Signboard } from './Signboard';

/** Step-by-step commute instructions, drawn as a vertical journey line. */
export function LegTimeline({ itinerary }: { itinerary: Itinerary }) {
  return (
    <ol className="relative" aria-label="Commute instructions">
      <li className="flex gap-3 pb-1">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-500 text-white">
          <Icon name="origin" className="size-4" />
        </span>
        <p className="pt-1.5 text-sm">
          <span className="text-muted">Start at </span>
          <span className="font-bold">{itinerary.from.name}</span>
        </p>
      </li>

      {itinerary.legs.map((leg, index) => {
        const meta = modeMeta[leg.mode];
        const isWalk = leg.mode === 'walk';
        return (
          <li key={leg.id} className="flex gap-3">
            <div className="flex w-9 shrink-0 flex-col items-center">
              <span className={`w-0 flex-1 border-l-[3px] ${meta.line}`} aria-hidden="true" />
              <span
                className={`my-1 grid size-9 place-items-center rounded-full ${
                  isWalk ? 'bg-surface-2 text-muted' : `${meta.dot} text-navy-950`
                }`}
              >
                <TransportIcon mode={leg.mode} className="size-5" />
              </span>
              <span className={`w-0 flex-1 border-l-[3px] ${meta.line}`} aria-hidden="true" />
            </div>

            <div className="min-w-0 flex-1 py-3">
              <p className="sr-only">Step {index + 1}</p>
              <div className="flex flex-wrap items-center gap-2">
                <ModeChip mode={leg.mode} />
                <span className="text-xs text-muted">{formatDistance(leg.distanceMeters)}</span>
                {!isWalk && (
                  <span className="text-xs font-semibold text-ink">{formatPesoRange(leg.fare?.regular)}</span>
                )}
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-ink">{leg.instruction}</p>
              {leg.signboard && (
                <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                  Look for: <Signboard text={leg.signboard} />
                </p>
              )}
              <p className="mt-2 text-sm text-muted">
                {isWalk ? 'Until ' : 'Get off at '}
                <span className="font-semibold text-ink">{leg.to.name}</span>
              </p>
              {leg.fare?.discounted && (
                <p className="mt-1 text-xs text-muted">
                  Student / senior / PWD: {formatPesoRange(leg.fare.discounted)} · Basis: {leg.fare.basis}
                </p>
              )}
              {leg.fare && !leg.fare.discounted && <p className="mt-1 text-xs text-muted">Fare basis: {leg.fare.basis}</p>}
              <div className="mt-2">
                <VerificationBadge verification={leg.verification} showDate />
              </div>
            </div>
          </li>
        );
      })}

      <li className="flex gap-3 pt-1">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sun-400 text-navy-950">
          <Icon name="pin" className="size-4" />
        </span>
        <p className="pt-1.5 text-sm">
          <span className="text-muted">Arrive at </span>
          <span className="font-bold">{itinerary.to.name}</span>
        </p>
      </li>
    </ol>
  );
}
