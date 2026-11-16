import { useState } from 'react';
import { formatDate } from '../../lib/format';
import { useLocalStore } from '../../lib/localStore';
import { deleteLocalReport, myReportsStore, reportCategories, retryReport } from '../../lib/reports';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';

/** Reports made on this device, with honest send status. */
export function MyReports() {
  const reports = useLocalStore(myReportsStore);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (reports.length === 0) return null;

  async function retry(id: string) {
    setBusyId(id);
    setMessage(null);
    const outcome = await retryReport(id);
    setMessage(outcome.kind === 'sent' ? 'Report sent for review.' : outcome.reason);
    setBusyId(null);
  }

  return (
    <section aria-labelledby="my-reports-heading">
      <h2 id="my-reports-heading" className="mb-2.5 text-xs font-bold tracking-wider text-muted uppercase">
        Your reports on this device
      </h2>
      <ul className="space-y-2">
        {reports.map((report) => (
          <li key={report.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{report.location}</p>
              {report.status === 'sent' ? (
                <Badge tone="brand">
                  <Icon name="check" className="size-3.5" /> Sent for review
                </Badge>
              ) : (
                <Badge tone="sun">Saved on device · not sent</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted">
              {reportCategories.find((c) => c.value === report.category)?.label} · seen {formatDate(report.observedOn)}
            </p>
            <p className="mt-2 line-clamp-3 text-sm text-ink/85">{report.details}</p>
            {report.status === 'saved_locally' && (
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => retry(report.id)} disabled={busyId === report.id}>
                  {busyId === report.id ? <Spinner className="size-4" /> : <Icon name="send" className="size-4" />} Try sending
                </Button>
                <Button size="sm" variant="danger" onClick={() => deleteLocalReport(report.id)}>
                  <Icon name="trash" className="size-4" /> Delete
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {message && (
        <p role="status" className="mt-2 text-sm text-muted">
          {message}
        </p>
      )}
    </section>
  );
}
