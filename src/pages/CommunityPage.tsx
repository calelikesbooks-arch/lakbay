import { useSearchParams } from 'react-router';
import { MyReports } from '../components/community/MyReports';
import { ReportForm } from '../components/community/ReportForm';
import { SectionLabel } from '../components/ui/Card';
import { Icon } from '../components/ui/Icon';
import { PageHeader } from '../components/ui/PageHeader';
import { PlaceholderNotice } from '../components/ui/PlaceholderNotice';
import { env } from '../lib/env';

const steps = [
  { icon: 'send', title: 'You report', text: 'What changed, where, and when you saw it.' },
  { icon: 'shieldCheck', title: 'A moderator checks', text: 'Reports are never published automatically.' },
  { icon: 'camera', title: 'Someone re-surveys', text: 'The route is ridden again before the data changes.' },
] as const;

export default function CommunityPage() {
  const [params] = useSearchParams();
  const about = (params.get('about') ?? '').slice(0, 120);
  const sendingEnabled = env.supabase.state === 'configured';

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Bayanihan sa biyahe"
        title="Community"
        description="Help keep LAKBAY accurate. Tell us when a route, terminal or fare changes."
      />

      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-400/15 dark:text-brand-200">
              <Icon name={step.icon} className="size-5" />
            </span>
            <div>
              <p className="font-bold">
                {i + 1}. {step.title}
              </p>
              <p className="text-sm text-muted">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="grid gap-7 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="report-heading" className="space-y-3">
          <SectionLabel id="report-heading">Report a change</SectionLabel>
          {!sendingEnabled && (
            <p className="rounded-2xl bg-sun-50 p-3 text-sm text-ink dark:bg-sun-400/5">
              <strong>Sending is not set up yet.</strong> Your report will be saved on this device and labeled "not sent"
              until LAKBAY's database is connected.
            </p>
          )}
          <ReportForm initialLocation={about} />
        </section>
        <aside className="space-y-4">
          <MyReports />
          <PlaceholderNotice feature="Community mappers" phase="Phase 3">
            Trained volunteers will submit surveyed routes with photos and GPS tracks as evidence.
          </PlaceholderNotice>
        </aside>
      </div>
    </div>
  );
}
