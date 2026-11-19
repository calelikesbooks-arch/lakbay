# LAKBAY data acquisition and import pipeline

This system brings transport data from legal sources into LAKBAY **without
ever publishing it automatically**. Every import lands in a staging area,
a moderator reviews it, and only a primary source (field survey, official
document or operator) can make a record `verified`.

```
 source ──▶ pipeline (your computer) ──▶ staged_features ──▶ /admin review ──▶ DRAFT record ──▶ verification ──▶ public
            classify, validate,          (unverified,         promote / link /    (not public)    needs a field survey,
            dedupe, hash, cite           moderators only)     reject / needs info                 official doc or operator
```

## 1. The rules this system enforces

| Rule | Where it is enforced |
| --- | --- |
| Imports are unverified | Staged rows are only visible to moderators. Promoting creates a **draft**, never a verified record. |
| A mapped road is not a transit route | `osmClassify.ts` only reads `type=route` relations with a transit `route=` value. Ways tagged `highway=*` are never turned into routes. Every route gets the `route_unconfirmed` warning. |
| Mapped ≠ running | OSM, GTFS and community sources **cannot** verify (database check, test 35). |
| Never invent coordinates | Missing or impossible coordinates block a candidate. Out-of-country points are not stored as a location (only kept as a note). Points outside the imported areas get their municipality from the official OSM boundaries (point-in-polygon, Bulacan–Metro Manila corridor only), recorded in `attributes.municipality_source`; if no single boundary contains them, the reviewer must type it. Names are never used to guess a town. |
| Never invent route connections | Route lines with gaps are **not** stored (`routeGeometry.ts` never bridges gaps). Route stops are linked only if the reviewer already promoted/linked them. |
| Never invent fares or schedules | The pipeline has no fare or schedule importer. Fares stay manual with official sources. |
| Attribution | Every staged row keeps `provider_code`, `external_id`, `external_url`; promotion creates a `sources` row with the provider's attribution text and an `evidence` row. |
| Licenses | `data_providers.usage_status`: the database refuses to start a run for a provider that is not `approved`. |
| Rate limits | Overpass: one query at a time, ≥10 s apart, 24-hour local cache, backoff on 429/504, identifying User-Agent. |

## 2. Source registry (researched November 2026)

| Code | Source | Status | Can verify? | Notes |
| --- | --- | --- | --- | --- |
| `openstreetmap_overpass` | OpenStreetMap via Overpass API | approved | no | ODbL 1.0. Credit "© OpenStreetMap contributors". Keep source links (share-alike). |
| `lakbay_field_survey` | Your own surveys (CSV) | approved | **yes** | The main way to verify. |
| `ltfrb_issuances` | LTFRB memorandum circulars / route rationalization documents | approved (manual) | **yes** | Enter as CSV rows with the document URL. Check the date: old franchises may not run any more. |
| `lgu_records` | Municipal ordinances / tricycle route plans (Marilao, Meycauayan, Bocaue) | approved (manual) | **yes** | Ask the municipal office; cite the ordinance number. |
| `rail_operators` | LRMC, LRTA, DOTr/PNR official pages | approved (manual) | **yes** | Stations and official notices only. |
| `psa_psgc` | PSA Philippine Standard Geographic Code | approved | no | Names/codes of municipalities. |
| `dotc_ptis_gtfs` | DOTC PTIS GTFS (2015, Metro Manila) | **pending review** | no | License unclear; Metro Manila only; old. Enable only after reading its LICENSE. |
| `sakay_ph` | Sakay.ph | **rejected** | no | Proprietary. Do not scrape. |
| `google_maps` | Google Maps | **rejected** | no | Terms forbid copying data into another database. |

To approve or reject a provider, an admin updates `data_providers.usage_status`
in the Supabase Table editor and writes the reason in `usage_notes`.

### How Philippine transit is tagged in OSM (what the importer reads)

- Jeepney, UV Express and bus routes: relations `type=route` + `route=bus`
  (or `share_taxi`, `minibus`, `train`, `subway`, `light_rail`, `tram`,
  `ferry`). The mode comes from tags like `bus=jeepney` or the name, and is
  only a **hint**: the reviewer chooses the mode.
- Stops: `highway=bus_stop`, `public_transport=platform/stop_position`,
  `share_taxi=yes`.
- Terminals: `amenity=bus_station`, `public_transport=station`,
  `railway=station`, and tricycle terminals `amenity=taxi` +
  `taxi_vehicle=auto_rickshaw`.

Expect **few** routes in Bulacan. Most jeepney lines are not mapped. That is
normal: the survey CSV is how real coverage grows.

## 3. One-time setup (Windows, in VS Code's terminal)

1. Run the migration `supabase/migrations/20261120000700_data_acquisition.sql`
   in the Supabase SQL Editor (see `docs/database.md`), then the security test.
   Expected: **ALL 36 SECURITY TESTS PASSED**.
2. `npm install` (adds `tsx` and `@types/node`).
3. Create a **separate** Supabase user for the pipeline (Authentication →
   Users → Add user, with "Auto Confirm"). Give it the moderator role in the
   SQL Editor:
   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'moderator' from auth.users where email = 'pipeline@your-email.com';
   ```
   Expected: `INSERT 0 1`. (`INSERT 0 0` means the email is wrong.)
4. Copy `.env.pipeline.example` to `.env.pipeline` and fill it in. Use the
   **anon** key. Never the service_role key: the pipeline refuses to run with it.
   `PIPELINE_CONTACT` must be a real email or URL; Overpass asks for it.
5. `.env.pipeline` is in `.gitignore`. It stays on the computer you run
   imports from. You only need it on one computer (laptop **or** PC).

## 4. Commands

```bash
npm run test:pipeline                     # offline tests (fake data), 18 tests
npm run typecheck:pipeline                # type check

npm run pipeline -- areas                 # list import areas
npm run pipeline -- osm --dry-run         # fetch OSM for the default areas, write a report, upload nothing
npm run pipeline -- osm                   # same, and upload to staging
npm run pipeline -- osm --area marilao    # one area
npm run pipeline -- osm --refresh         # ignore the 24 h cache (be polite: rarely)

npm run pipeline -- csv --file data/raw/survey_2026-12.csv --dry-run
npm run pipeline -- csv --file data/raw/survey_2026-12.csv

npm run pipeline -- gtfs --provider dotc_ptis_gtfs --dir data/raw/gtfs --bbox 120.9,14.6,121.1,14.9 --dry-run
```

If Overpass says it is busy (HTTP 429/502/503/504), the pipeline waits
30 s, 60 s, then 120 s and gives up after 4 tries. Try again later, or use
another public server from the OSM wiki list "Public Overpass API instances",
e.g. in `.env.pipeline`: `OVERPASS_URL=https://overpass.private.coffee/api/interpreter`.

Every run writes a report to `pipeline/output/` (`.md` to read, `.json` for
details): counts, blockers, warnings, duplicates.

## 5. Review in the app

1. Open `/admin` (Profile → "Data review"). Sign in with a **moderator or
   admin** account (your own account, not necessarily the pipeline one).
2. Filter by kind and quality. For each candidate:
   - **Promote as draft**: creates a draft terminal/stop/route, cites the import as
     evidence. Stops/terminals need a municipality and province; routes need
     you to pick the mode and direction.
   - **Same place: link and cite**: when LAKBAY already has the place.
   - **Needs info**: you need a survey first. Write what is missing.
   - **Reject**: not real, a duplicate, or not public transport. A reason is required.
3. Promote route **stops first**, then the route, so its stops get linked.
4. Drafts become public only after a verification with a primary source
   (field survey, official document, operator), recorded as usual.

Re-running an import is safe: unchanged rows are skipped (content hash);
rows changed upstream after review come back with "Changed upstream after
review"; rows that disappeared from OSM get "No longer in the source".

## 6. Field survey CSV

Template: `data/templates/survey_locations.csv`. Rows whose `record_id`
starts with `EXAMPLE` are always refused. Required per row: record_id,
kind, classification, name, lat, lon, source_type, source_title,
observed_on (not in the future), and observer for field surveys.
Take coordinates on site (phone GPS, 6 decimals). Leave cells empty when
you don't know. Never guess.

Put real files in `data/raw/` (ignored by git, so personal survey notes stay
off GitHub).

## 7. Adding a new municipality

1. Add an entry in `pipeline/config/areas.ts` (code, name, province, the
   exact OSM boundary name and `admin_level`; Bulacan towns are level 6
   inside the level-4 province). Check the boundary on
   openstreetmap.org first.
2. `npm run pipeline -- osm --area <code> --dry-run` and read the report.
   The run fails with a clear error if the boundary matches zero or several
   areas. Fix the config instead of guessing.
3. Set `enabledByDefault: true` when it works.

Caloocan and Quezon City are pre-filled but disabled (Metro Manila uses a
different admin hierarchy); verify them the same way before enabling.

## 8. OpenStreetMap obligations (ODbL)

- Show "© OpenStreetMap contributors" wherever OSM-derived data appears
  (the map already does; promoted records carry it in their source).
- LAKBAY's database mixes OSM-derived records with others. If LAKBAY ever
  publishes a downloadable database built from OSM data, that derived
  database must be offered under ODbL. Keeping `external_id` on every record
  makes it possible to separate OSM-derived rows later.
- Contributor usernames are not stored (the importer drops them).

## 9. Testing (what was run before delivery)

- `npm run test:pipeline`: 18 tests with fake fixtures (classification,
  roads vs routes, gaps, validation, duplicates, CSV, GTFS).
- `security_test.sql`: 36 tests incl. 33–36 for the import system.
- A contract test fed the pipeline's real output into the database
  functions: upload 10 → re-upload 0 changed → promote stop (draft) →
  out-of-area stop refused until the reviewer types a municipality → route
  promoted with 2 stops and its line → OSM-only verification refused →
  swapped coordinates not stored.

Not tested here: live Overpass requests (no internet in the build
environment) and the real Supabase project. Do the dry run first.
