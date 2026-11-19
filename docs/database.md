# LAKBAY database (Supabase PostgreSQL + PostGIS)

## 1. What is in it

| Group | Tables |
| --- | --- |
| People and roles | `profiles`, `user_roles`, `mapper_profiles` |
| Lookup | `transport_modes` (jeepney, modern_jeepney, city_bus, provincial_bus, p2p_bus, uv_express, tricycle, e_trike, lrt, mrt, commuter_rail, ferry; add more as rows) |
| Network | `operators`, `terminals`, `stops`, `routes`, `route_variants`, `route_variant_stops`, `route_geometries` |
| Fares | `fare_rules` (formula fares), `fare_matrices` + `fare_matrix_entries` (stop-to-stop tables) |
| Research | `sources`, `evidence`, `verification_records` |
| Community | `community_submissions` |
| Personal | `saved_destinations`, `saved_trips` |
| Admin | `audit_log` |
| Data import (migration 7) | `data_providers`, `import_areas`, `import_runs`, `staged_features`, `staged_route_members`, view `admin_review_queue` |

How routes are modelled:

```
routes (one per mode + name + operator)
  └─ route_variants (direction: outbound / inbound / loop; branches)
       ├─ route_variant_stops (ordered: 1, 2, 3 …  → stops)
       ├─ route_geometries (the line; old versions kept, one "current")
       └─ fare_matrices → fare_matrix_entries (stop A → stop B fares)
stops ── may belong to ── terminals
```

Coordinates are PostGIS `geography(Point, 4326)` and `geography(LineString, 4326)`,
so distances come out in meters. Every location must fall inside a rough
Philippines box, which catches swapped latitude/longitude.

## 2. How records become trustworthy

```
draft ──(creator)──▶ pending_review ──(moderator inserts verification_records)──▶ verified
                                                                          ├──▶ needs_recheck
                                                                          └──▶ retired
```

- Only `verified` and `needs_recheck` records are visible to the public.
- A record becomes `verified` **only** by inserting a row into
  `verification_records`, and **only** if at least one `evidence` row links
  it to a `source`. Nobody can change the status directly, not even admins.
- Since migration 7, `verified` also needs at least one **primary** source:
  `field_survey`, `official_document` or `operator`. OpenStreetMap, GTFS
  feeds and community reports are leads only and cannot verify a record on
  their own (see `docs/data-pipeline.md`).
- `last_verified_on` and `next_review_on` come from the verification record
  and cannot be edited by hand.
- Every change is written to `audit_log` (who, when, before, after).

Roles:

| Role | Can do |
| --- | --- |
| Anyone (anon) | Read verified data; `nearby_terminals`, `nearby_stops`, `route_variant_stop_list`, `map_locations_in_bbox`, `map_location_counts`, `search_locations`, `routes_serving`, `route_variant_geojson`; `submit_community_report` |
| Signed-in user | + own profile, own saved destinations and trips, see own submissions; apply as mapper |
| Active mapper | + create and edit **own** drafts, add sources and evidence, `submit_mapper_proposal`, `find_similar_*` |
| Moderator | + read and edit all records, insert `verification_records`, `review_submission`, `records_due_for_review` |
| Admin | + delete records, `set_mapper_status`, `set_user_role`, read `audit_log` |

## 3. Duplicate detection

1. **Hard rules** (database refuses):
   - routes with the same mode + name + operator;
   - terminals with the same name in the same town;
   - sources with the same URL or the same file hash;
   - two stops in the same position of one variant;
   - overlapping verified fare rules for the same mode and area.
2. **Automatic flag**: a new stop within 30 m (terminal: 120 m) of an existing
   one with a similar name, or within 8 m (terminal: 25 m) regardless of name,
   gets `possible_duplicate_of` filled in. It is still saved; a moderator decides.
   The thresholds live in `private.dup_thresholds`.
3. **On demand**: mappers call `find_similar_stops` / `find_similar_terminals`
   before adding; moderators read the `stop_duplicate_candidates` and
   `terminal_duplicate_candidates` views.
4. **Reports**: a new community report near (150 m) or with a similar place
   name to an open report from the last 30 days gets `possible_duplicate_of`.
   Moderators confirm with `review_submission(..., 'duplicate', ..., original_id)`.

## 4. Install

You need: your Supabase project, and the files in `supabase/migrations/`.

### Option A: SQL Editor (recommended for now)

1. Supabase dashboard → **SQL Editor** → **New query**.
2. Paste and **Run** each file, **in this order**, one at a time:
   1. `0001_community_reports.sql` (skip if you ran it before; it is harmless either way)
   2. `20261117000100_core_setup.sql`
   3. `20261117000200_transport_network.sql`
   4. `20261117000300_community_and_user_data.sql`
   5. `20261117000400_rls_policies.sql`
   6. `20261117000500_queries_and_duplicates.sql`
   7. `20261117000600_map_queries.sql` (map: visible-area loading, place search, routes at a location, route lines)
   8. `20261120000700_data_acquisition.sql` (import system: source registry, staging, review queue)
3. Each should end with **"Success. No rows returned"**. If one fails, stop and
   send me the error. Do not run the next file.

### Option B: Supabase CLI (later, when you are comfortable)

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

`db push` runs every migration not yet recorded in the project's history.

## 5. Configure

### Make yourself the first admin (one time)

1. Sign up a user for yourself: dashboard → **Authentication → Users → Add user**.
2. Copy that user's **UID**.
3. In the SQL Editor (this runs as the database owner, so it is allowed):

```sql
insert into public.profiles (id) values ('PASTE-YOUR-UID') on conflict do nothing;
insert into public.user_roles (user_id, role) values ('PASTE-YOUR-UID', 'admin');
```

After that, use the functions (`set_user_role`, `set_mapper_status`) from the
app or the SQL editor to manage other people.

### Keys

- The app uses only `VITE_SUPABASE_URL` and the **publishable / anon** key.
- The **service_role / secret** key bypasses every rule above. It must never
  appear in `src/`, `.env.local`, GitHub, or Cloudflare Pages settings for the
  frontend. The app refuses to start Supabase if it detects one.
- No app settings change in this milestone. Community reports now call
  `submit_community_report` instead of writing to a table.

## 6. Test

1. SQL Editor → paste `supabase/tests/security_test.sql` → **Run**.
2. Expected result row: **ALL 36 SECURITY TESTS PASSED. Test data was rolled back.**
3. Any error such as `FAIL 17: …` means a rule is broken. Nothing is saved
   either way, because the test ends with `rollback`.
4. App check: run `npm run dev`, submit a report on the Community page. It
   should say "Report sent for review". In the dashboard, open
   **Table editor → community_submissions**; the row has status `pending`.

Try a nearby query in the SQL Editor (returns nothing until data is verified):

```sql
select * from public.nearby_terminals(120.95, 14.76, 1500);
select * from public.nearby_stops(120.95, 14.76, 500, 'jeepney');
```

From the app (later): `supabase.rpc('nearby_terminals', { p_lon, p_lat, p_radius_m: 1500 })`.

## 7. Roll back

The rollback scripts are in `supabase/rollback/`. Run them in **reverse** order,
stopping at the migration you want to return to:

| Script | Effect |
| --- | --- |
| `20261120000700_down.sql` | Removes the import system (registry, staging, review queue) and restores the old verification rule. Records already promoted to drafts stay. |
| `20261117000600_down.sql` | Removes the map query functions. Keeps data. |
| `20261117000500_down.sql` | Removes nearby/duplicate functions and views. Keeps data. |
| `20261117000400_down.sql` | Removes policies. RLS stays ON, so the API is locked (safe, nothing exposed). |
| `20261117000300_down.sql` | Copies reports back to `community_reports`; **deletes** saved items and mapper proposals. |
| `20261117000200_down.sql` | **Deletes all transport data**, sources, evidence, verification history. |
| `20261117000100_down.sql` | **Deletes** profiles, roles, mapper profiles, audit log. Auth users stay. |

Before running 300, 200 or 100: export your data first
(Table editor → Export to CSV, or `npx supabase db dump --data-only -f backup.sql`).

If you use the CLI, after a manual rollback tell it which migrations are undone:
`npx supabase migration repair --status reverted 20261117000500` (one per version).

## 8. Things to verify on the real project

These could not be tested here (they were tested on plain PostgreSQL 16 with
a stand-in for PostGIS and for Supabase's auth):

- PostGIS geometry functions on real data (`ST_DWithin`, `ST_Length`, the `<->`
  nearest-first ordering). Run the security test; tests 11, 19 use them.
- The `on_auth_user_created` trigger on `auth.users`. Test 01 checks it. If
  Supabase refuses to create it, tell me; profiles can be created by the app instead.
- Notices ("PASS 01" …) may not show in the dashboard; the final result row is
  what matters.

## 9. Limits and notes

- Free plan: 500 MB database. Route lines are the largest rows; a few hundred
  routes is still far below the limit. `audit_log` grows with every edit, so
  prune it periodically (admin, SQL editor).
- Supabase gives new tables and functions in `public` broad default grants.
  **Every future migration must revoke and re-grant explicitly** (see migration
  4 and the end of migration 5), and add RLS. Security test 31 catches mistakes.
- The app's display modes (`bus`, `rail`, …) are simpler than the database
  codes (`city_bus`, `lrt`, `mrt`, …). They will be aligned in the data milestone.
- Anonymous report flood protection is basic (30 per 10 minutes across all
  anonymous users). Add Cloudflare Turnstile before a public launch.
