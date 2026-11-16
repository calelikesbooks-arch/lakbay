import type { IconName } from '../ui/Icon';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Shown in the phone's bottom bar (max 5 items fit). */
  inBottomBar: boolean;
  /** Other paths that should highlight this item. */
  alsoActiveOn?: string[];
}

/** Commute search lives on Home, so /search (results) highlights Home. */
export const navItems: NavItem[] = [
  { to: '/', label: 'Home', icon: 'home', inBottomBar: true, alsoActiveOn: ['/search'] },
  { to: '/map', label: 'Map', icon: 'map', inBottomBar: true },
  { to: '/explore', label: 'Explore', icon: 'compass', inBottomBar: true },
  { to: '/saved', label: 'Saved', icon: 'bookmark', inBottomBar: true },
  { to: '/community', label: 'Community', icon: 'users', inBottomBar: true },
  { to: '/profile', label: 'Profile', icon: 'user', inBottomBar: false },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/' || (item.alsoActiveOn ?? []).some((p) => pathname.startsWith(p));
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
