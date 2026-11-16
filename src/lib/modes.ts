import type { Mode } from '../types/transport';

/**
 * Display details for each transport mode, used by icons, badges and
 * the route timeline. One place to change a mode's name or color.
 * `chip` = soft badge style, `line` = color of the timeline segment.
 */
export const modeMeta: Record<Mode, { label: string; short: string; chip: string; line: string; dot: string }> = {
  walk: {
    label: 'Walk',
    short: 'Lakad',
    chip: 'bg-surface-2 text-muted',
    line: 'border-line border-dashed',
    dot: 'bg-navy-300 dark:bg-navy-500',
  },
  jeepney: {
    label: 'Jeepney',
    short: 'Jeep',
    chip: 'bg-sun-100 text-sun-700 dark:bg-sun-500/15 dark:text-sun-300',
    line: 'border-sun-400',
    dot: 'bg-sun-400',
  },
  modern_jeepney: {
    label: 'Modern jeepney',
    short: 'Modern jeep',
    chip: 'bg-brand-100 text-brand-800 dark:bg-brand-400/15 dark:text-brand-200',
    line: 'border-brand-400',
    dot: 'bg-brand-400',
  },
  uv_express: {
    label: 'UV Express',
    short: 'UV',
    chip: 'bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-200',
    line: 'border-violet-400',
    dot: 'bg-violet-400',
  },
  bus: {
    label: 'Bus',
    short: 'Bus',
    chip: 'bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200',
    line: 'border-sky-500',
    dot: 'bg-sky-500',
  },
  tricycle: {
    label: 'Tricycle',
    short: 'Trike',
    chip: 'bg-orange-100 text-orange-800 dark:bg-orange-400/15 dark:text-orange-200',
    line: 'border-orange-400',
    dot: 'bg-orange-400',
  },
  rail: {
    label: 'Train',
    short: 'Tren',
    chip: 'bg-rose-100 text-rose-800 dark:bg-rose-400/15 dark:text-rose-200',
    line: 'border-rose-500',
    dot: 'bg-rose-500',
  },
};

export const allModes = Object.keys(modeMeta) as Mode[];
