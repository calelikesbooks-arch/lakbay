import type { PlaceKind, PlaceRef } from '../types/transport';
import { createLocalStore } from './localStore';

/**
 * Recent searches, saved destinations and saved trips.
 * All stored ONLY on this device (localStorage). No account needed.
 */

/** What the user picked or typed in a search box. `place` is null for free text. */
export interface PlaceInput {
  text: string;
  place: PlaceRef | null;
}

export interface TripQuery {
  from: PlaceInput;
  to: PlaceInput;
}

export interface RecentSearch extends TripQuery {
  id: string;
  searchedAt: string;
}

export interface SavedTrip extends TripQuery {
  id: string;
  savedAt: string;
}

const MAX_RECENT = 8;
const kinds: PlaceKind[] = ['area', 'landmark', 'terminal', 'stop'];

function isPlaceRef(value: unknown): value is PlaceRef {
  const v = value as PlaceRef;
  return !!v && typeof v.id === 'string' && typeof v.name === 'string' && kinds.includes(v.kind);
}

function isPlaceInput(value: unknown): value is PlaceInput {
  const v = value as PlaceInput;
  return !!v && typeof v.text === 'string' && (v.place === null || isPlaceRef(v.place));
}

function isTripQuery(value: unknown): value is TripQuery {
  const v = value as TripQuery;
  return !!v && isPlaceInput(v.from) && isPlaceInput(v.to);
}

const isRecentList = (value: unknown): value is RecentSearch[] =>
  Array.isArray(value) && value.every((v) => isTripQuery(v) && typeof (v as RecentSearch).id === 'string');
const isSavedTripList = (value: unknown): value is SavedTrip[] =>
  Array.isArray(value) && value.every((v) => isTripQuery(v) && typeof (v as SavedTrip).id === 'string');
const isPlaceList = (value: unknown): value is PlaceRef[] => Array.isArray(value) && value.every(isPlaceRef);

export const recentSearchesStore = createLocalStore<RecentSearch[]>('lakbay-recent-searches', [], isRecentList);
export const savedPlacesStore = createLocalStore<PlaceRef[]>('lakbay-saved-places', [], isPlaceList);
export const savedTripsStore = createLocalStore<SavedTrip[]>('lakbay-saved-trips', [], isSavedTripList);

/** Stable key for a place input: its id when known, else its normalized text. */
export function placeKey(input: PlaceInput): string {
  return input.place ? input.place.id : `text:${input.text.trim().toLowerCase()}`;
}

export function tripKey(query: TripQuery): string {
  return `${placeKey(query.from)}→${placeKey(query.to)}`;
}

/**
 * Random id. crypto.randomUUID only exists on https:// and localhost, so we
 * fall back when testing on a phone over the local network (http://192.168…).
 */
export function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function addRecentSearch(query: TripQuery) {
  const key = tripKey(query);
  recentSearchesStore.set((list) =>
    [{ ...query, id: newId(), searchedAt: new Date().toISOString() }, ...list.filter((item) => tripKey(item) !== key)].slice(
      0,
      MAX_RECENT,
    ),
  );
}

export function removeRecentSearch(id: string) {
  recentSearchesStore.set((list) => list.filter((item) => item.id !== id));
}

export function clearRecentSearches() {
  recentSearchesStore.set([]);
}

export function isPlaceSaved(list: PlaceRef[], placeId: string): boolean {
  return list.some((place) => place.id === placeId);
}

export function toggleSavedPlace(place: PlaceRef) {
  savedPlacesStore.set((list) =>
    isPlaceSaved(list, place.id) ? list.filter((p) => p.id !== place.id) : [place, ...list],
  );
}

export function isTripSaved(list: SavedTrip[], query: TripQuery): boolean {
  const key = tripKey(query);
  return list.some((trip) => tripKey(trip) === key);
}

export function toggleSavedTrip(query: TripQuery) {
  const key = tripKey(query);
  savedTripsStore.set((list) =>
    list.some((trip) => tripKey(trip) === key)
      ? list.filter((trip) => tripKey(trip) !== key)
      : [{ ...query, id: newId(), savedAt: new Date().toISOString() }, ...list],
  );
}

/** Builds the /search URL for a trip. Known places use ids, free text uses text. */
export function searchUrl(query: TripQuery): string {
  const params = new URLSearchParams();
  params.set(query.from.place ? 'fromId' : 'from', query.from.place ? query.from.place.id : query.from.text.trim());
  params.set(query.to.place ? 'toId' : 'to', query.to.place ? query.to.place.id : query.to.text.trim());
  return `/search?${params.toString()}`;
}

export function placeInputFrom(place: PlaceRef | null, text = ''): PlaceInput {
  return place ? { text: place.name, place } : { text, place: null };
}
