import { env } from './env';
import { createLocalStore } from './localStore';
import { getSupabase } from './supabase';
import { todayIso } from './format';
import { newId } from './trips';

/**
 * Community reports: commuters tell LAKBAY that something changed.
 *
 * Where a report goes:
 *  - Supabase configured AND the community_reports table exists
 *    (supabase/migrations/0001_community_reports.sql) → sent for moderation.
 *  - Otherwise → saved on this device only, clearly labeled "not sent".
 * Nothing a user submits is ever published automatically.
 */

export const reportCategories = [
  { value: 'route_changed', label: 'A route changed or stopped running' },
  { value: 'fare_changed', label: 'A fare is different' },
  { value: 'terminal_moved', label: 'A terminal or loading spot moved' },
  { value: 'new_route', label: 'A route LAKBAY does not have yet' },
  { value: 'other', label: 'Something else' },
] as const;

export type ReportCategory = (typeof reportCategories)[number]['value'];

export interface ReportDraft {
  category: ReportCategory | '';
  location: string;
  details: string;
  observedOn: string;
  consent: boolean;
}

export interface StoredReport {
  id: string;
  category: ReportCategory;
  location: string;
  details: string;
  observedOn: string;
  createdAt: string;
  status: 'sent' | 'saved_locally';
}

export type ReportErrors = Partial<Record<keyof ReportDraft, string>>;

export const emptyDraft = (): ReportDraft => ({ category: '', location: '', details: '', observedOn: todayIso(), consent: false });

export const LIMITS = { location: { min: 3, max: 120 }, details: { min: 10, max: 1000 } } as const;

export function validateReport(draft: ReportDraft): ReportErrors {
  const errors: ReportErrors = {};
  if (!draft.category) errors.category = 'Choose what kind of change this is.';
  const location = draft.location.trim();
  if (location.length < LIMITS.location.min) errors.location = 'Tell us where (a landmark, terminal or street).';
  else if (location.length > LIMITS.location.max) errors.location = `Keep it under ${LIMITS.location.max} characters.`;
  const details = draft.details.trim();
  if (details.length < LIMITS.details.min) errors.details = `Add a bit more detail (at least ${LIMITS.details.min} characters).`;
  else if (details.length > LIMITS.details.max) errors.details = `Keep it under ${LIMITS.details.max} characters.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.observedOn)) errors.observedOn = 'Pick the date you saw this.';
  else if (draft.observedOn > todayIso()) errors.observedOn = 'The date cannot be in the future.';
  if (!draft.consent) errors.consent = 'Please confirm before submitting.';
  return errors;
}

function isStoredReportList(value: unknown): value is StoredReport[] {
  return (
    Array.isArray(value) &&
    value.every((r) => r && typeof r.id === 'string' && typeof r.details === 'string' && (r.status === 'sent' || r.status === 'saved_locally'))
  );
}

/** Reports made on this device (both sent and not-yet-sent). */
export const myReportsStore = createLocalStore<StoredReport[]>('lakbay-my-reports', [], isStoredReportList);

export type SubmitOutcome =
  | { kind: 'sent' }
  | { kind: 'saved_locally'; reason: string };

async function sendToSupabase(report: StoredReport): Promise<{ ok: true } | { ok: false; reason: string }> {
  const client = await getSupabase();
  if (!client) {
    return {
      ok: false,
      reason:
        env.supabase.state === 'invalid'
          ? 'Supabase settings have a problem, so the report was kept on this device.'
          : 'Sending is not set up yet, so the report was kept on this device.',
    };
  }
  // The database function decides everything sensitive itself:
  // the report is always 'pending' and is reviewed by a moderator.
  // (supabase/migrations/20261117000300_community_and_user_data.sql)
  const { error } = await client.rpc('submit_community_report', {
    p_category: report.category,
    p_location_text: report.location,
    p_details: report.details,
    p_observed_on: report.observedOn,
  });
  if (error) {
    console.error('[LAKBAY] Report submission failed:', error);
    // 54000 = our "too many reports" limit
    const reason =
      error.code === '54000'
        ? 'Too many reports were sent recently, so this one was kept on this device. Try sending it again later.'
        : 'The server did not accept the report, so it was kept on this device. You can retry later.';
    return { ok: false, reason };
  }
  return { ok: true };
}

export async function submitReport(draft: ReportDraft): Promise<SubmitOutcome> {
  const report: StoredReport = {
    id: newId(),
    category: draft.category as ReportCategory,
    location: draft.location.trim(),
    details: draft.details.trim(),
    observedOn: draft.observedOn,
    createdAt: new Date().toISOString(),
    status: 'saved_locally',
  };

  let outcome: SubmitOutcome;
  try {
    const result = await sendToSupabase(report);
    outcome = result.ok ? { kind: 'sent' } : { kind: 'saved_locally', reason: result.reason };
  } catch {
    outcome = { kind: 'saved_locally', reason: 'You seem to be offline, so the report was kept on this device.' };
  }

  myReportsStore.set((list) => [{ ...report, status: outcome.kind === 'sent' ? 'sent' : 'saved_locally' }, ...list]);
  return outcome;
}

/** Tries to send a report that was saved locally earlier. */
export async function retryReport(id: string): Promise<SubmitOutcome> {
  const report = myReportsStore.get().find((r) => r.id === id);
  if (!report) return { kind: 'saved_locally', reason: 'Report not found.' };
  try {
    const result = await sendToSupabase(report);
    if (!result.ok) return { kind: 'saved_locally', reason: result.reason };
  } catch {
    return { kind: 'saved_locally', reason: 'Still offline. Try again later.' };
  }
  myReportsStore.set((list) => list.map((r) => (r.id === id ? { ...r, status: 'sent' } : r)));
  return { kind: 'sent' };
}

export function deleteLocalReport(id: string) {
  myReportsStore.set((list) => list.filter((r) => r.id !== id));
}
