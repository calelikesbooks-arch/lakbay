import { useState } from 'react';
import { Link } from 'react-router';
import { MapPreviewCard } from '../components/map/MapPreviewCard';
import { QuickShortcuts } from '../components/search/QuickShortcuts';
import { RecentSearches } from '../components/search/RecentSearches';
import { SavedDestinations } from '../components/search/SavedDestinations';
import { SearchPanel } from '../components/search/SearchPanel';
import { VerificationBadge } from '../components/evidence/VerificationBadge';
import { SectionLabel } from '../components/ui/Card';
import { TAGLINE } from '../components/ui/Logo';
import { placeInputFrom, type TripQuery } from '../lib/trips';
import type { PlaceRef } from '../types/transport';

const emptyQuery: TripQuery = { from: placeInputFrom(null), to: placeInputFrom(null) };

export default function HomePage() {
  const [query, setQuery] = useState<TripQuery>(emptyQuery);
  const setDestination = (place: PlaceRef) => setQuery((q) => ({ ...q, to: placeInputFrom(place) }));

  return (
    <div className="space-y-7">
      {/* Hero + search: the main job of the app, first thing on screen */}
      <section aria-labelledby="home-question" className="relative overflow-hidden rounded-[1.75rem] bg-navy-900 p-5 text-white shadow-lg shadow-navy-950/10 md:p-8 dark:bg-navy-800/60 dark:ring-1 dark:ring-line">
        <RouteArt />
        <div className="relative grid gap-6 md:grid-cols-[1fr_minmax(0,26rem)] md:items-end">
          <div className="animate-rise">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-sun-300">
              <span className="size-1.5 rounded-full bg-sun-400" /> {TAGLINE}
            </p>
            <h1 id="home-question" className="mt-4 text-4xl leading-[1.05] font-extrabold tracking-tight md:text-5xl">
              Saan ang <span className="text-sun-400">punta</span> mo?
            </h1>
            <p className="mt-3 max-w-md text-[15px] text-navy-100">
              Step-by-step commute guidance from Marilao, Meycauayan and Bocaue to Metro Manila, with every route backed by sources.
            </p>
          </div>
          <div className="rounded-3xl bg-surface p-3 text-ink shadow-xl shadow-navy-950/20 animate-rise sm:p-4" style={{ animationDelay: '60ms' }}>
            <SearchPanel query={query} onQueryChange={setQuery} />
          </div>
        </div>
      </section>

      <section aria-labelledby="shortcuts-heading" className="animate-rise" style={{ animationDelay: '100ms' }}>
        <SectionLabel id="shortcuts-heading">Quick destinations</SectionLabel>
        <QuickShortcuts onPickDestination={setDestination} selectedId={query.to.place?.id} />
      </section>

      <div className="grid gap-7 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-7">
          <section aria-labelledby="saved-heading">
            <SectionLabel id="saved-heading">Saved destinations</SectionLabel>
            <SavedDestinations onPick={setDestination} />
          </section>
          <section aria-labelledby="recent-heading">
            <SectionLabel id="recent-heading">Recent searches</SectionLabel>
            <RecentSearches />
          </section>
        </div>

        <aside className="space-y-4">
          <MapPreviewCard />
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <p className="font-bold">How LAKBAY labels routes</p>
            <ul className="mt-3 space-y-2.5 text-sm">
              <li className="flex flex-col items-start gap-1">
                <VerificationBadge verification={{ level: 'verified' }} />
                <span className="text-muted">Surveyed or confirmed by an official document.</span>
              </li>
              <li className="flex flex-col items-start gap-1">
                <VerificationBadge verification={{ level: 'partial' }} />
                <span className="text-muted">Some steps confirmed; others still being checked.</span>
              </li>
              <li className="flex flex-col items-start gap-1">
                <VerificationBadge verification={{ level: 'unverified' }} />
                <span className="text-muted">Not confirmed. Never shown as a recommended route.</span>
              </li>
            </ul>
          </div>
          <div className="rounded-[var(--radius-card)] border border-sun-300 bg-sun-50 p-4 text-sm dark:border-sun-500/30 dark:bg-sun-400/5">
            <p className="font-bold text-ink">Early development build</p>
            <p className="mt-1 text-muted">
              No routes have been verified yet, so searches will not return directions. Know a route?{' '}
              <Link to="/community" className="font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">
                Tell us
              </Link>
              .
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Decorative dashed route lines behind the hero text. */
function RouteArt() {
  return (
    <svg viewBox="0 0 400 240" className="pointer-events-none absolute -top-6 -right-16 h-72 w-[30rem] opacity-60" aria-hidden="true">
      <path d="M10 220 C 120 200, 140 120, 230 110 S 360 40, 390 10" fill="none" stroke="#2a395e" strokeWidth="18" strokeLinecap="round" />
      <path d="M10 220 C 120 200, 140 120, 230 110 S 360 40, 390 10" fill="none" stroke="#f9c440" strokeWidth="3" strokeDasharray="8 9" strokeLinecap="round" />
      <path d="M60 240 C 140 170, 250 190, 300 120" fill="none" stroke="#3fb6a2" strokeWidth="2.5" strokeDasharray="2 8" strokeLinecap="round" />
      <circle cx="230" cy="110" r="6" fill="#3fb6a2" />
      <circle cx="390" cy="10" r="8" fill="#f9c440" />
    </svg>
  );
}
