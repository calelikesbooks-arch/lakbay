import type { Terminal } from '../../types/transport';
import { SourceList } from '../evidence/SourceList';
import { VerificationBadge } from '../evidence/VerificationBadge';
import { Signboard } from '../route/Signboard';
import { Icon } from '../ui/Icon';
import { ModeChip } from '../ui/TransportIcon';

export function TerminalCard({ terminal }: { terminal: Terminal }) {
  return (
    <article className="flex h-full flex-col rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-ink">{terminal.name}</h3>
          <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
            <Icon name="pin" className="size-4" /> {terminal.locality}
          </p>
        </div>
        <VerificationBadge verification={terminal.verification} />
      </header>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {terminal.modes.map((mode) => (
          <ModeChip key={mode} mode={mode} compact />
        ))}
      </div>

      {terminal.servesDestinations.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-bold tracking-wider text-muted uppercase">Signboards here</p>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {terminal.servesDestinations.map((d) => (
              <Signboard key={d} text={d} />
            ))}
          </div>
        </div>
      )}

      <dl className="mt-3 space-y-1.5 text-sm">
        {terminal.landmark && (
          <div className="flex gap-2">
            <dt className="text-muted">Landmark:</dt>
            <dd className="text-ink">{terminal.landmark}</dd>
          </div>
        )}
        {terminal.operatingHours && (
          <div className="flex gap-2">
            <dt className="text-muted">Hours:</dt>
            <dd className="text-ink">{terminal.operatingHours}</dd>
          </div>
        )}
      </dl>
      {terminal.notes && <p className="mt-2 text-sm text-ink/85">{terminal.notes}</p>}

      <details className="group mt-auto pt-3">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-semibold text-brand-700 dark:text-brand-300 [&::-webkit-details-marker]:hidden">
          Sources ({terminal.sources.length})
          <Icon name="chevronDown" className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-2 animate-fade">
          <SourceList sources={terminal.sources} />
        </div>
      </details>
    </article>
  );
}
