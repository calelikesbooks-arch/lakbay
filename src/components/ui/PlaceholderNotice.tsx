import type { ReactNode } from 'react';
import { Icon } from './Icon';

interface PlaceholderNoticeProps {
  /** Name of the feature that is not built yet. */
  feature: string;
  /** When it is planned, e.g. "Phase 3". */
  phase: string;
  children?: ReactNode;
}

/**
 * Clearly marks a feature as NOT working yet.
 * Rule: every unfinished feature on screen must sit inside one of these.
 */
export function PlaceholderNotice({ feature, phase, children }: PlaceholderNoticeProps) {
  return (
    <section
      aria-label={`${feature}: not yet available`}
      className="rounded-[var(--radius-card)] border-2 border-dashed border-sun-300 bg-sun-50/70 p-4 dark:border-sun-500/40 dark:bg-sun-400/5"
    >
      <div className="flex items-start gap-3">
        <Icon name="info" className="mt-0.5 size-5 shrink-0 text-sun-700 dark:text-sun-300" />
        <div>
          <p className="text-[11px] font-bold tracking-wider text-sun-700 uppercase dark:text-sun-300">
            Placeholder · not yet available
          </p>
          <h2 className="mt-1 font-bold text-ink">{feature}</h2>
          <p className="mt-0.5 text-sm text-muted">Planned: {phase}</p>
          {children && <div className="mt-2 text-sm text-ink/85">{children}</div>}
        </div>
      </div>
    </section>
  );
}
