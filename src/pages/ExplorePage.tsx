import { useMemo, useState } from 'react';
import { TerminalCard } from '../components/terminal/TerminalCard';
import { SectionLabel } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { PlaceholderNotice } from '../components/ui/PlaceholderNotice';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { verifiedTerminals } from '../data/pilot';

type Area = 'all' | 'Marilao' | 'Meycauayan' | 'Bocaue' | 'Metro Manila';

const areaOptions: { value: Area; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'Marilao', label: 'Marilao' },
  { value: 'Meycauayan', label: 'Meycauayan' },
  { value: 'Bocaue', label: 'Bocaue' },
  { value: 'Metro Manila', label: 'Metro Manila' },
];

const planned = [
  { feature: 'Fare calculator', phase: 'Phase 4', note: 'Estimate fares from official LTFRB and town fare rules.' },
  { feature: 'Rail information', phase: 'Phase 4', note: 'Stations and connections for LRT-1, LRT-2 and MRT-3.' },
  { feature: 'Weather and heat index', phase: 'Phase 5', note: 'Trip-day conditions from a free public source.' },
  { feature: 'Tour guide and itinerary planner', phase: 'Phase 7', note: 'Places to visit and multi-stop day plans.' },
];

export default function ExplorePage() {
  const [area, setArea] = useState<Area>('all');
  const terminals = useMemo(
    () => (area === 'all' ? verifiedTerminals : verifiedTerminals.filter((t) => t.locality.includes(area))),
    [area],
  );

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Tuklasin" title="Explore" description="Terminals and tools for planning your commute." />

      <section aria-labelledby="terminals-heading" className="space-y-3">
        <SectionLabel id="terminals-heading">Terminal finder</SectionLabel>
        <div className="overflow-x-auto pb-1">
          <SegmentedControl label="Filter terminals by area" options={areaOptions} value={area} onChange={setArea} />
        </div>
        {terminals.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {terminals.map((terminal) => (
              <li key={terminal.id}>
                <TerminalCard terminal={terminal} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="route" title="No verified terminals yet">
            Terminals appear here after they are surveyed and cited. Nothing is listed from guesswork.
          </EmptyState>
        )}
      </section>

      <section aria-labelledby="tools-heading">
        <SectionLabel id="tools-heading">More tools</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          {planned.map((item) => (
            <PlaceholderNotice key={item.feature} feature={item.feature} phase={item.phase}>
              {item.note}
            </PlaceholderNotice>
          ))}
        </div>
      </section>
    </div>
  );
}
