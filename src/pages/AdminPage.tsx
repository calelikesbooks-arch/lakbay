import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ReviewItemPanel } from '../components/admin/ReviewItemPanel';
import { StaffGate, useSignedIn } from '../components/admin/StaffGate';
import { Badge } from '../components/ui/Badge';
import { Button, buttonClasses } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { PageHeader } from '../components/ui/PageHeader';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Spinner } from '../components/ui/Spinner';
import {
  fetchModeOptions,
  fetchProviders,
  fetchQueue,
  fetchRuns,
  type ProviderRow,
  type QueueFilter,
  type QueueItem,
  type RunRow,
} from '../lib/admin/review';
import { signOut } from '../lib/auth';
import { formatDate } from '../lib/format';

type Tab = 'queue' | 'sources' | 'runs';

export default function AdminPage() {
  const signedIn = useSignedIn();
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Para sa moderators"
        title="Data review"
        description="Imported candidates wait here. Nothing reaches the public app until it is promoted to a draft and then verified with a field survey or official source."
        actions={
          <div className="flex gap-2">
            <Link to="/field" className={buttonClasses('secondary', 'sm')}>
              <Icon name="pin" className="size-4" /> Field check
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
        <StaffArea />
      </StaffGate>
    </div>
  );
}

function StaffArea() {
  const [tab, setTab] = useState<Tab>('queue');
  return (
    <div className="space-y-4">
      <SegmentedControl
        label="Admin section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'queue', label: 'Review queue' },
          { value: 'sources', label: 'Source registry' },
          { value: 'runs', label: 'Import runs' },
        ]}
      />
      {tab === 'queue' && <Queue />}
      {tab === 'sources' && <Sources />}
      {tab === 'runs' && <Runs />}
    </div>
  );
}

function Queue() {
  const [filter, setFilter] = useState<QueueFilter>({ kind: 'all', quality: 'all' });
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modes, setModes] = useState<{ code: string; label: string }[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchQueue(filter);
      setItems(data);
      setSelectedId((current) => (current && data.some((i) => i.id === current) ? current : (data[0]?.id ?? null)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the queue.');
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    fetchModeOptions().then(setModes).catch(() => setModes([]));
  }, []);

  const selected = items?.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <SegmentedControl
          label="Kind"
          value={filter.kind}
          onChange={(kind) => setFilter((f) => ({ ...f, kind }))}
          options={[
            { value: 'all', label: 'All' },
            { value: 'terminal', label: 'Terminals' },
            { value: 'stop', label: 'Stops' },
            { value: 'route', label: 'Routes' },
          ]}
        />
        <SegmentedControl
          label="Quality"
          value={filter.quality}
          onChange={(quality) => setFilter((f) => ({ ...f, quality }))}
          options={[
            { value: 'all', label: 'Any' },
            { value: 'ok', label: 'OK' },
            { value: 'warning', label: 'Warnings' },
            { value: 'blocked', label: 'Blocked' },
          ]}
        />
        <Button variant="secondary" size="sm" className="h-10" onClick={load}>
          <Icon name="refresh" className="size-4" /> Refresh
        </Button>
      </div>

      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      {items === null && !error && <Spinner />}
      {items && items.length === 0 && (
        <EmptyState icon="check" title="Queue is empty">
          Run an import (see docs/data-pipeline.md) to add candidates.
        </EmptyState>
      )}

      {items && items.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
          <ul className="max-h-[70dvh] space-y-1.5 overflow-y-auto pr-1" aria-label="Candidates">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  aria-pressed={item.id === selectedId}
                  className={`w-full rounded-2xl border p-3 text-left ${item.id === selectedId ? 'border-brand-500 bg-surface' : 'border-line bg-surface hover:bg-surface-2/60'}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{item.name ?? item.ref ?? '(no name)'}</span>
                    <Badge tone={item.quality === 'ok' ? 'success' : item.quality === 'warning' ? 'sun' : 'danger'}>{item.quality}</Badge>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {item.kind} · {item.municipality ?? 'town unknown'} · {item.issue_count} issues
                    {item.changed_since_review && ' · changed'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected && <ReviewItemPanel key={selected.id} item={selected} modes={modes} onDone={() => setTimeout(load, 600)} />}
        </div>
      )}
    </div>
  );
}

function Sources() {
  const [rows, setRows] = useState<ProviderRow[] | null>(null);
  useEffect(() => {
    fetchProviders().then(setRows).catch(() => setRows([]));
  }, []);
  if (!rows) return <Spinner />;
  const tone = (s: ProviderRow['usage_status']) => (s === 'approved' ? 'success' : s === 'rejected' ? 'danger' : 'warning');
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {rows.map((p) => (
        <li key={p.code} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold">{p.name}</p>
            <Badge tone={tone(p.usage_status)}>{p.usage_status.replace('_', ' ')}</Badge>
          </div>
          <p className="mt-1 text-muted">
            {p.license_name} · {p.can_verify ? 'can verify records' : 'cannot verify on its own'}
          </p>
          {p.usage_notes && <p className="mt-2">{p.usage_notes}</p>}
          <p className="mt-2 font-mono text-xs text-muted">{p.code}</p>
        </li>
      ))}
    </ul>
  );
}

function Runs() {
  const [rows, setRows] = useState<RunRow[] | null>(null);
  useEffect(() => {
    fetchRuns().then(setRows).catch(() => setRows([]));
  }, []);
  if (!rows) return <Spinner />;
  if (rows.length === 0) return <EmptyState icon="history" title="No import runs yet" />;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="rounded-2xl border border-line bg-surface p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              {r.provider_code} · {r.run_kind}
            </p>
            <Badge tone={r.status === 'completed' ? 'success' : r.status === 'failed' ? 'danger' : 'warning'}>{r.status}</Badge>
          </div>
          <p className="text-xs text-muted">
            Started {formatDate(r.started_at)} · {JSON.stringify((r.stats as { byKind?: unknown }).byKind ?? {})}
          </p>
          {r.error && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{r.error}</p>}
        </li>
      ))}
    </ul>
  );
}
