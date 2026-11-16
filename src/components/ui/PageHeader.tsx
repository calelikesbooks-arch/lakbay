import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  /** Small line above the title, e.g. a Filipino phrase. */
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, eyebrow, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3 animate-rise">
      <div>
        {eyebrow && <p className="text-sm font-semibold text-brand-700 dark:text-brand-300">{eyebrow}</p>}
        <h1 className="text-2xl font-extrabold tracking-tight text-ink md:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-prose text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </header>
  );
}
