import { createContext, useContext } from 'react';
import type { ResolvedTheme, ThemePreference } from '../types';

export interface ThemeContextValue {
  /** What the user chose: light, dark or follow the device. */
  preference: ThemePreference;
  /** What is actually shown right now. */
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return value;
}
