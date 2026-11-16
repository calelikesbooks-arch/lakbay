import { useId, useState, type FormEvent } from 'react';
import { todayIso } from '../../lib/format';
import {
  emptyDraft,
  LIMITS,
  reportCategories,
  submitReport,
  validateReport,
  type ReportDraft,
  type ReportErrors,
  type SubmitOutcome,
} from '../../lib/reports';
import { Button } from '../ui/Button';
import { describedBy, Field, Select, TextArea, TextInput } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';

/** Community submission form with real validation and real submission (see lib/reports.ts). */
export function ReportForm({ initialLocation = '' }: { initialLocation?: string }) {
  const uid = useId();
  const ids = {
    category: `${uid}-category`,
    location: `${uid}-location`,
    details: `${uid}-details`,
    observedOn: `${uid}-date`,
    consent: `${uid}-consent`,
  };
  const [draft, setDraft] = useState<ReportDraft>(() => ({ ...emptyDraft(), location: initialLocation }));
  const [errors, setErrors] = useState<ReportErrors>({});
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);

  function update<K extends keyof ReportDraft>(key: K, value: ReportDraft[K]) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    // After the first submit attempt, re-check as the user fixes things.
    if (triedSubmit) setErrors(validateReport(next));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTriedSubmit(true);
    const found = validateReport(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const first = (Object.keys(found) as (keyof ReportDraft)[])[0];
      document.getElementById(ids[first])?.focus();
      return;
    }
    setSubmitting(true);
    try {
      setOutcome(await submitReport(draft));
      setDraft(emptyDraft());
      setTriedSubmit(false);
      setErrors({});
    } finally {
      setSubmitting(false);
    }
  }

  if (outcome) {
    const sent = outcome.kind === 'sent';
    return (
      <div role="status" className="rounded-[var(--radius-card)] border border-line bg-surface p-5 text-center animate-rise">
        <span
          className={`mx-auto grid size-12 place-items-center rounded-2xl ${
            sent ? 'bg-brand-100 text-brand-700 dark:bg-brand-400/15 dark:text-brand-200' : 'bg-sun-100 text-sun-700 dark:bg-sun-400/15 dark:text-sun-300'
          }`}
        >
          <Icon name={sent ? 'check' : 'info'} className="size-6" />
        </span>
        <h3 className="mt-3 text-lg font-bold">{sent ? 'Salamat! Report sent for review.' : 'Saved on this device. Not sent yet.'}</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          {sent
            ? 'A moderator will check it before anything changes in LAKBAY.'
            : outcome.reason}
        </p>
        <Button variant="secondary" className="mt-4" onClick={() => setOutcome(null)}>
          Submit another report
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">
      <Field id={ids.category} label="What changed?" required error={errors.category}>
        <Select
          id={ids.category}
          value={draft.category}
          onChange={(e) => update('category', e.target.value as ReportDraft['category'])}
          aria-invalid={!!errors.category}
          aria-describedby={describedBy(ids.category, undefined, errors.category)}
        >
          <option value="">Choose one…</option>
          {reportCategories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        id={ids.location}
        label="Where?"
        required
        hint="A landmark, terminal or street name people use."
        error={errors.location}
      >
        <TextInput
          id={ids.location}
          value={draft.location}
          maxLength={LIMITS.location.max}
          onChange={(e) => update('location', e.target.value)}
          placeholder="e.g. the loading area beside the market"
          aria-invalid={!!errors.location}
          aria-describedby={describedBy(ids.location, 'hint', errors.location)}
        />
      </Field>

      <Field
        id={ids.details}
        label="What did you see?"
        required
        hint={`${draft.details.trim().length}/${LIMITS.details.max} · Include signboard text and the fare you paid, if you know them.`}
        error={errors.details}
      >
        <TextArea
          id={ids.details}
          value={draft.details}
          maxLength={LIMITS.details.max}
          onChange={(e) => update('details', e.target.value)}
          aria-invalid={!!errors.details}
          aria-describedby={describedBy(ids.details, 'hint', errors.details)}
        />
      </Field>

      <Field id={ids.observedOn} label="When did you see this?" required error={errors.observedOn}>
        <TextInput
          id={ids.observedOn}
          type="date"
          max={todayIso()}
          value={draft.observedOn}
          onChange={(e) => update('observedOn', e.target.value)}
          aria-invalid={!!errors.observedOn}
          aria-describedby={describedBy(ids.observedOn, undefined, errors.observedOn)}
        />
      </Field>

      <div>
        <label className="flex items-start gap-3 rounded-2xl bg-surface-2 p-3 text-sm">
          <input
            id={ids.consent}
            type="checkbox"
            checked={draft.consent}
            onChange={(e) => update('consent', e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-brand-600"
            aria-invalid={!!errors.consent}
            aria-describedby={describedBy(ids.consent, undefined, errors.consent)}
          />
          <span>
            I saw this myself. I understand a moderator reviews reports before anything changes, and I did not include
            anyone's personal information.
          </span>
        </label>
        {errors.consent && (
          <p id={`${ids.consent}-error`} className="mt-1.5 text-xs font-medium text-red-700 dark:text-red-300">
            {errors.consent}
          </p>
        )}
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? <Spinner className="size-5 text-navy-950" /> : <Icon name="send" className="size-5" />}
        {submitting ? 'Submitting…' : 'Submit report'}
      </Button>
    </form>
  );
}
