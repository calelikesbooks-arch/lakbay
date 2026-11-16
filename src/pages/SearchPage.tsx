import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { RouteComparison } from '../components/route/RouteComparison';
import { SearchPanel } from '../components/search/SearchPanel';
import { Button, LinkButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { Spinner } from '../components/ui/Spinner';
import { findPlaceByName, getPlaceById } from '../lib/places';
import { findRoutes, type RouteSearchResult } from '../lib/routing/findRoutes';
import { useLocalStore } from '../lib/localStore';
import { isTripSaved, placeInputFrom, savedTripsStore, toggleSavedTrip, type PlaceInput, type TripQuery } from '../lib/trips';
import type { LoadState } from '../types';

/** Reads ?fromId= / ?from= (and the same for "to") from the URL. */
function inputFromParams(params: URLSearchParams, key: 'from' | 'to'): PlaceInput {
  const byId = getPlaceById(params.get(`${key}Id`));
  if (byId) return placeInputFrom(byId);
  const text = (params.get(key) ?? '').trim();
  return placeInputFrom(findPlaceByName(text), text);
}

export default function SearchPage() {
  const [params] = useSearchParams();
  const paramKey = params.toString();
  const urlQuery = useMemo<TripQuery>(
    // Recompute only when the URL text changes (params is a new object every render).
    () => ({ from: inputFromParams(params, 'from'), to: inputFromParams(params, 'to') }),
    [paramKey],
  );

  const [query, setQuery] = useState<TripQuery>(urlQuery);
  const [result, setResult] = useState<LoadState<RouteSearchResult>>({ status: 'idle' });
  const [editing, setEditing] = useState(false);
  const savedTrips = useLocalStore(savedTripsStore);
  const hasTrip = !!urlQuery.from.text && !!urlQuery.to.text;

  // Run the search whenever the URL changes (new search, back button, shared link).
  useEffect(() => {
    setQuery(urlQuery);
    setEditing(false);
    if (!hasTrip) {
      setResult({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setResult({ status: 'loading' });
    findRoutes(urlQuery.from.place, urlQuery.to.place)
      .then((data) => !cancelled && setResult({ status: 'success', data }))
      .catch(() => !cancelled && setResult({ status: 'error', message: 'The route search failed. Please try again.' }));
    return () => {
      cancelled = true;
    };
  }, [urlQuery, hasTrip]);

  if (!hasTrip || editing) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-2xl font-extrabold tracking-tight">Saan ang punta mo?</h1>
        <div className="rounded-3xl border border-line bg-surface p-3 sm:p-4">
          <SearchPanel query={query} onQueryChange={setQuery} onSubmitted={() => setEditing(false)} />
        </div>
        {editing && (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
    );
  }

  const saved = isTripSaved(savedTrips, urlQuery);
  const reportAbout = `${urlQuery.from.text} to ${urlQuery.to.text}`;

  return (
    <div className="space-y-5">
      {/* Trip summary bar */}
      <section className="rounded-3xl border border-line bg-surface p-4 animate-rise">
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center pt-1.5" aria-hidden="true">
            <span className="size-3 rounded-full border-[3px] border-brand-500" />
            <span className="my-1 h-6 border-l-2 border-dashed border-line" />
            <Icon name="pin" className="size-4 text-sun-500" />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <p className="truncate">
              <span className="sr-only">From </span>
              <span className="font-bold">{urlQuery.from.text}</span>
            </p>
            <p className="truncate">
              <span className="sr-only">To </span>
              <span className="font-bold">{urlQuery.to.text}</span>
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => toggleSavedTrip(urlQuery)}
              aria-pressed={saved}
              aria-label={saved ? 'Remove from saved trips' : 'Save this trip'}
              className="grid size-10 place-items-center rounded-2xl hover:bg-surface-2"
            >
              <Icon name="bookmark" className={`size-5 ${saved ? 'fill-sun-400 text-sun-500' : 'text-muted'}`} />
            </button>
            <Button variant="secondary" size="sm" className="h-10" onClick={() => setEditing(true)}>
              Change
            </Button>
          </div>
        </div>
      </section>

      <Results result={result} reportAbout={reportAbout} />
    </div>
  );
}

function Results({ result, reportAbout }: { result: LoadState<RouteSearchResult>; reportAbout: string }) {
  if (result.status === 'idle' || result.status === 'loading') {
    return (
      <div role="status" className="flex items-center justify-center gap-3 py-12 text-muted">
        <Spinner /> Hinahanap ang ruta… Searching verified routes
      </div>
    );
  }
  if (result.status === 'error') {
    return (
      <EmptyState icon="alert" title="Search failed">
        {result.message}
      </EmptyState>
    );
  }

  const data = result.data;
  const reportLink = `/community?about=${encodeURIComponent(reportAbout)}`;

  switch (data.status) {
    case 'ok':
      return <RouteComparison itineraries={data.itineraries} />;
    case 'same_place':
      return (
        <EmptyState icon="info" title="Same start and destination">
          Choose two different places.
        </EmptyState>
      );
    case 'unknown_place':
      return (
        <EmptyState icon="pin" title="LAKBAY doesn't know this place yet">
          <p>
            {data.which.length === 2 ? 'Both places are' : data.which[0] === 'from' ? 'The starting point is' : 'The destination is'} not in
            LAKBAY's list. Tap <strong>Change</strong> and pick a suggestion from the list.
          </p>
        </EmptyState>
      );
    case 'no_verified_route':
      return (
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-6 py-9 text-center animate-rise">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-sun-100 text-sun-700 dark:bg-sun-400/15 dark:text-sun-300">
            <Icon name="route" className="size-7" />
          </span>
          <h2 className="mt-3 text-lg font-bold">Wala pang beripikadong ruta</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            No verified route for this trip yet. LAKBAY only shows directions that have been surveyed and cited, so it
            won't guess. Save the trip and check back, or tell us how you commute it.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <LinkButton to={reportLink} variant="navy">
              <Icon name="send" className="size-4" /> I know this route
            </LinkButton>
            <LinkButton to="/map" variant="secondary">
              <Icon name="map" className="size-4" /> Open map
            </LinkButton>
          </div>
        </div>
      );
  }
}
