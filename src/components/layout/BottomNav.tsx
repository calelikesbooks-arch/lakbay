import { Link, useLocation } from 'react-router';
import { Icon } from '../ui/Icon';
import { isNavItemActive, navItems } from './navItems';

/** Bottom tab bar for phones (hidden on wider screens). */
export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="grid grid-cols-5">
        {navItems
          .filter((item) => item.inBottomBar)
          .map((item) => {
            const active = isNavItemActive(item, pathname);
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                    active ? 'text-ink' : 'text-muted'
                  }`}
                >
                  <span
                    className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${
                      active ? 'bg-sun-400 text-navy-950' : ''
                    }`}
                  >
                    <Icon name={item.icon} className="size-5" />
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
      </ul>
    </nav>
  );
}
