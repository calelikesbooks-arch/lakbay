import { useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardTitle } from '../components/ui/Card';
import { Icon } from '../components/ui/Icon';
import { PageHeader } from '../components/ui/PageHeader';
import { PlaceholderNotice } from '../components/ui/PlaceholderNotice';
import { Spinner } from '../components/ui/Spinner';
import { env } from '../lib/env';
import { testSupabaseConnection, type ConnectionResult } from '../lib/supabase';
import { useTheme } from '../theme/ThemeContext';
import type { LoadState, ThemePreference } from '../types';

const themeOptions: { value: ThemePreference; label: string; icon: 'sun' | 'moon' | 'monitor' }[] = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'Device', icon: 'monitor' },
];

function SupabaseStatusBadge() {
  switch (env.supabase.state) {
    case 'configured':
      return <Badge tone="success">Configured</Badge>;
    case 'invalid':
      return <Badge tone="danger">Config problem</Badge>;
    default:
      return <Badge>Not configured</Badge>;
  }
}

export default function ProfilePage() {
  const { preference, setPreference } = useTheme();
  const [check, setCheck] = useState<LoadState<ConnectionResult>>({ status: 'idle' });

  async function runCheck() {
    setCheck({ status: 'loading' });
    try {
      setCheck({ status: 'success', data: await testSupabaseConnection() });
    } catch {
      setCheck({ status: 'error', message: 'The check itself failed unexpectedly.' });
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Ikaw" title="Profile and settings" />

      <Card>
        <CardTitle>Appearance</CardTitle>
        <fieldset className="mt-3">
          <legend className="sr-only">Theme</legend>
          <div className="grid grid-cols-3 gap-2">
            {themeOptions.map((option) => {
              const selected = preference === option.value;
              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border-2 p-3 text-sm font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500 ${
                    selected ? 'border-sun-400 bg-sun-50 text-ink dark:bg-sun-400/10' : 'border-line text-muted hover:text-ink'
                  }`}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={option.value}
                    checked={selected}
                    onChange={() => setPreference(option.value)}
                    className="sr-only"
                  />
                  <Icon name={option.icon} />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      </Card>

      <PlaceholderNotice feature="Account and sign-in" phase="Phase 3">
        No accounts exist yet. Saved trips and reports stay on this device. LAKBAY does not collect personal data in this build.
      </PlaceholderNotice>

      <Card>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>App diagnostics</CardTitle>
          <Badge>{env.mode}</Badge>
        </div>
        <dl className="mt-3 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted">Supabase</dt>
            <dd>
              <SupabaseStatusBadge />
            </dd>
          </div>
          {env.supabase.state === 'invalid' && (
            <p className="rounded-xl bg-red-50 p-2 text-red-800 dark:bg-red-950/40 dark:text-red-200">{env.supabase.reason}</p>
          )}
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted">Map style</dt>
            <dd className="text-right">{env.usingDefaultMapStyle ? 'OpenFreeMap (default)' : 'Custom'}</dd>
          </div>
        </dl>

        <div className="mt-4 border-t border-line pt-4">
          <Button variant="secondary" onClick={runCheck} disabled={check.status === 'loading' || env.supabase.state !== 'configured'}>
            {check.status === 'loading' ? <Spinner className="size-4" /> : <Icon name="refresh" className="size-4" />}
            Test Supabase connection
          </Button>
          {env.supabase.state === 'not-configured' && (
            <p className="mt-2 text-xs text-muted">Add your Supabase values to .env.local to enable this test.</p>
          )}
          <div aria-live="polite" className="mt-2 text-sm">
            {check.status === 'success' && (
              <p className={check.data.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}>
                {check.data.message}
              </p>
            )}
            {check.status === 'error' && <p className="text-red-700 dark:text-red-300">{check.message}</p>}
          </div>
        </div>
      </Card>

      <Link to="/design" className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:bg-surface-2/60">
        <span className="grid size-10 place-items-center rounded-xl bg-surface-2 text-ink">
          <Icon name="palette" className="size-5" />
        </span>
        <span className="flex-1">
          <span className="block font-bold">Design system preview</span>
          <span className="block text-sm text-muted">Every component, shown with clearly labeled sample data</span>
        </span>
        <Icon name="chevronRight" className="size-5 text-muted" />
      </Link>
    </div>
  );
}
