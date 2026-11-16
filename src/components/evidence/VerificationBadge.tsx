import { daysSince, formatDate } from '../../lib/format';
import type { Verification } from '../../types/transport';
import { Icon } from '../ui/Icon';

/** After this many days a "verified" record is flagged for re-checking. */
export const STALE_AFTER_DAYS = 180;

const styles = {
  verified: 'bg-brand-100 text-brand-800 ring-brand-300/60 dark:bg-brand-400/15 dark:text-brand-200 dark:ring-brand-400/30',
  partial: 'bg-sun-100 text-sun-700 ring-sun-300/70 dark:bg-sun-400/15 dark:text-sun-300 dark:ring-sun-400/30',
  unverified: 'bg-surface-2 text-muted ring-line',
  needs_recheck: 'bg-orange-100 text-orange-800 ring-orange-300/60 dark:bg-orange-400/15 dark:text-orange-200 dark:ring-orange-400/30',
  stale: 'bg-orange-100 text-orange-800 ring-orange-300/60 dark:bg-orange-400/15 dark:text-orange-200 dark:ring-orange-400/30',
} as const;

const labels = { verified: 'Verified', partial: 'Partly verified', needs_recheck: 'Needs re-check', unverified: 'Unverified' } as const;

interface VerificationBadgeProps {
  verification: Verification;
  /** Show the "last verified" date next to the label. */
  showDate?: boolean;
}

export function VerificationBadge({ verification, showDate = false }: VerificationBadgeProps) {
  const { level, lastVerified } = verification;
  const stale = level !== 'unverified' && !!lastVerified && daysSince(lastVerified) > STALE_AFTER_DAYS;
  const style = stale ? styles.stale : styles[level];
  const label = stale ? 'Needs re-check' : labels[level];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${style}`}
      title={lastVerified ? `Last verified ${formatDate(lastVerified)}` : 'Not yet verified'}
    >
      <Icon name={level === 'verified' && !stale ? 'shieldCheck' : 'info'} className="size-3.5" />
      {label}
      {showDate && lastVerified && <span className="font-medium opacity-80">· {formatDate(lastVerified)}</span>}
    </span>
  );
}
