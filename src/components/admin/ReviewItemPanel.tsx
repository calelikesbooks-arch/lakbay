import { useState } from 'react';
import { formatDate } from '../../lib/format';
import { reviewActions, type ActionResult, type QueueItem } from '../../lib/admin/review';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Field, Select, TextArea, TextInput } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';

interface ReviewItemPanelProps {
  item: QueueItem;
  modes: { code: string; label: string }[];
  onDone: (result: ActionResult) => void;
}

const kindLabel = { terminal: 'Terminal', stop: 'Stop', route: 'Route' } as const;

/** Details of one candidate and the four review decisions. */
export function ReviewItemPanel({ item, modes, onDone }: ReviewItemPanelProps) {
  const [municipality, setMunicipality] = useState(item.municipality ?? '');
  const [province, setProvince] = useState(item.province ?? '');
  const [mode, setMode] = useState(item.mode_hints[0] ?? '');
  const [direction, setDirection] = useState('outbound');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<ActionResult | null>(null);

  const blocked = item.quality === 'blocked';
  const decided = item.review_status !== 'pending' && item.review_status !== 'needs_info';

  async function run(name: string, action: () => Promise<ActionResult>) {
    setBusy(name);
    setMessage(null);
    const result = await action();
    setBusy(null);
    setMessage(result);
    if (result.ok) onDone(result);
  }

  const osmViewUrl =
    item.lat != null && item.lon != null
      ? `https://www.openstreetmap.org/?mlat=${item.lat}&mlon=${item.lon}#map=19/${item.lat}/${item.lon}`
      : null;
  const modeOptions = [
    ...item.mode_hints.map((code) => modes.find((m) => m.code === code) ?? { code, label: code }),
    ...modes.filter((m) => !item.mode_hints.includes(m.code)),
  ];

  return (
    <article className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{kindLabel[item.kind]}</Badge>
          <Badge tone={item.quality === 'ok' ? 'success' : item.quality === 'warning' ? 'sun' : 'danger'}>{item.quality}</Badge>
          {item.changed_since_review && <Badge tone="warning">Changed upstream after review</Badge>}
          {item.missing_upstream && <Badge tone="danger">No longer in the source</Badge>}
          {item.review_status === 'needs_info' && <Badge tone="brand">Needs info</Badge>}
        </div>
        <h2 className="mt-2 text-lg font-extrabold">{item.name ?? item.ref ?? '(no name in source)'}</h2>
        <p className="text-sm text-muted">
          {item.classification.replace(/_/g, ' ')}
          {item.municipality && ` · ${item.municipality}, ${item.province}`}
          {item.kind === 'route' && (item.from_label || item.to_label) && ` · ${item.from_label ?? '?'} → ${item.to_label ?? '?'}`}
        </p>
      </header>

      <p className="rounded-2xl bg-sun-50 p-3 text-sm dark:bg-sun-400/5">
        <strong>Unverified import.</strong>{' '}
        {item.kind === 'route'
          ? 'A mapped route only shows that someone recorded it. It is not proof that the service runs today.'
          : 'Promoting creates a draft. Only a field survey, official document or operator source can verify it later.'}
      </p>

      {item.issues.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-xs font-bold tracking-wider text-muted uppercase">Issues</h3>
          <ul className="space-y-1.5 text-sm">
            {item.issues.map((issue) => (
              <li key={issue.code} className="flex gap-2">
                <Icon name={issue.severity === 'blocker' ? 'alert' : 'info'} className={`mt-0.5 size-4 shrink-0 ${issue.severity === 'blocker' ? 'text-red-600' : 'text-sun-600'}`} />
                <span>
                  <strong className="font-semibold">{issue.code.replace(/_/g, ' ')}:</strong> {issue.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Source</dt>
        <dd>
          {item.provider_name} · <span className="text-muted">{item.attribution_text}</span>
        </dd>
        <dt className="text-muted">Record</dt>
        <dd className="break-all">
          {item.external_url ? (
            <a href={item.external_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 underline dark:text-brand-300">
              {item.external_id}
            </a>
          ) : (
            item.external_id
          )}
        </dd>
        {item.mode_hints.length > 0 && (
          <>
            <dt className="text-muted">Mode hints</dt>
            <dd>
              {item.mode_hints.join(', ')} <span className="text-muted">({item.mode_confidence})</span>
            </dd>
          </>
        )}
        {item.lat != null && (
          <>
            <dt className="text-muted">Location</dt>
            <dd>
              {item.lat.toFixed(6)}, {item.lon?.toFixed(6)}{' '}
              {osmViewUrl && (
                <a href={osmViewUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline dark:text-brand-300">
                  view
                </a>
              )}
            </dd>
          </>
        )}
        {item.kind === 'route' && (
          <>
            <dt className="text-muted">Line</dt>
            <dd>{item.has_path ? 'continuous line available' : item.path_complete === false ? 'has gaps (not stored)' : 'none'}</dd>
            <dt className="text-muted">Stops listed</dt>
            <dd>{item.member_count}</dd>
          </>
        )}
        {item.upstream_timestamp && (
          <>
            <dt className="text-muted">Last edited</dt>
            <dd>{formatDate(item.upstream_timestamp)}</dd>
          </>
        )}
      </dl>

      {item.matched_id && (
        <div className="rounded-2xl border border-brand-300 bg-brand-50 p-3 text-sm dark:border-brand-400/30 dark:bg-brand-400/10">
          <p>
            <strong>Possible match in LAKBAY:</strong> {item.matched_name ?? item.matched_id} ({Math.round(Number(item.match_distance_m ?? 0))} m away, name
            similarity {Math.round(Number(item.match_name_similarity ?? 0) * 100)}%)
          </p>
          <Button size="sm" variant="secondary" className="mt-2" disabled={!!busy || decided} onClick={() => run('link', () => reviewActions.link(item.id, item.matched_id!, note))}>
            {busy === 'link' && <Spinner className="size-4" />} Same place: link and cite
          </Button>
        </div>
      )}
      {item.batch_duplicate_of && (
        <p className="text-sm text-muted">This looks like a duplicate of another candidate from the same import. Usually: reject this one.</p>
      )}

      <section className="space-y-3 border-t border-line pt-4">
        {item.kind !== 'route' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`m-${item.id}`} label="Municipality" hint={item.municipality ? undefined : 'Not known from the source. Enter it yourself.'}>
              <TextInput id={`m-${item.id}`} value={municipality} onChange={(e) => setMunicipality(e.target.value)} />
            </Field>
            <Field id={`p-${item.id}`} label="Province">
              <TextInput id={`p-${item.id}`} value={province} onChange={(e) => setProvince(e.target.value)} />
            </Field>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`mode-${item.id}`} label="Transport mode (you decide)" hint="Hints come first. Choose what you know is true.">
              <Select id={`mode-${item.id}`} value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="">Choose…</option>
                {modeOptions.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.label}
                    {item.mode_hints.includes(m.code) ? ' (hint)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id={`dir-${item.id}`} label="Direction">
              <Select id={`dir-${item.id}`} value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="outbound">Outbound</option>
                <option value="inbound">Inbound</option>
                <option value="loop">Loop</option>
                <option value="bidirectional">Both directions</option>
              </Select>
            </Field>
          </div>
        )}
        <Field id={`note-${item.id}`} label="Note / reason" hint="Required to reject or ask for info.">
          <TextArea id={`note-${item.id}`} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-20" maxLength={2000} />
        </Field>

        <div className="flex flex-wrap gap-2">
          {item.kind !== 'route' ? (
            <Button
              disabled={!!busy || blocked || decided || !municipality.trim() || !province.trim()}
              onClick={() => run('promote', () => reviewActions.promote(item.id, municipality.trim(), province.trim(), note))}
            >
              {busy === 'promote' && <Spinner className="size-4 text-navy-950" />} Promote as draft
            </Button>
          ) : (
            <Button disabled={!!busy || blocked || decided || !mode} onClick={() => run('promote', () => reviewActions.promoteRoute(item.id, mode, direction, note))}>
              {busy === 'promote' && <Spinner className="size-4 text-navy-950" />} Promote route as draft
            </Button>
          )}
          <Button variant="secondary" disabled={!!busy || decided || !note.trim()} onClick={() => run('info', () => reviewActions.needsInfo(item.id, note.trim()))}>
            Needs info
          </Button>
          <Button variant="danger" disabled={!!busy || !note.trim() || item.review_status === 'promoted' || item.review_status === 'linked'} onClick={() => run('reject', () => reviewActions.reject(item.id, note.trim()))}>
            Reject
          </Button>
        </div>
        {blocked && <p className="text-sm text-red-700 dark:text-red-300">Blocked: fix the blocking issues in the source (or survey it) and re-import.</p>}
        {message && (
          <p role="status" className={`text-sm ${message.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
            {message.message}
          </p>
        )}
      </section>

      {Object.keys(item.raw_tags).length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-muted">Original data ({Object.keys(item.raw_tags).length} fields)</summary>
          <table className="mt-2 w-full text-xs">
            <tbody>
              {Object.entries(item.raw_tags).map(([k, v]) => (
                <tr key={k} className="border-b border-line">
                  <td className="py-1 pr-2 font-mono text-muted">{k}</td>
                  <td className="py-1 font-mono break-all">{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </article>
  );
}
