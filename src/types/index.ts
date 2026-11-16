/**
 * Shared TypeScript types.
 * The transport data types (Place, Stop, Route, FareRule, Source) come in the
 * next milestone, after the data dictionary is written in docs/.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Generic shape for anything that loads asynchronously. */
export type LoadState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string };
