import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[0_1px_2px_rgb(11_17_34/0.04)] ${className}`}
      {...rest}
    />
  );
}

export function CardTitle({ className = '', ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={`text-base font-bold text-ink ${className}`} {...rest} />;
}

/** Small uppercase label above a group of content. */
export function SectionLabel({ className = '', ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={`mb-2.5 text-xs font-bold tracking-wider text-muted uppercase ${className}`} {...rest} />;
}
