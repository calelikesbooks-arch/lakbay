import { Link, NavLink } from 'react-router';
import { Logo } from '../ui/Logo';
import { Icon } from '../ui/Icon';
import { ThemeToggle } from './ThemeToggle';

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="flex h-16 items-center justify-between gap-3 px-4 md:px-6">
        <Link to="/" aria-label="LAKBAY home" className="rounded-xl">
          <Logo showTagline />
        </Link>
        <div className="flex items-center gap-1">
          <span className="mr-1 hidden rounded-full bg-sun-100 px-2.5 py-1 text-xs font-bold text-sun-700 lg:inline dark:bg-sun-400/15 dark:text-sun-300">
            Pilot · in development
          </span>
          <ThemeToggle />
          <NavLink
            to="/profile"
            aria-label="Profile and settings"
            className={({ isActive }) =>
              `grid size-10 place-items-center rounded-2xl md:hidden ${isActive ? 'bg-brand-100 text-brand-800 dark:bg-brand-400/15 dark:text-brand-200' : 'text-ink hover:bg-surface-2'}`
            }
          >
            <Icon name="user" className="size-5" />
          </NavLink>
        </div>
      </div>
    </header>
  );
}
