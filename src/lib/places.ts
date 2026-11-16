import { pilotAreas, verifiedPlaces } from '../data/pilot';
import type { PlaceRef } from '../types/transport';

const allPlaces = (): PlaceRef[] => [...verifiedPlaces, ...pilotAreas];

/** Lowercase, remove accents and extra spaces, so "Cúbao " matches "cubao". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Finds places whose name or locality contains the query. Names that START with it come first. */
export function searchPlaces(query: string, limit = 6): PlaceRef[] {
  const q = normalize(query);
  const places = allPlaces();
  if (!q) return places.slice(0, limit);

  return places
    .map((place) => {
      const name = normalize(place.name);
      const locality = normalize(place.locality ?? '');
      const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : locality.includes(q) ? 2 : -1;
      return { place, score };
    })
    .filter((item) => item.score >= 0)
    .sort((a, b) => a.score - b.score || a.place.name.localeCompare(b.place.name))
    .slice(0, limit)
    .map((item) => item.place);
}

export function getPlaceById(id: string | null | undefined): PlaceRef | null {
  if (!id) return null;
  return allPlaces().find((place) => place.id === id) ?? null;
}

/** Exact name match (ignoring case/accents), for text typed without picking a suggestion. */
export function findPlaceByName(name: string): PlaceRef | null {
  const q = normalize(name);
  if (!q) return null;
  return allPlaces().find((place) => normalize(place.name) === q) ?? null;
}
