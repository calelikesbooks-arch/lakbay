import { useMemo, useState } from 'react';
import { sortItineraries, summarize, type SortKey } from '../../lib/routing/itinerary';
import type { Itinerary } from '../../types/transport';
import { EvidencePanel } from '../evidence/EvidencePanel';
import { SegmentedControl } from '../ui/SegmentedControl';
import { LegTimeline } from './LegTimeline';
import { RouteCard } from './RouteCard';

const sortOptions: { value: SortKey; label: string }[] = [
  { value: 'cheapest', label: 'Cheapest' },
  { value: 'fewest_transfers', label: 'Fewest transfers' },
  { value: 'least_walking', label: 'Least walking' },
];

/** Sortable list of route options; the selected one expands into full steps + evidence. */
export function RouteComparison({ itineraries }: { itineraries: Itinerary[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('cheapest');
  const sorted = useMemo(() => sortItineraries(itineraries, sortKey), [itineraries, sortKey]);
  const [selectedId, setSelectedId] = useState<string | null>(sorted[0]?.id ?? null);

  // Only label the top card "Cheapest" etc. when there is something to compare
  // and the top value is actually known.
  const topSummary = sorted[0] ? summarize(sorted[0]) : null;
  const canHighlight = sorted.length > 1 && !!topSummary && (sortKey !== 'cheapest' || topSummary.fare !== null);

  return (
    <section aria-label="Route options" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          <strong className="text-ink">{sorted.length}</strong> verified {sorted.length === 1 ? 'option' : 'options'}
        </p>
        {sorted.length > 1 && <SegmentedControl label="Sort routes" options={sortOptions} value={sortKey} onChange={setSortKey} />}
      </div>

      <ul className="space-y-3">
        {sorted.map((itinerary, index) => {
          const selected = itinerary.id === selectedId;
          const detailsId = `route-details-${itinerary.id}`;
          const allSources = itinerary.legs.flatMap((leg) => leg.sources);
          const s = summarize(itinerary);
          return (
            <li key={itinerary.id} className="animate-rise" style={{ animationDelay: `${index * 40}ms` }}>
              <RouteCard
                itinerary={itinerary}
                selected={selected}
                onSelect={() => setSelectedId(selected ? null : itinerary.id)}
                highlight={index === 0 && canHighlight ? sortOptions.find((o) => o.value === sortKey)?.label : undefined}
                detailsId={detailsId}
              />
              {selected && (
                <div id={detailsId} className="mt-2 space-y-3 rounded-[var(--radius-card)] bg-surface-2/60 p-3 animate-rise sm:p-4">
                  <LegTimeline itinerary={itinerary} />
                  <EvidencePanel verification={{ level: s.verification, lastVerified: s.oldestVerified }} sources={allSources} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
