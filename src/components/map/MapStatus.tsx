import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { LocationsStatus } from '../../lib/map/useMapLocations';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';

interface MapStatusProps {
  status: LocationsStatus;
  /** Total visible to this user in the whole database (null = unknown). */
  totals: { terminals: number; stops: number } | null;
  /** How many are shown after filters, in the loaded area. */
  shownCount: number;
  loadedCount: number;
  onRetry: () => void;
}

/** Small status line on top of the map, or a clear empty state card. */
export function MapStatus({ status, totals, shownCount, loadedCount, onRetry }: MapStatusProps) {
  const pill = 'pointer-events-auto inline-flex items-center gap-2 rounded-full border border-line bg-surface/95 px-3 py-1.5 text-xs font-semibold text-ink shadow-md backdrop-blur';

  if (status === 'not_configured') {
    return (
      <EmptyCard title="Map data is not connected">
        The base map works, but LAKBAY's database isn't set up in this copy of the app, so no terminals or stops can be shown.
      </EmptyCard>
    );
  }

  if (totals && totals.terminals + totals.stops === 0) {
    return (
      <EmptyCard title="No verified locations yet">
        LAKBAY shows a terminal or stop only after it has been surveyed and verified with sources. None are verified yet, so the map is empty on purpose.{' '}
        <Link to="/community" className="pointer-events-auto font-semibold text-brand-700 underline dark:text-brand-300">
          Know a terminal? Tell us.
        </Link>
      </EmptyCard>
    );
  }

  if (status === 'loading') {
    return (
      <span role="status" className={pill}>
        <Spinner className="size-3.5" /> Loading verified locations…
      </span>
    );
  }
  if (status === 'zoom_in') {
    return (
      <span role="status" className={pill}>
        <Icon name="search" className="size-3.5" /> Zoom in to see terminals and stops
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span role="alert" className={pill}>
        <Icon name="alert" className="size-3.5 text-red-600" /> Couldn't load locations.
        <button type="button" onClick={onRetry} className="underline">
          Retry
        </button>
      </span>
    );
  }
  if (loadedCount === 0) {
    return (
      <span role="status" className={pill}>
        <Icon name="info" className="size-3.5" /> No verified locations in this area
      </span>
    );
  }
  if (shownCount === 0) {
    return (
      <span role="status" className={pill}>
        <Icon name="info" className="size-3.5" /> No locations match your filters
      </span>
    );
  }
  return (
    <span role="status" className={pill}>
      <Icon name="shieldCheck" className="size-3.5 text-brand-600" /> {shownCount} verified {shownCount === 1 ? 'location' : 'locations'} here
    </span>
  );
}

function EmptyCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="status" className="pointer-events-auto max-w-sm rounded-2xl border border-line bg-surface/95 p-4 shadow-lg backdrop-blur">
      <p className="flex items-center gap-2 font-bold">
        <Icon name="info" className="size-5 text-sun-600" /> {title}
      </p>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </div>
  );
}
