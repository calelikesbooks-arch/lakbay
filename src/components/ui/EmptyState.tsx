import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface EmptyStateProps {
  icon: IconName;
  title: string;
  children?: ReactNode;
  /** Use "plain" inside another card (no border). */
  variant?: 'card' | 'plain';
}

export function EmptyState({ icon, title, children, variant = 'card' }: EmptyStateProps) {
  const frame = variant === 'card' ? 'rounded-[var(--radius-card)] border border-line bg-surface' : '';
  return (
    <div className={`flex flex-col items-center px-6 py-9 text-center ${frame}`}>
      <span className="grid size-12 place-items-center rounded-2xl bg-surface-2 text-muted">
        <Icon name={icon} className="size-6" />
      </span>
      <h2 className="mt-3 font-bold text-ink">{title}</h2>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}
