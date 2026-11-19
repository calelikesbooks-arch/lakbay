# Changes: UI system (after Milestone 1)

## New dependency
- `@fontsource-variable/plus-jakarta-sans`: self-hosted open-source font (no Google Fonts request).
  Run `npm install` again after replacing the files.

## Design tokens (`src/styles/index.css`)
- Palettes: `navy-*` (structure), `brand-*` (teal: origin, verified, links), `sun-*` (warm yellow: main action, destination).
- Semantic colors that switch in dark mode: `bg-canvas`, `bg-surface`, `bg-surface-2`, `text-ink`, `text-muted`, `border-line`.
- Animations: `animate-rise`, `animate-fade`, `animate-sheet`, turned off for "reduce motion" users.
- Key text/background pairs checked against WCAG AA (≥ 4.5:1).

## Added
| File | Purpose |
| --- | --- |
| `src/types/transport.ts` | Mode, PlaceRef, Source, Verification, Leg, Itinerary, Terminal |
| `src/data/pilot.ts` | Pilot coverage area NAMES only, plus empty verified-data arrays |
| `src/data/samples.ts` | Fictional sample data, used ONLY by `/design` |
| `src/lib/modes.ts` | Labels and colors per transport mode |
| `src/lib/places.ts` | Place search (accent/case-insensitive) |
| `src/lib/localStore.ts` | Device storage hook (syncs across components and tabs) |
| `src/lib/trips.ts` | Recent searches, saved destinations, saved trips, search URLs |
| `src/lib/format.ts` | Peso, distance and date formatting |
| `src/lib/routing/itinerary.ts` | Fare totals, transfers, walking, weakest-link verification, sorting |
| `src/lib/routing/findRoutes.ts` | Route lookup over verified data only (returns "no verified route" today) |
| `src/lib/reports.ts` | Report validation + submit to Supabase, or save on device if not set up |
| `supabase/migrations/0001_community_reports.sql` | Reports table with insert-only Row Level Security |
| `components/ui/` | `Logo`, `TransportIcon` + `ModeChip`, `SegmentedControl`, `Field` (inputs) |
| `components/search/` | `SearchPanel`, `PlaceCombobox`, `QuickShortcuts`, `RecentSearches`, `SavedDestinations` |
| `components/route/` | `RouteComparison`, `RouteCard`, `LegTimeline` (instructions), `Signboard` |
| `components/evidence/` | `VerificationBadge`, `SourceList`, `EvidencePanel` |
| `components/terminal/TerminalCard.tsx` | Terminal information card |
| `components/community/` | `ReportForm`, `MyReports` |
| `components/map/MapPreviewCard.tsx` | Lightweight link card to the map |
| `src/pages/DesignSystemPage.tsx` | `/design`: every component with labeled sample data |

## Changed
- Pages: Home (search first), Search (real results states), Map (search pill + legend), Explore (terminal finder),
  Saved (saved trips + destinations), Community (report form), Profile (new styling + design link).
- Layout: header with logo and tagline, new sidebar, bottom tabs (Home, Map, Explore, Saved, Community).
- Existing UI components restyled to the new tokens; `index.html`, favicon and manifest rebranded.

## Removed
- `src/lib/features.ts` (the old "What works today" list; the Home page no longer uses it).

---

# Changes: transportation database (Supabase PostgreSQL + PostGIS)

See `docs/database.md` for install, configuration, testing and rollback.

## Added
| File | Purpose |
| --- | --- |
| `supabase/migrations/20261117000100_core_setup.sql` | Extensions, types, profiles, roles, mapper profiles, transport modes, audit log |
| `supabase/migrations/20261117000200_transport_network.sql` | Operators, sources, terminals, stops, routes, variants, ordered stops, geometries, fare rules/matrices, evidence, verification records, status guard |
| `supabase/migrations/20261117000300_community_and_user_data.sql` | Community submissions (+ moves old reports), saved destinations/trips, RPCs |
| `supabase/migrations/20261117000400_rls_policies.sql` | Grants and Row Level Security for every table |
| `supabase/migrations/20261117000500_queries_and_duplicates.sql` | Nearby queries, duplicate detection, review queue |
| `supabase/rollback/*.sql` | Rollback for each migration (run in reverse order) |
| `supabase/tests/security_test.sql` | 31 security checks, rolled back automatically |
| `docs/database.md` | Database guide |

## Changed
- `src/lib/reports.ts`: sends reports through `submit_community_report` (always pending) instead of inserting into a table.
- `supabase/migrations/0001_community_reports.sql`: header notes it is superseded (content unchanged).

---

# Changes: interactive map

See `docs/map.md` (features, providers, Nominatim policy compliance, setup).

## Added
| File | Purpose |
| --- | --- |
| `supabase/migrations/20261117000600_map_queries.sql` | `map_locations_in_bbox`, `map_location_counts`, `search_locations`, `routes_serving`, `route_variant_geojson` |
| `supabase/rollback/20261117000600_down.sql` | Rollback for migration 6 |
| `functions/api/geocode.ts` | Cloudflare Pages Function: Nominatim proxy with caching, identification and kill switch |
| `shared/geocoder.ts` | Geocoder settings shared by the proxy and the Vite dev server |
| `src/lib/geocoding.ts` | Search client: submit-only, 1.1 s pacing, 7-day device cache |
| `src/lib/map/config.ts`, `modes.ts`, `data.ts`, `useMapLocations.ts` | View bounds, mode colors, Supabase queries, visible-area loading |
| `src/lib/useGeolocation.ts` | Permission-based user location |
| `src/components/map/InteractiveMap.tsx` | MapLibre map: clustering, markers, route line, controls |
| `src/components/map/MapSearch.tsx`, `MapFilters.tsx`, `LocationControl.tsx`, `TripBar.tsx`, `LocationDetailsPanel.tsx`, `MapStatus.tsx`, `VisibleLocationsList.tsx`, `MapModeChip.tsx`, `types.ts` | Map interface pieces |
| `docs/map.md` | Map guide |

## Changed
- `src/pages/MapPage.tsx`: rebuilt as the functional map.
- `src/lib/env.ts`, `src/vite-env.d.ts`, `.env.example`: dark map style and geocoder settings.
- `vite.config.ts`, `tsconfig.node.json`: dev/preview proxy for `/api/geocode`.
- `src/styles/index.css`: map marker styles.
- `src/types/transport.ts`, `VerificationBadge.tsx`, `SourceList.tsx`, `routing/itinerary.ts`: "needs re-check" status; news/other source types.
- `supabase/tests/security_test.sql`: test 32 (map queries) and the public-function allowlist in test 31.
- `docs/database.md`: migration 6 and 32 tests.
- `package.json`: `@types/geojson`.

## Removed
- `src/components/map/BaseMap.tsx` (replaced by `InteractiveMap.tsx`).

---

# Milestone: data acquisition and import system (2026-11-21)

## Added
| File | Purpose |
| --- | --- |
| `supabase/migrations/20261120000700_data_acquisition.sql` | Source registry, import areas/runs, staging tables, review RPCs, `admin_review_queue`, primary-source rule for verification |
| `supabase/rollback/20261120000700_down.sql` | Removes all of the above |
| `pipeline/cli.ts` | `npm run pipeline -- areas / osm / csv / gtfs` |
| `pipeline/config/areas.ts` | Import areas (Marilao, Meycauayan, Bocaue on; Caloocan, QC off) |
| `pipeline/importers/osm.ts`, `survey.ts`, `gtfs.ts` | Importers |
| `pipeline/lib/*.ts` | Overpass client (rate-limited, cached), classification, validation, duplicate detection, route geometry, hashing, DB upload, reports |
| `pipeline/tests/*` | 16 offline tests with fake fixtures |
| `data/templates/survey_locations.csv` | Field survey template |
| `tsconfig.pipeline.json`, `.env.pipeline.example` | Pipeline config |
| `src/pages/AdminPage.tsx`, `src/components/admin/*` | `/admin`: sign-in, review queue, source registry, import runs |
| `src/lib/auth.ts`, `src/lib/admin/review.ts` | Staff sign-in and review actions |
| `docs/data-pipeline.md` | Guide |

## Changed
- `supabase/tests/security_test.sql`: tests 33–36 (36 total).
- `src/router.tsx`: `/admin` route. `src/pages/ProfilePage.tsx`: link to it.
- `package.json`: scripts `pipeline`, `test:pipeline`, `typecheck:pipeline`; dev deps `tsx`, `@types/node`.
- `tsconfig.app.json`, `tsconfig.node.json`: `"types": []` so Node types stay out of the app.
- `.gitignore`: `.env.pipeline`, `pipeline/cache/`, `pipeline/output/`, `data/raw/`.
- `docs/database.md`: migration 7, verification rule, 36 tests, rollback row.

## Behavior change
- Verifying a record now requires a field survey, official document or operator source.
  OSM/GTFS/community evidence alone is refused.

## Fix (2026-11-21): municipalities of imported stops
- Stops inside Meycauayan/Bocaue that were first seen as stops of a Marilao route lost their municipality. The copy that knows its area now wins.
- Stops outside the imported areas get municipality/province from OSM administrative boundaries (`pipeline/lib/boundaries.ts`, one extra cached Overpass query).
- Overpass client retries on 502/503 too (30 s, 60 s, 120 s).
- 18 pipeline tests.

---

# Milestone: field verification (2026-11-21)

## Added
| File | Purpose |
| --- | --- |
| `supabase/migrations/20261121000800_field_verification.sql` | `field_checks` log, `field_check_nearby`, `field_check_routes`, `submit_field_check` |
| `supabase/rollback/20261121000800_down.sql` | Rollback |
| `supabase/setup/all_migrations.sql` | All migrations in one file, for a new project |
| `src/pages/FieldCheckPage.tsx` (`/field`) | Places near me, Ride a route, Recent |
| `src/components/field/*` | GPS panel, place and ride forms |
| `src/components/admin/StaffGate.tsx` | Shared moderator sign-in gate |
| `src/lib/field/*` | Live GPS (fresh fixes only), field-check API |
| `docs/field-verification.md` | Guide |

## Changed
- `src/pages/AdminPage.tsx`: uses `StaffGate`; link to Field check.
- `src/router.tsx`: `/field`. `src/pages/ProfilePage.tsx`: link text.
- `supabase/migrations/20261117000100_core_setup.sql`: creates profiles for users that existed before the migration.
- `supabase/tests/security_test.sql`: tests 37–40 (40 total).
- `docs/database.md`: migration 8.
