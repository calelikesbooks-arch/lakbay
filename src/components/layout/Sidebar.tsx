import { Link, useLocation } from 'react-router';
import { Icon } from '../ui/Icon';
import { TAGLINE } from '../ui/Logo';
import { isNavItemActive, navItems } from './navItems';

/** Left menu for tablets and desktops (hidden on phones). */
export function Sidebar() {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Main"
      className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 flex-col border-r border-line p-3 md:flex"
    >
      <ul className="space-y-1">
        {navItems.map((item) => {
          const active = isNavItemActive(item, pathname);
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={`relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                  active ? 'bg-navy-900 text-white dark:bg-surface-2' : 'text-muted hover:bg-surface-2 hover:text-ink'
                }`}
              >
                <Icon name={item.icon} className={active ? 'size-5 text-sun-400' : 'size-5'} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto rounded-2xl bg-surface-2 p-3">
        <p className="text-sm font-bold text-ink">{TAGLINE}</p>
        <p className="mt-1 text-xs text-muted">Every route in LAKBAY must cite its sources.</p>
      </div>
    </nav>
  );
}
