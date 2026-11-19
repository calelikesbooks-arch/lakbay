import { useState } from 'react';
import { statusLabel, submitRideCheck, type CheckResult, type Outcome, type RouteToRide } from '../../lib/field/checks';
import type { GpsFix } from '../../lib/field/useFieldGps';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Field, Select, TextArea, TextInput } from '../ui/Field';
import { Spinner } from '../ui/Spinner';

const outcomes: { value: Outcome; label: string }[] = [
  { value: 'confirmed', label: 'I rode it' },
  { value: 'not_found', label: 'Not running here' },
  { value: 'closed', label: 'Stopped operating' },
  { value: 'unsure', label: 'Not sure (note only)' },
];

interface RideCheckFormProps {
  route: RouteToRide;
  fix: GpsFix | null;
  onDone: (result: CheckResult) => void;
}

export function RideCheckForm({ route, fix, onDone }: RideCheckFormProps) {
  const [outcome, setOutcome] = useState<Outcome>('confirmed');
  const [boarded, setBoarded] = useState('');
  const [alighted, setAlighted] = useState('');
  const [fare, setFare] = useState('');
  const [line, setLine] = useState<'yes' | 'no' | 'unknown'>('unknown');
  const [signboard, setSignboard] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seqOf = (id: string) => route.stops.find((s) => s.id === id)?.seq ?? -1;
  const fareValue = fare.trim() ? Number(fare) : null;
  const ordered = route.direction === 'outbound' || route.direction === 'inbound';

  let blocker: string | null = null;
  if (outcome === 'confirmed') {
    if (route.stops.length < 2) blocker = 'This route has fewer than 2 linked stops. Promote and link its stops first.';
    else if (!boarded || !alighted) blocker = 'Choose where you boarded and where you got off.';
    else if (boarded === alighted) blocker = 'Boarding and alighting stops must be different.';
    else if (ordered && seqOf(boarded) >= seqOf(alighted)) blocker = 'On this route, the boarding stop must come before the alighting stop.';
  } else if (!notes.trim()) {
    blocker = 'Write a short note about what you saw or were told.';
  }
  if (fareValue != null && (!Number.isFinite(fareValue) || fareValue <= 0 || fareValue >= 2000)) {
    blocker = 'Enter the fare in pesos, e.g. 13 or 13.50.';
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await submitRideCheck({
          variantId: route.variant_id,
          outcome,
          fix,
          boardedStopId: outcome === 'confirmed' ? boarded : null,
          alightedStopId: outcome === 'confirmed' ? alighted : null,
          farePaid: outcome === 'confirmed' ? fareValue : null,
          lineMatches: outcome === 'confirmed' && route.has_geometry && line !== 'unknown' ? line === 'yes' : null,
          signboard,
          notes,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the check.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{route.mode_code.replace(/_/g, ' ')}</Badge>
          <Badge tone={route.variant_status === 'verified' ? 'success' : 'neutral'}>{statusLabel[route.variant_status]}</Badge>
        </div>
        <h2 className="mt-2 text-lg font-extrabold">{route.route_name}</h2>
        <p className="text-sm text-muted">
          {route.direction} · {route.stops.length} stops linked{route.signboard_text && ` · sign: ${route.signboard_text}`}
        </p>
      </header>

      <Field id={`ride-outcome-${route.variant_id}`} label="What happened?">
        <Select id={`ride-outcome-${route.variant_id}`} value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
          {outcomes.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      {outcome === 'confirmed' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`on-${route.variant_id}`} label="Boarded at">
              <Select id={`on-${route.variant_id}`} value={boarded} onChange={(e) => setBoarded(e.target.value)}>
                <option value="">Choose…</option>
                {route.stops.map((s) => (
                  <option key={`${s.seq}-${s.id}`} value={s.id}>
                    {s.seq}. {s.name}
                    {s.status !== 'verified' ? ' (unverified)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id={`off-${route.variant_id}`} label="Got off at">
              <Select id={`off-${route.variant_id}`} value={alighted} onChange={(e) => setAlighted(e.target.value)}>
                <option value="">Choose…</option>
                {route.stops.map((s) => (
                  <option key={`${s.seq}-${s.id}`} value={s.id}>
                    {s.seq}. {s.name}
                    {s.status !== 'verified' ? ' (unverified)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field id={`fare-${route.variant_id}`} label="Fare you paid (optional, ₱)" hint="Saved as one observation, not as the official fare.">
            <TextInput id={`fare-${route.variant_id}`} inputMode="decimal" value={fare} onChange={(e) => setFare(e.target.value)} placeholder="e.g. 13" />
          </Field>
          {route.has_geometry && (
            <Field id={`line-${route.variant_id}`} label="Does the line on the map match the road you took?">
              <Select id={`line-${route.variant_id}`} value={line} onChange={(e) => setLine(e.target.value as 'yes' | 'no' | 'unknown')}>
                <option value="unknown">I didn't check</option>
                <option value="yes">Yes, the whole way</option>
                <option value="no">No, it differs</option>
              </Select>
            </Field>
          )}
        </>
      )}

      <Field id={`rsign-${route.variant_id}`} label="Signboard text (optional)" hint="Exactly as written on the vehicle.">
        <TextInput id={`rsign-${route.variant_id}`} value={signboard} maxLength={120} onChange={(e) => setSignboard(e.target.value)} />
      </Field>
      <Field id={`rnotes-${route.variant_id}`} label="Notes" hint="Private to moderators.">
        <TextArea id={`rnotes-${route.variant_id}`} value={notes} maxLength={2000} className="min-h-20" onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {blocker && <p className="text-sm text-sun-700 dark:text-sun-300">{blocker}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <Button className="w-full" disabled={!!blocker || busy} onClick={submit}>
        {busy && <Spinner className="size-4 text-navy-950" />} Save ride check
      </Button>
    </div>
  );
}
