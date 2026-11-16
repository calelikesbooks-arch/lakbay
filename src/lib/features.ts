/**
 * Honest list of what works today and what is still a placeholder.
 * The Home page reads this list, so update it whenever a feature ships.
 */
export type FeatureStatus = 'available' | 'placeholder';

export interface Feature {
  id: string;
  name: string;
  description: string;
  status: FeatureStatus;
  /** When it is planned, in the words of the roadmap. */
  phase: string;
  /** Page where the feature lives, if any. */
  to?: string;
}

export const features: Feature[] = [
  {
    id: 'shell',
    name: 'App shell and navigation',
    description: 'Pages, menus and layout for phone and desktop.',
    status: 'available',
    phase: 'Milestone 1',
  },
  {
    id: 'theme',
    name: 'Light and dark theme',
    description: 'Follows your device, or choose one on the Profile page.',
    status: 'available',
    phase: 'Milestone 1',
    to: '/profile',
  },
  {
    id: 'basemap',
    name: 'Base map',
    description: 'A pannable map of the pilot area. No routes or stops on it yet.',
    status: 'available',
    phase: 'Milestone 1',
    to: '/map',
  },
  {
    id: 'search',
    name: 'Commute search',
    description: 'Step-by-step directions with modes, transfers and walking.',
    status: 'placeholder',
    phase: 'Phase 1: needs verified route data and the routing engine',
    to: '/search',
  },
  {
    id: 'fares',
    name: 'Fare estimates',
    description: 'Estimated fares based on official fare rules.',
    status: 'placeholder',
    phase: 'Phase 1: needs the verified LTFRB fare circular',
  },
  {
    id: 'explore',
    name: 'Terminal finder, fare calculator, rail info',
    description: 'Tools for planning beyond a single trip.',
    status: 'placeholder',
    phase: 'Phase 4',
    to: '/explore',
  },
  {
    id: 'saved',
    name: 'Saved trips',
    description: 'Keep routes you use often.',
    status: 'placeholder',
    phase: 'After commute search works',
    to: '/saved',
  },
  {
    id: 'community',
    name: 'Community reports and mappers',
    description: 'Report changes and help verify routes.',
    status: 'placeholder',
    phase: 'Phase 3',
    to: '/community',
  },
];
