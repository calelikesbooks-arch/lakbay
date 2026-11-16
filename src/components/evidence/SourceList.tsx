import { formatDate } from '../../lib/format';
import type { Source, SourceType } from '../../types/transport';
import { Icon, type IconName } from '../ui/Icon';

const typeInfo: Record<SourceType, { label: string; icon: IconName }> = {
  field_survey: { label: 'Field survey', icon: 'camera' },
  official_document: { label: 'Official document', icon: 'document' },
  operator: { label: 'Operator', icon: 'link' },
  openstreetmap: { label: 'OpenStreetMap', icon: 'map' },
  community: { label: 'Community report', icon: 'users' },
  news: { label: 'News report', icon: 'document' },
  other: { label: 'Other source', icon: 'link' },
};

/** Removes duplicate sources (same id) while keeping order. */
export function uniqueSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

export function SourceList({ sources }: { sources: Source[] }) {
  if (sources.length === 0) {
    return <p className="text-sm text-muted">No sources recorded. LAKBAY does not show unsourced routes as recommendations.</p>;
  }
  return (
    <ul className="space-y-2">
      {uniqueSources(sources).map((source) => {
        const info = typeInfo[source.type];
        return (
          <li key={source.id} className="flex gap-3 rounded-2xl bg-surface-2 p-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-surface text-brand-700 dark:text-brand-300">
              <Icon name={info.icon} className="size-4" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="text-[11px] font-bold tracking-wider text-muted uppercase">{info.label}</p>
              {source.url ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold break-words text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
                >
                  {source.title}
                </a>
              ) : (
                <p className="font-semibold break-words text-ink">{source.title}</p>
              )}
              <p className="text-xs text-muted">
                Observed {formatDate(source.observedOn)}
                {source.observer && ` · by ${source.observer}`}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
