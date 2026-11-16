import { useTheme } from '../../theme/ThemeContext';
import type { ThemePreference } from '../../types';
import { Icon } from '../ui/Icon';

const next: Record<ThemePreference, ThemePreference> = { light: 'dark', dark: 'system', system: 'light' };
const labels: Record<ThemePreference, string> = { light: 'Light', dark: 'Dark', system: 'Device' };
const icons = { light: 'sun', dark: 'moon', system: 'monitor' } as const;

/** One-tap button that cycles Light → Dark → Device. */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setPreference(next[preference])}
      className="inline-flex h-10 items-center gap-2 rounded-2xl px-3 text-sm font-semibold text-ink hover:bg-surface-2"
      aria-label={`Theme: ${labels[preference]}. Tap to change.`}
      title={`Theme: ${labels[preference]}`}
    >
      <Icon name={icons[preference]} className="size-5" />
      <span className="hidden sm:inline">{labels[preference]}</span>
    </button>
  );
}
