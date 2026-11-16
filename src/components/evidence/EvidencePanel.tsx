import type { Source, Verification } from '../../types/transport';
import { Icon } from '../ui/Icon';
import { SourceList, uniqueSources } from './SourceList';
import { VerificationBadge } from './VerificationBadge';

interface EvidencePanelProps {
  verification: Verification;
  sources: Source[];
  /** Start opened. */
  defaultOpen?: boolean;
}

/** "Why should I trust this?" A collapsible box with verification status and sources. */
export function EvidencePanel({ verification, sources, defaultOpen = false }: EvidencePanelProps) {
  const count = uniqueSources(sources).length;
  return (
    <details open={defaultOpen} className="group rounded-[var(--radius-card)] border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <Icon name="shieldCheck" className="size-5 text-brand-600 dark:text-brand-300" />
          <span className="font-bold text-ink">Evidence</span>
          <span className="text-sm text-muted">
            {count} {count === 1 ? 'source' : 'sources'}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <VerificationBadge verification={verification} />
          <Icon name="chevronDown" className="size-4 text-muted transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="border-t border-line p-4 animate-fade">
        <VerificationBadge verification={verification} showDate />
        <div className="mt-3">
          <SourceList sources={sources} />
        </div>
      </div>
    </details>
  );
}
