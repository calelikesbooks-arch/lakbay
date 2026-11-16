import type { PesoRange } from '../types/transport';

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2, minimumFractionDigits: 0 });

export function formatPeso(amount: number): string {
  return peso.format(amount);
}

export function formatPesoRange(range: PesoRange | null | undefined): string {
  if (!range) return 'Fare unknown';
  return range.min === range.max ? formatPeso(range.min) : `${formatPeso(range.min)}–${formatPeso(range.max)}`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

/**
 * "2026-03-19" → "Mar 19, 2026". Plain dates are treated as calendar dates;
 * full timestamps ("2026-03-19T02:10:00Z") are shown in the user's time zone.
 */
export function formatDate(isoDate: string | undefined): string {
  if (!isoDate) return 'Unknown date';
  if (isoDate.length > 10) {
    const date = new Date(isoDate);
    return Number.isNaN(date.getTime())
      ? 'Unknown date'
      : date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return 'Unknown date';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Whole days between an ISO date and today (positive = in the past). */
export function daysSince(isoDate: string, today = new Date()): number {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const then = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((now - then) / 86_400_000);
}

/** Today's date as YYYY-MM-DD in the user's own time zone. */
export function todayIso(today = new Date()): string {
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
