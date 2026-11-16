# LAKBAY interactive map

## What it does

| Feature | How |
| --- | --- |
| Base map | MapLibre GL JS + OpenFreeMap vector tiles (OpenStreetMap data). Light "liberty" style; "dark" style in dark mode (falls back to light if unavailable). |
| Default view | Bulacan pilot area down to Cubao. "Pilot area" button returns there. Panning is limited to the Philippines. |
| Terminals and stops | Loaded from Supabase/PostGIS for the visible area only (`map_locations_in_bbox`). Verified records only for the public (RLS). |
| Clustering | MapLibre's built-in GeoJSON clustering. Tap a cluster to zoom in. |
| Filters | Terminals / Stops toggles and transport mode chips (from `transport_modes`). |
| Details | Tap a marker (or a list item): info, verification, routes serving it, sources. |
| Route lines | "Show route" draws the current verified geometry of a route variant (`route_variant_geojson`). |
| Search | LAKBAY's own terminals/stops (`search_locations`) + addresses, landmarks, barangays, cities and municipalities from OpenStreetMap (Nominatim). |
| Trip ends | "Start" / "Go here" place origin and destination markers; "Plan trip" opens commute search. |
| My location | Only after a tap, an explanation, and the browser's permission prompt. Never saved or sent by the map. |
| Empty states | Not connected, no verified locations yet, none in this area, none match filters, zoom in. Nothing is invented. |
| Accessibility | "On the map" list mirrors the markers for keyboard and screen-reader users. |

## Loading efficiently

- Requests start 350 ms after the map stops moving.
- A box 30% larger than the screen is loaded; panning inside it makes no new request.
- Outdated requests are cancelled.
- Nothing is loaded below zoom 11. The database refuses areas over 1 square degree and returns at most 600 rows.
- The PostGIS query uses the GiST indexes on `terminals.location` and `stops.location`.

## Providers, licenses and limits

### Map tiles: OpenFreeMap
- Free, no API key. Attribution is required; MapLibre shows it automatically from the style
  ("OpenFreeMap © OpenMapTiles Data from OpenStreetMap"). Do not hide the attribution control.
- Provided as-is with no uptime guarantee. If it ever becomes unsuitable, set `VITE_MAP_STYLE_URL`
  (and `VITE_MAP_STYLE_URL_DARK`) to another MapLibre style, e.g. self-hosted PMTiles on Cloudflare R2.
- LAKBAY never pre-downloads or bulk-caches tiles; the browser caches them per the server's headers.

### Place search: Nominatim (OpenStreetMap Foundation)
**Read the usage policy:** https://operations.osmfoundation.org/policies/nominatim/

The public server is a shared, free resource with strict rules. How LAKBAY follows them:

| Rule | LAKBAY |
| --- | --- |
| Absolute maximum 1 request/second (all users combined) | Browser waits 1.1 s between searches; the proxy spaces calls 1.1 s apart per server instance and serves repeats from cache. |
| No autocomplete | Search runs only when the user presses **Search**. Do not add search-as-you-type. |
| Identify the application | The proxy sends `User-Agent: LAKBAY-commuting-app/0.4 (<GEOCODER_CONTACT>)` and the site as `Referer`. |
| Cache results | 7 days at Cloudflare's edge + 7 days on the device. |
| Attribution | "Place search by Nominatim · Data © OpenStreetMap contributors" under every result list. |
| Must be switchable off without a software update | Set `GEOCODER_ENABLED=false` in Cloudflare Pages settings. Takes effect immediately; the app falls back to LAKBAY's own search. |
| No bulk / periodic geocoding | Only user-initiated searches. Never geocode lists of places with this service. |

If LAKBAY grows beyond "moderate" use, move to a self-hosted Nominatim or a commercial
OpenStreetMap geocoder and set `GEOCODER_UPSTREAM` (proxy) accordingly.

Places found through OpenStreetMap are only used to position the map and trip ends. They are
**never** saved as LAKBAY terminals, stops or routes.

## Setup

1. Run the new database migration in Supabase SQL Editor:
   `supabase/migrations/20261117000600_map_queries.sql`
2. Run `supabase/tests/security_test.sql` → **ALL 32 SECURITY TESTS PASSED**.
3. `npm install` (adds `@types/geojson`), then `npm run dev`.
4. Before deploying to Cloudflare Pages, set these **Environment variables** in the Pages project
   (Settings → Environment variables, for Production and Preview):
   - `GEOCODER_CONTACT` = your project URL or a contact email (identifies LAKBAY to Nominatim)
   - `GEOCODER_ENABLED` = `true` (set to `false` to switch search off instantly)
   These are server-side only and are not visible in the website.

Local development uses the Vite proxy in `vite.config.ts` instead of the Cloudflare function.

## Why the map is empty right now

LAKBAY shows only verified terminals and stops. Until surveyed records are entered and verified,
the map correctly shows **"No verified locations yet"**. Do not add test markers to the real
database to "see something": every public marker must be real and sourced.
