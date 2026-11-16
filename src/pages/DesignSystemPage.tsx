import type { ReactNode } from 'react';
import { EvidencePanel } from '../components/evidence/EvidencePanel';
import { VerificationBadge } from '../components/evidence/VerificationBadge';
import { RouteComparison } from '../components/route/RouteComparison';
import { Signboard } from '../components/route/Signboard';
import { TerminalCard } from '../components/terminal/TerminalCard';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { SectionLabel } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { LogoMark, TAGLINE } from '../components/ui/Logo';
import { PageHeader } from '../components/ui/PageHeader';
import { PlaceholderNotice } from '../components/ui/PlaceholderNotice';
import { ModeChip, TransportIcon } from '../components/ui/TransportIcon';
import { sampleItineraries, sampleTerminal } from '../data/samples';
import { allModes, modeMeta } from '../lib/modes';

const swatches = [
  { name: 'Navy 900', className: 'bg-navy-900', use: 'Hero, active nav' },
  { name: 'Navy 950', className: 'bg-navy-950', use: 'Dark canvas, text' },
  { name: 'Teal 500', className: 'bg-brand-500', use: 'Origin, verified, links' },
  { name: 'Teal 700', className: 'bg-brand-700', use: 'Link text (light)' },
  { name: 'Sun 400', className: 'bg-sun-400', use: 'Main action, destination' },
  { name: 'Sun 100', className: 'bg-sun-100', use: 'Placeholder, partial' },
];

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <div className="space-y-9">
      <PageHeader eyebrow="Para sa developers" title="Design system" description="The building blocks of LAKBAY's interface, in one place." />

      <div role="note" className="flex gap-3 rounded-[var(--radius-card)] border-2 border-red-300 bg-red-50 p-4 text-sm dark:border-red-500/40 dark:bg-red-500/10">
        <Icon name="alert" className="size-5 shrink-0 text-red-700 dark:text-red-300" />
        <p>
          <strong>Sample data only.</strong> Every route, place, fare and source on this page is fictional and exists only to preview the
          components. None of it is real transport information.
        </p>
      </div>

      <Block title="Brand">
        <div className="flex items-center gap-4 rounded-[var(--radius-card)] bg-navy-900 p-5 text-white">
          <LogoMark className="size-14" />
          <div>
            <p className="text-2xl font-extrabold tracking-[0.08em]">LAKBAY</p>
            <p className="text-sun-300">{TAGLINE}</p>
          </div>
        </div>
      </Block>

      <Block title="Colors">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {swatches.map((s) => (
            <li key={s.name} className="overflow-hidden rounded-2xl border border-line bg-surface">
              <div className={`h-14 ${s.className}`} />
              <div className="p-3">
                <p className="text-sm font-bold">{s.name}</p>
                <p className="text-xs text-muted">{s.use}</p>
              </div>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Typography · Plus Jakarta Sans">
        <div className="space-y-2 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <p className="text-4xl font-extrabold tracking-tight">Saan ang punta mo?</p>
          <p className="text-2xl font-extrabold tracking-tight">Page title</p>
          <p className="text-base font-bold">Card title</p>
          <p className="text-[15px]">Body text for instructions and descriptions.</p>
          <p className="text-sm text-muted">Secondary text, hints and metadata.</p>
          <p className="text-xs font-bold tracking-wider text-muted uppercase">Section label</p>
        </div>
      </Block>

      <Block title="Buttons and badges">
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="navy">Navy</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="brand">Brand</Badge>
          <Badge tone="sun">Sun</Badge>
          <Badge tone="success">Success</Badge>
          <Badge tone="warning">Warning</Badge>
          <Badge tone="danger">Danger</Badge>
          <Badge>Neutral</Badge>
        </div>
      </Block>

      <Block title="Transport modes">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {allModes.map((mode) => (
            <li key={mode} className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface p-4">
              <span className={`grid size-12 place-items-center rounded-2xl ${mode === 'walk' ? 'bg-surface-2 text-muted' : `${modeMeta[mode].dot} text-navy-950`}`}>
                <TransportIcon mode={mode} className="size-7" />
              </span>
              <ModeChip mode={mode} />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          Signboard style: <Signboard text="Sample – Route A" />
        </div>
      </Block>

      <Block title="Verification labels">
        <div className="flex flex-wrap gap-2">
          <VerificationBadge verification={{ level: 'verified', lastVerified: '2026-10-01' }} showDate />
          <VerificationBadge verification={{ level: 'partial', lastVerified: '2026-09-15' }} showDate />
          <VerificationBadge verification={{ level: 'unverified' }} />
          <VerificationBadge verification={{ level: 'verified', lastVerified: '2026-01-10' }} showDate />
        </div>
        <p className="text-xs text-muted">The last one shows "Needs re-check": verified more than 180 days ago.</p>
      </Block>

      <Block title="Route comparison + commute instructions (sample)">
        <RouteComparison itineraries={sampleItineraries} />
      </Block>

      <Block title="Evidence panel (sample)">
        <EvidencePanel verification={{ level: 'verified', lastVerified: '2026-10-01' }} sources={sampleItineraries[0].legs.flatMap((l) => l.sources)} defaultOpen />
      </Block>

      <Block title="Terminal card (sample)">
        <div className="max-w-md">
          <TerminalCard terminal={sampleTerminal} />
        </div>
      </Block>

      <Block title="States">
        <div className="grid gap-3 sm:grid-cols-2">
          <EmptyState icon="bookmark" title="Empty state">
            Shown when there's nothing to list yet.
          </EmptyState>
          <PlaceholderNotice feature="Placeholder notice" phase="Example phase">
            Wraps every feature that isn't built yet.
          </PlaceholderNotice>
        </div>
      </Block>
    </div>
  );
}
