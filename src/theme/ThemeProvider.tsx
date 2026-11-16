import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { storage } from '../lib/storage';
import type { ResolvedTheme, ThemePreference } from '../types';
import { ThemeContext } from './ThemeContext';

// Same key as the small script in index.html.
const STORAGE_KEY = 'lakbay-theme';
const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#f5f7fb', dark: '#0b1122' };

function readPreference(): ThemePreference {
  const saved = storage.get(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  // Follow the device setting when it changes (e.g. phone switches to night mode).
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme = preference === 'system' ? system : preference;

  // Apply the theme to the <html> element so Tailwind's dark: classes work.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolved]);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    storage.set(STORAGE_KEY, next);
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
