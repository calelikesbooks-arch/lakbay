import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { StaffGate, useSignedIn } from '../components/admin/StaffGate';
import { GpsPanel } from '../components/field/GpsPanel';
import { PlaceCheckForm } from '../components/field/PlaceCheckForm';
import { RideCheckForm } from '../components/field/RideCheckForm';
import { Badge } from '../components/ui/Badge';
import { Button, buttonClasses } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Field, TextInput } from '../components/ui/Field';
import { Icon } from '../components/ui/Icon';
import { PageHeader } from '../components/ui/PageHeader';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Spinner } from '../components/ui/Spinner';
import { signOut } from '../lib/auth';
import {
  FIELD_RULES,
  fetchNearby,
  fetchRoutes,
  statusLabel,
  type CheckResult,
  type NearbyRecord,
  type RecordStatus,
  type RouteToRide,
} from '../lib/field/checks';
import { useFieldGps } from '../lib/field/useFieldGps';
import { formatDate } from '../lib/format';
import { getSupabase } from '../lib/supabase';

type Tab = 'places' | 'routes' | 'recent';

export default function FieldCheckPage() {
  const signedIn = useSignedIn();
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Para sa moderators"
        title="Field check"
        description="Check drafts on site. A confirmed check is what makes a terminal, stop or route public."
        actions={
          <div className="flex gap-2">
            <Link to="/admin" className={buttonClasses('secondary', 'sm')}>
              Data review
            </Link>
            {signedIn && (
              <Button variant="ghost" size="sm" onClick={() => signOut()}>
                Sign out
              </Button>
            )}
          </div>
        }
      />
      <StaffGate>
        <FieldArea />
      </StaffGate>
    </div>
  );
}

function FieldArea() {
  const [tab, setTab] = useState<Tab>('places');
  const gps = useFieldGps();
  return (
    <div className="space-y-4">
      <SegmentedControl
        label="Field check section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'places', label: 'Places near me' },
          { value: 'routes', label: 'Ride a route' },
          { value: 'recent', label: 'Recent' },
        ]}
      />
      {tab !== 'recent' && <GpsPanel state={gps.state} best={gps.best} needed={tab === 'places' ? FIELD_RULES.maxAccuracy.stop : undefined} onStart={gps.start} onStop={gps.stop} />}
      {tab === 'places' && <Places gps={gps} />}
      {tab === 'routes' && <Routes gps={gps} />}
      {tab === 'recent' && <Recent />}
    </div>
  );
}

type Gps = ReturnType<typeof useFieldGps>;

function ResultNote({ result, onClose }: { result: CheckResult; onClose: () => void }) {
  const changed = result.status_before !== result.status_after;
  return (
    <div role="status" className="space-y-2 rounded-[var(--radius-card)] border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-400/30 dark:bg-emerald-400/10">
      <p className="font-bold">
        Saved.{' '}
        {changed
          ? `Status: ${statusLabel[result.status_before]} → ${statusLabel[result.status_after]}.`
          : `Status unchanged (${statusLabel[result.status_after]}).`}
      </p>
      {result.messages.map((m) => (
        <p key={m}>{m}</p>
      ))}
      <Button size="sm" variant="secondary" onClick={onClose}>
        Back to the list
      </Button>
    </div>
  );
}

function statusTone(status: RecordStatus) {
  return status === 'verified' ? 'success' : status === 'needs_recheck' ? 'warning' : 'neutral';
}

function Places({ gps }: { gps: Gps }) {
  const [radius, setRadius] = useState(1000);
  const [items, setItems] = useState<NearbyRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NearbyRecord | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);

  async function load() {
    if (!gps.best) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchNearby(gps.best, radius));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load nearby records.');
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <ResultNote
        result={result}
        onClose={() => {
          setResult(null);
          setSelected(null);
          load();
        }}
      />
    );
  }

  if (selected) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
          ← Nearby list
        </Button>
        <PlaceCheckForm record={selected} fix={gps.best} onDone={setResult} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <SegmentedControl
          label="Search radius"
          value={String(radius)}
          onChange={(v) => setRadius(Number(v))}
          options={[
            { value: '300', label: '300 m' },
            { value: '1000', label: '1 km' },
            { value: '3000', label: '3 km' },
          ]}
        />
        <Button disabled={!gps.best || loading} onClick={load}>
          {loading ? <Spinner className="size-4 text-navy-950" /> : <Icon name="search" className="size-4" />} Find places to check
        </Button>
      </div>
      {!gps.best && <p className="text-sm text-muted">Get your position first. Only places near you are listed.</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {items && items.length === 0 && (
        <EmptyState icon="pin" title="Nothing to check here">
          No terminals or stops within this radius. Promote imported candidates in Data review first, or try a bigger radius.
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <button type="button" onClick={() => setSelected(r)} className="w-full rounded-2xl border border-line bg-surface p-3 text-left hover:bg-surface-2/60">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{r.name}</span>
                  <span className="shrink-0 text-sm font-bold">{Math.round(r.distance_m)} m</span>
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <Badge tone={statusTone(r.status)}>{statusLabel[r.status]}</Badge>
                  {r.kind} · {r.municipality}
                  {r.due && r.status === 'verified' && ' · re-check due'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Routes({ gps }: { gps: Gps }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<RouteToRide[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RouteToRide | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchRoutes(search));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load routes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (result) {
    return (
      <ResultNote
        result={result}
        onClose={() => {
          setResult(null);
          setSelected(null);
          load();
        }}
      />
    );
  }
  if (selected) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
          ← Route list
        </Button>
        <RideCheckForm route={selected} fix={gps.best} onDone={setResult} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <div className="flex-1">
          <Field id="route-search" label="Route name or signboard">
            <TextInput id="route-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Monumento" />
          </Field>
        </div>
        <Button type="submit" disabled={loading}>
          {loading ? <Spinner className="size-4 text-navy-950" /> : <Icon name="search" className="size-4" />} Search
        </Button>
      </form>
      <p className="text-xs text-muted">Your GPS position is optional for rides. It is saved privately as context.</p>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {items && items.length === 0 && (
        <EmptyState icon="route" title="No routes to ride">
          Promote route candidates in Data review first (stops before routes).
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((r) => (
            <li key={r.variant_id}>
              <button type="button" onClick={() => setSelected(r)} className="w-full rounded-2xl border border-line bg-surface p-3 text-left hover:bg-surface-2/60">
                <span className="block truncate font-semibold">{r.route_name}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <Badge tone={statusTone(r.variant_status)}>{statusLabel[r.variant_status]}</Badge>
                  {r.mode_code.replace(/_/g, ' ')} · {r.direction} · {r.stops.length} stops
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface RecentRow {
  id: string;
  outcome: string;
  observed_at: string;
  status_before: RecordStatus;
  status_after: RecordStatus;
  distance_m: number | null;
  gps_accuracy_m: number | null;
  fare_paid: number | null;
  stop: { name: string } | null;
  terminal: { name: string } | null;
  variant: { direction: string; route: { name: string } | null } | null;
}

function Recent() {
  const [rows, setRows] = useState<RecentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const c = await getSupabase();
      if (!c) return setError('The LAKBAY database is not connected.');
      const { data, error: err } = await c
        .from('field_checks')
        .select(
          'id, outcome, observed_at, status_before, status_after, distance_m, gps_accuracy_m, fare_paid, ' +
            'stop:stops!field_checks_stop_id_fkey(name), terminal:terminals(name), variant:route_variants(direction, route:routes(name))',
        )
        .order('created_at', { ascending: false })
        .limit(30);
      if (err) setError(err.message);
      else setRows((data ?? []) as unknown as RecentRow[]);
    })();
  }, []);

  if (error)
    return (
      <p role="alert" className="text-sm text-red-700 dark:text-red-300">
        {error}
      </p>
    );
  if (!rows) return <Spinner />;
  if (rows.length === 0) return <EmptyState icon="history" title="No field checks yet" />;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="rounded-2xl border border-line bg-surface p-3 text-sm">
          <p className="font-semibold">
            {r.stop?.name ?? r.terminal?.name ?? (r.variant ? `${r.variant.route?.name ?? 'Route'} (${r.variant.direction})` : 'Record')}
          </p>
          <p className="text-xs text-muted">
            {formatDate(r.observed_at)} · {r.outcome.replace('_', ' ')} · {statusLabel[r.status_before]} → {statusLabel[r.status_after]}
            {r.distance_m != null && ` · ${Math.round(Number(r.distance_m))} m from pin`}
            {r.gps_accuracy_m != null && ` · ±${Math.round(Number(r.gps_accuracy_m))} m`}
            {r.fare_paid != null && ` · paid ₱${r.fare_paid}`}
          </p>
        </li>
      ))}
    </ul>
  );
}
