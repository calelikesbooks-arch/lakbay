import { useState } from 'react';
import { FIELD_RULES, statusLabel, submitPlaceCheck, type CheckResult, type NearbyRecord, type Outcome } from '../../lib/field/checks';
import { metersBetween, type GpsFix } from '../../lib/field/useFieldGps';
import { formatDate } from '../../lib/format';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Field, TextArea, TextInput } from '../ui/Field';
import { Spinner } from '../ui/Spinner';

const outcomes: { value: Outcome; label: string; help: string }[] = [
  { value: 'confirmed', label: "It's here", help: 'You can see it and you are standing at it.' },
  { value: 'moved', label: "It's here, but the pin is wrong", help: 'Stand at the real spot. Your GPS position becomes the new location.' },
  { value: 'not_found', label: 'Not found', help: 'You are at the pin and there is nothing.' },
  { value: 'closed', label: 'Closed / no longer used', help: 'You are sure it is gone (sign removed, terminal closed).' },
  { value: 'unsure', label: 'Not sure', help: 'Only saves your note. Nothing changes.' },
];

interface PlaceCheckFormProps {
  record: NearbyRecord;
  fix: GpsFix | null;
  onDone: (result: CheckResult) => void;
}

export function PlaceCheckForm({ record, fix, onDone }: PlaceCheckFormProps) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [signboard, setSignboard] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxAccuracy = FIELD_RULES.maxAccuracy[record.kind];
  const distance = fix ? metersBetween(fix.lon, fix.lat, record.lon, record.lat) : null;
  const allowed = fix ? fix.accuracy + FIELD_RULES.tolerance[record.kind] : null;
  const needsGps = outcome === 'confirmed' || outcome === 'moved' || outcome === 'not_found';

  let blocker: string | null = null;
  if (needsGps) {
    if (!fix) blocker = 'Get your GPS position first.';
    else if (fix.accuracy > maxAccuracy) blocker = `GPS accuracy must be ${maxAccuracy} m or better (now ±${Math.round(fix.accuracy)} m).`;
    else if ((outcome === 'confirmed' || outcome === 'not_found') && distance! > allowed!)
      blocker = `You are ${Math.round(distance!)} m from the pin (allowed ${Math.round(allowed!)} m). Go closer, or choose "pin is wrong".`;
    else if (outcome === 'moved' && distance! <= fix.accuracy) blocker = 'You are already at the pin: choose "It\'s here".';
    else if (outcome === 'moved' && distance! > FIELD_RULES.maxMove) blocker = 'More than 500 m away: that is a different place, not a move.';
  }
  if ((outcome === 'unsure' || outcome === 'not_found' || outcome === 'closed') && !notes.trim()) {
    blocker = blocker ?? 'Write a short note about what you saw.';
  }

  async function submit() {
    if (!outcome) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await submitPlaceCheck({ kind: record.kind, id: record.id, outcome, fix, signboard, notes }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the check.');
    } finally {
      setBusy(false);
    }
  }

  const mapUrl = `https://www.openstreetmap.org/?mlat=${record.lat}&mlon=${record.lon}#map=19/${record.lat}/${record.lon}`;

  return (
    <div className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{record.kind === 'terminal' ? 'Terminal' : 'Stop'}</Badge>
          <Badge tone={record.status === 'verified' ? 'success' : record.status === 'needs_recheck' ? 'warning' : 'neutral'}>
            {statusLabel[record.status]}
          </Badge>
        </div>
        <h2 className="mt-2 text-lg font-extrabold">{record.name}</h2>
        <p className="text-sm text-muted">
          {record.subtype.replace(/_/g, ' ')} · {record.municipality}
          {record.last_verified_on && ` · last checked ${formatDate(record.last_verified_on)}`}
        </p>
        <p className="mt-1 text-sm">
          {distance != null ? <strong>{Math.round(distance)} m from you</strong> : 'Get your position to see the distance.'}{' '}
          <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline dark:text-brand-300">
            open pin
          </a>
        </p>
      </header>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-bold">What did you find?</legend>
        {outcomes.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer gap-3 rounded-2xl border p-3 ${outcome === o.value ? 'border-brand-500 bg-brand-50 dark:bg-brand-400/10' : 'border-line'}`}
          >
            <input type="radio" name={`outcome-${record.id}`} className="mt-1" checked={outcome === o.value} onChange={() => setOutcome(o.value)} />
            <span>
              <span className="block font-semibold">{o.label}</span>
              <span className="block text-sm text-muted">{o.help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <Field id={`sign-${record.id}`} label="Sign text (optional)" hint="Copy exactly what the sign says, if there is one.">
        <TextInput id={`sign-${record.id}`} value={signboard} maxLength={120} onChange={(e) => setSignboard(e.target.value)} />
      </Field>
      <Field id={`notes-${record.id}`} label="Notes" hint="Private to moderators. Don't write names or details of people.">
        <TextArea id={`notes-${record.id}`} value={notes} maxLength={2000} className="min-h-20" onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {outcome && blocker && <p className="text-sm text-sun-700 dark:text-sun-300">{blocker}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <Button className="w-full" disabled={!outcome || !!blocker || busy} onClick={submit}>
        {busy && <Spinner className="size-4 text-navy-950" />} Save field check
      </Button>
    </div>
  );
}
