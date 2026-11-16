import type { ReactNode } from 'react';
import { modeMeta } from '../../lib/modes';
import type { Mode } from '../../types/transport';

/** Original line icons for Philippine transport modes (24×24 grid). */
const glyphs: Record<Mode, ReactNode> = {
  walk: (
    <>
      <circle cx="13" cy="4.5" r="1.75" />
      <path d="M10.5 21 12 15.5l2.5 2.5V21M12 15.5 11 10l3.5.5L16 13M11 10 8 12v3" />
    </>
  ),
  jeepney: (
    <>
      <path d="M5 5.5h12" />
      <path d="M3 15.5v-6A2.5 2.5 0 0 1 5.5 7H17l3 4.5v4" />
      <path d="M6 7v4.5h14M10 7v4.5M14 7v4.5" />
      <path d="M2.5 15.5h19" />
      <circle cx="7" cy="17.5" r="1.75" />
      <circle cx="17" cy="17.5" r="1.75" />
    </>
  ),
  modern_jeepney: (
    <>
      <rect x="3" y="5" width="18" height="11" rx="2.5" />
      <path d="M3 10.5h18M8 5v5.5M13 5v5.5" />
      <circle cx="7.5" cy="17.75" r="1.75" />
      <circle cx="16.5" cy="17.75" r="1.75" />
    </>
  ),
  uv_express: (
    <>
      <path d="M3 16V8a2 2 0 0 1 2-2h9l4 4.5h1.5A1.5 1.5 0 0 1 21 12v4" />
      <path d="M3 16h18M14 6v4.5h4M9 6v4.5H3" />
      <circle cx="7" cy="17.75" r="1.75" />
      <circle cx="17" cy="17.75" r="1.75" />
    </>
  ),
  bus: (
    <>
      <rect x="4.5" y="3" width="15" height="15" rx="2.5" />
      <path d="M4.5 11h15M8 3.5v7.5M16 3.5v7.5M7.5 18v2.5M16.5 18v2.5" />
      <path d="M8 14.5h.01M16 14.5h.01" />
    </>
  ),
  tricycle: (
    <>
      <circle cx="5.5" cy="17" r="2.5" />
      <circle cx="18.5" cy="17" r="2.5" />
      <path d="M5.5 17 9 10h3l1.5 4H16" />
      <path d="M9 10 8 7h2.5M12 14.5V8.5a1.5 1.5 0 0 1 1.5-1.5H19a2 2 0 0 1 2 2v5.5h-4.5" />
    </>
  ),
  rail: (
    <>
      <rect x="5.5" y="3" width="13" height="13" rx="3" />
      <path d="M5.5 9.5h13M9 13h.01M15 13h.01M9 20l1.5-4M15 20l-1.5-4M8 20h8" />
    </>
  ),
};

interface TransportIconProps {
  mode: Mode;
  className?: string;
  /** Adds an accessible name when the icon stands alone. */
  labelled?: boolean;
}

export function TransportIcon({ mode, className = 'size-5', labelled = false }: TransportIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? modeMeta[mode].label : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      {glyphs[mode]}
    </svg>
  );
}

/** Rounded badge with icon + mode name. */
export function ModeChip({ mode, compact = false }: { mode: Mode; compact?: boolean }) {
  const meta = modeMeta[mode];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.chip}`}>
      <TransportIcon mode={mode} className="size-4" />
      {compact ? meta.short : meta.label}
    </span>
  );
}
