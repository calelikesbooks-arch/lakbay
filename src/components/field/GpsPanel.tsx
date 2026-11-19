import type { FieldGpsState, GpsFix } from '../../lib/field/useFieldGps';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';

interface GpsPanelProps {
  state: FieldGpsState;
  best: GpsFix | null;
  /** Accuracy needed for this check, in meters (shown as the target). */
  needed?: number;
  onStart: () => void;
  onStop: () => void;
}

/** Live GPS readout: the moderator waits until the accuracy is good enough. */
export function GpsPanel({ state, best, needed, onStart, onStop }: GpsPanelProps) {
  const good = best && needed ? best.accuracy <= needed : !!best;
  const watching = state.status === 'watching';
  const ageSeconds = best ? Math.max(0, Math.round((Date.now() - best.at) / 1000)) : null;

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`grid size-10 place-items-center rounded-xl ${good ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300' : 'bg-surface-2 text-ink'}`}
          >
            {watching ? <Spinner className="size-5" /> : <Icon name="pin" className="size-5" />}
          </span>
          <div className="text-sm">
            {best ? (
              <>
                <p className="font-bold">
                  ±{Math.round(best.accuracy)} m{needed ? ` (need ${needed} m or better)` : ''}
                </p>
                <p className="text-muted">
                  {best.lat.toFixed(6)}, {best.lon.toFixed(6)}
                  {ageSeconds != null && ` · ${ageSeconds}s ago`}
                </p>
              </>
            ) : (
              <p className="font-semibold">{watching ? 'Waiting for GPS…' : 'No position yet'}</p>
            )}
          </div>
        </div>
        {watching ? (
          <Button variant="secondary" size="sm" onClick={onStop}>
            Use this
          </Button>
        ) : (
          <Button size="sm" onClick={onStart}>
            <Icon name="compass" className="size-4" /> {best ? 'Measure again' : 'Get my position'}
          </Button>
        )}
      </div>
      {watching && (
        <p className="mt-2 text-xs text-muted">Stand still outdoors. Accuracy usually improves over 10 to 30 seconds.</p>
      )}
      {(state.status === 'denied' || state.status === 'error' || state.status === 'unsupported') && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          {state.message}
        </p>
      )}
      {best && needed && !good && !watching && (
        <p className="mt-2 text-sm text-sun-700 dark:text-sun-300">Not accurate enough yet. Move away from roofs and tall buildings, then measure again.</p>
      )}
    </div>
  );
}
