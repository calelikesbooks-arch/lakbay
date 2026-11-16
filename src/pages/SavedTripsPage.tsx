import { useNavigate } from 'react-router';
import { SavedDestinations } from '../components/search/SavedDestinations';
import { SectionLabel } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { PageHeader } from '../components/ui/PageHeader';
import { formatDate } from '../lib/format';
import { useLocalStore } from '../lib/localStore';
import { savedTripsStore, searchUrl, toggleSavedTrip } from '../lib/trips';
import type { PlaceRef } from '../types/transport';

export default function SavedTripsPage() {
  const navigate = useNavigate();
  const trips = useLocalStore(savedTripsStore);

  // Tapping a saved destination opens the search form with it filled in
  // (no starting point yet, so the search page asks for one).
  const searchTo = (place: PlaceRef) => navigate(`/search?toId=${encodeURIComponent(place.id)}`);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Naka-save"
        title="Saved"
        description="Trips and destinations you saved. Stored only on this device; clearing your browser data removes them."
      />

      <section aria-labelledby="saved-trips-heading">
        <SectionLabel id="saved-trips-heading">Saved trips</SectionLabel>
        {trips.length === 0 ? (
          <EmptyState icon="bookmark" title="No saved trips">
            Search for a trip, then tap the bookmark icon to keep it here.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {trips.map((trip) => (
              <li key={trip.id} className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface pr-2">
                <button
                  type="button"
                  onClick={() => navigate(searchUrl(trip))}
                  className="flex min-w-0 flex-1 items-center gap-3 p-4 text-left"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-navy-900 text-sun-400 dark:bg-surface-2">
                    <Icon name="route" className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-bold">
                      {trip.from.text} → {trip.to.text}
                    </span>
                    <span className="block text-xs text-muted">Saved {formatDate(trip.savedAt)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => toggleSavedTrip(trip)}
                  aria-label={`Remove saved trip ${trip.from.text} to ${trip.to.text}`}
                  className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface-2"
                >
                  <Icon name="trash" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="saved-places-heading">
        <SectionLabel id="saved-places-heading">Saved destinations</SectionLabel>
        <SavedDestinations onPick={searchTo} allowRemove />
      </section>
    </div>
  );
}
