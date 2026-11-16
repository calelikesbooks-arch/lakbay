import type { ReactNode } from 'react';

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'brand' | 'sun';

const tones: Record<Tone, string> = {
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200',
  warning: 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200',
  danger: 'bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-200',
  neutral: 'bg-surface-2 text-muted',
  brand: 'bg-brand-100 text-brand-800 dark:bg-brand-400/15 dark:text-brand-200',
  sun: 'bg-sun-100 text-sun-700 dark:bg-sun-400/15 dark:text-sun-300',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}
