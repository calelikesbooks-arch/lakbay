-- =====================================================================
-- LAKBAY database security test
-- =====================================================================
-- Run AFTER all migrations, in Supabase: SQL Editor -> paste -> Run.
-- Everything happens inside one transaction that is ROLLED BACK at the
-- end, so no test users or test records are left behind.
--
-- Success = the Results panel shows one row:
--   "ALL 40 SECURITY TESTS PASSED. Test data was rolled back."
-- Any failure stops the script with an error such as "FAIL 17: ...",
-- and nothing is saved. (Individual "PASS nn" lines appear as notices
-- when run with psql.)
--
-- Names and coordinates below are TEST FIXTURES, not transport data.
-- =====================================================================
begin;

-- ---------- Test identities ------------------------------------------
select set_config('t.admin',  '00000000-0000-4000-8000-00000000000a', true);
select set_config('t.mapper', '00000000-0000-4000-8000-00000000000b', true);
select set_config('t.user',   '00000000-0000-4000-8000-00000000000c', true);
-- Point helper values (longitude, latitude)
select set_config('t.lon', '120.9500', true);
select set_config('t.lat', '14.7600', true);

insert into auth.users (id, email) values
  (current_setting('t.admin')::uuid,  'lakbay-test-admin@example.invalid'),
  (current_setting('t.mapper')::uuid, 'lakbay-test-mapper@example.invalid'),
  (current_setting('t.user')::uuid,   'lakbay-test-user@example.invalid');

do $$ begin
  if (select count(*) from public.profiles where id in (current_setting('t.admin')::uuid,
      current_setting('t.mapper')::uuid, current_setting('t.user')::uuid)) <> 3 then
    raise exception 'FAIL 01: profiles were not created automatically';
  end if;
  raise notice 'PASS 01: profiles are created automatically for new users';
end $$;

-- Bootstrap (as the database owner): one admin, one active mapper.
insert into public.user_roles (user_id, role) values (current_setting('t.admin')::uuid, 'admin');
insert into public.mapper_profiles (user_id, home_area, status) values (current_setting('t.mapper')::uuid, 'Test area', 'active');
insert into public.user_roles (user_id, role) values (current_setting('t.mapper')::uuid, 'mapper');

-- ===================== ANONYMOUS VISITOR =============================
set local role anon;
select set_config('request.jwt.claims', '', true);

do $$ begin
  insert into public.terminals (name, location, municipality, province)
  values ('TEST Anon Terminal',
          extensions.st_setsrid(extensions.st_makepoint(120.95, 14.76), 4326)::extensions.geography,
          'Test Town', 'Test Province');
  raise exception 'FAIL 02: anon inserted a terminal';
exception when insufficient_privilege then
  raise notice 'PASS 02: anon cannot insert transport data';
end $$;

do $$ begin
  perform public.review_submission(gen_random_uuid(), 'accepted');
  raise exception 'FAIL 03: anon could call review_submission';
exception when insufficient_privilege then
  raise notice 'PASS 03: anon cannot call moderator functions';
end $$;

do $$ begin
  perform 1 from public.audit_log;
  raise exception 'FAIL 04: anon can read the audit log';
exception when insufficient_privilege then
  raise notice 'PASS 04: anon cannot read the audit log';
end $$;

-- ===================== ACTIVE MAPPER =================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.mapper'), 'role', 'authenticated')::text, true);

-- Creates a draft and tries to fake the creator.
insert into public.terminals (name, location, municipality, province, created_by)
values ('TEST Central Terminal',
        extensions.st_setsrid(extensions.st_makepoint(120.9500, 14.7600), 4326)::extensions.geography,
        'Test Town', 'Test Province', current_setting('t.user')::uuid);

do $$ begin
  if (select created_by from public.terminals where name = 'TEST Central Terminal') <> current_setting('t.mapper')::uuid then
    raise exception 'FAIL 05: created_by could be faked';
  end if;
  raise notice 'PASS 05: mapper can create a draft, and created_by cannot be faked';
end $$;

do $$ begin
  insert into public.terminals (name, location, municipality, province, status)
  values ('TEST Sneaky Terminal',
          extensions.st_setsrid(extensions.st_makepoint(120.99, 14.70), 4326)::extensions.geography,
          'Test Town', 'Test Province', 'verified');
  raise exception 'FAIL 06: mapper inserted an already verified record';
exception when insufficient_privilege then
  raise notice 'PASS 06: new records cannot start as verified';
end $$;

do $$ begin
  update public.terminals set status = 'verified' where name = 'TEST Central Terminal';
  raise exception 'FAIL 07: mapper verified their own record';
exception when insufficient_privilege then
  raise notice 'PASS 07: mapper cannot verify a record directly';
end $$;

update public.terminals set status = 'pending_review' where name = 'TEST Central Terminal';
do $$ begin
  if (select status from public.terminals where name = 'TEST Central Terminal') <> 'pending_review' then
    raise exception 'FAIL 08: mapper could not send draft for review';
  end if;
  raise notice 'PASS 08: mapper can move own draft to pending_review';
end $$;

do $$ begin
  insert into public.verification_records (status_to, method, observed_on, terminal_id)
  select 'verified', 'field_survey', private.today_ph(), id from public.terminals where name = 'TEST Central Terminal';
  raise exception 'FAIL 09: mapper inserted a verification record';
exception when insufficient_privilege then
  raise notice 'PASS 09: mapper cannot insert verification records';
end $$;

-- Duplicate detection: a second stop 5 m away with a similar name.
insert into public.stops (name, location, municipality, province)
values ('TEST Plaza Stop', extensions.st_setsrid(extensions.st_makepoint(120.95100, 14.76100), 4326)::extensions.geography,
        'Test Town', 'Test Province');
insert into public.stops (name, location, municipality, province)
values ('Test Plaza stop ', extensions.st_setsrid(extensions.st_makepoint(120.95103, 14.76102), 4326)::extensions.geography,
        'Test Town', 'Test Province');
do $$ begin
  if (select possible_duplicate_of from public.stops where name = 'Test Plaza stop ') is distinct from
     (select id from public.stops where name = 'TEST Plaza Stop') then
    raise exception 'FAIL 10: near-identical stop was not flagged';
  end if;
  if (select count(*) from public.find_similar_stops('test plaza', 120.951, 14.761)) < 2 then
    raise exception 'FAIL 10: find_similar_stops missed the stops';
  end if;
  raise notice 'PASS 10: possible duplicate stops are flagged automatically';
end $$;

-- Attach evidence (allowed for mappers).
insert into public.sources (source_type, title, observed_on)
values ('field_survey', 'TEST survey of Central Terminal', private.today_ph() - 1);
insert into public.evidence (source_id, claim, terminal_id)
select s.id, 'existence', t.id
from public.sources s, public.terminals t
where s.title = 'TEST survey of Central Terminal' and t.name = 'TEST Central Terminal';

-- ===================== ANONYMOUS: drafts stay hidden =================
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);

do $$ begin
  if exists (select 1 from public.terminals where name like 'TEST%') then
    raise exception 'FAIL 11: anon can see an unverified terminal';
  end if;
  if exists (select 1 from public.sources where title like 'TEST%') then
    raise exception 'FAIL 11: anon can see a source of an unverified record';
  end if;
  if exists (select 1 from public.nearby_terminals(120.95, 14.76, 1000)) then
    raise exception 'FAIL 11: nearby_terminals returned an unverified terminal to anon';
  end if;
  raise notice 'PASS 11: anon cannot see drafts, their sources, or find them nearby';
end $$;

-- ===================== ADMIN (moderator powers) ======================
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.admin'), 'role', 'authenticated')::text, true);

do $$ begin
  update public.terminals set status = 'verified' where name = 'TEST Central Terminal';
  raise exception 'FAIL 12: admin changed status without a verification record';
exception when insufficient_privilege then
  raise notice 'PASS 12: even admins must use a verification record';
end $$;

-- A stop with no evidence cannot be verified.
do $$ begin
  insert into public.verification_records (status_to, method, observed_on, stop_id)
  select 'verified', 'field_survey', private.today_ph(), id from public.stops where name = 'TEST Plaza Stop';
  raise exception 'FAIL 13: verified a stop without evidence';
exception when check_violation then
  raise notice 'PASS 13: no evidence, no verification';
end $$;

insert into public.verification_records (status_to, method, observed_on, next_review_on, terminal_id)
select 'verified', 'field_survey', private.today_ph() - 1, private.today_ph() + 180, id
from public.terminals where name = 'TEST Central Terminal';

do $$ begin
  if (select status from public.terminals where name = 'TEST Central Terminal') <> 'verified'
     or (select last_verified_on from public.terminals where name = 'TEST Central Terminal') <> private.today_ph() - 1 then
    raise exception 'FAIL 14: verification record did not update the terminal';
  end if;
  raise notice 'PASS 14: verification record marks the terminal verified with its date';
end $$;

do $$ begin
  update public.terminals set last_verified_on = '2020-01-01' where name = 'TEST Central Terminal';
  if (select last_verified_on from public.terminals where name = 'TEST Central Terminal') <> private.today_ph() - 1 then
    raise exception 'FAIL 15: verification date could be edited directly';
  end if;
  raise notice 'PASS 15: verification dates cannot be edited directly';
end $$;

do $$ begin
  if (select count(*) from public.audit_log where table_name = 'terminals') < 3 then
    raise exception 'FAIL 16: audit log is missing terminal changes';
  end if;
  raise notice 'PASS 16: changes are recorded in the audit log (admin can read it)';
end $$;

-- ===================== MAPPER: verified data is locked ===============
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.mapper'), 'role', 'authenticated')::text, true);

update public.terminals set name = 'TEST Renamed By Mapper' where name = 'TEST Central Terminal';
do $$ begin
  if exists (select 1 from public.terminals where name = 'TEST Renamed By Mapper') then
    raise exception 'FAIL 17: mapper edited a verified record';
  end if;
  raise notice 'PASS 17: mappers cannot edit verified records';
end $$;

do $$ begin
  if exists (select 1 from public.audit_log) then
    raise exception 'FAIL 18: mapper can read the audit log';
  end if;
  raise notice 'PASS 18: only admins read the audit log';
end $$;

-- ===================== ANONYMOUS: verified data is public ============
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);

do $$
declare
  r record;
begin
  select * into r from public.nearby_terminals(120.9510, 14.7600, 500);
  if r.name is distinct from 'TEST Central Terminal' or r.distance_m not between 90 and 130 then
    raise exception 'FAIL 19: nearby_terminals wrong result: % at % m', r.name, r.distance_m;
  end if;
  if not exists (select 1 from public.sources where title = 'TEST survey of Central Terminal') then
    raise exception 'FAIL 19: source of a verified record is not public';
  end if;
  raise notice 'PASS 19: anon finds the verified terminal nearby (% m) and can read its source', round(r.distance_m::numeric);
end $$;

-- Anonymous community report: always pending, not readable back.
select public.submit_community_report('fare_changed', 'TEST market loading area',
       'The fare here seems different from before', private.today_ph());
select public.submit_community_report('fare_changed', 'TEST market loading area',
       'Same place, a second person reports the fare', private.today_ph());

do $$ begin
  perform 1 from public.community_submissions;
  raise exception 'FAIL 20: anon can read submissions';
exception when insufficient_privilege then
  raise notice 'PASS 20: anon can submit reports but cannot read them';
end $$;

do $$ begin
  perform public.submit_community_report('fare_changed', 'TEST place', 'Some details here', private.today_ph() + 5);
  raise exception 'FAIL 21: report dated in the future was accepted';
exception when invalid_datetime_format then
  raise notice 'PASS 21: reports dated in the future are rejected';
end $$;

-- ===================== SIGNED-IN USER (no roles) =====================
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.user'), 'role', 'authenticated')::text, true);

do $$ begin
  insert into public.stops (name, location, municipality, province)
  values ('TEST User Stop', extensions.st_setsrid(extensions.st_makepoint(120.97, 14.75), 4326)::extensions.geography,
          'Test Town', 'Test Province');
  raise exception 'FAIL 22: ordinary user inserted a stop';
exception when insufficient_privilege then
  raise notice 'PASS 22: ordinary users cannot add transport data';
end $$;

do $$ begin
  insert into public.user_roles (user_id, role) values (current_setting('t.user')::uuid, 'admin');
  raise exception 'FAIL 23: user granted themselves admin';
exception when insufficient_privilege then
  raise notice 'PASS 23: users cannot grant themselves roles (table)';
end $$;

do $$ begin
  perform public.set_user_role(current_setting('t.user')::uuid, 'admin', true);
  raise exception 'FAIL 24: user granted themselves admin via RPC';
exception when insufficient_privilege then
  raise notice 'PASS 24: users cannot grant themselves roles (function)';
end $$;

insert into public.saved_trips (origin_label, destination_label) values ('TEST Home', 'TEST Office');
do $$ begin
  insert into public.saved_trips (user_id, origin_label, destination_label)
  values (current_setting('t.mapper')::uuid, 'TEST A', 'TEST B');
  raise exception 'FAIL 25: user saved a trip for someone else';
exception when insufficient_privilege then
  raise notice 'PASS 25: users can only save trips for themselves';
end $$;

do $$ begin
  perform public.review_submission(gen_random_uuid(), 'accepted');
  raise exception 'FAIL 26: ordinary user reviewed a submission';
exception when insufficient_privilege then
  raise notice 'PASS 26: ordinary users cannot review submissions';
end $$;

-- ===================== MAPPER cannot see other people's data =========
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.mapper'), 'role', 'authenticated')::text, true);

do $$ begin
  if exists (select 1 from public.saved_trips) then
    raise exception 'FAIL 27: mapper can see another user''s saved trips';
  end if;
  if exists (select 1 from public.community_submissions) then
    raise exception 'FAIL 27: mapper can read other people''s submissions';
  end if;
  raise notice 'PASS 27: saved trips and submissions are private';
end $$;

-- ===================== ADMIN reviews submissions =====================
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.admin'), 'role', 'authenticated')::text, true);

do $$
declare
  v_first uuid;
  v_second uuid;
begin
  select id into v_first from public.community_submissions
    where location_text = 'TEST market loading area' order by created_at, details limit 1;
  select id into v_second from public.community_submissions
    where location_text = 'TEST market loading area' and id <> v_first limit 1;

  if (select status from public.community_submissions where id = v_first) <> 'pending' then
    raise exception 'FAIL 28: new submission is not pending';
  end if;
  if (select possible_duplicate_of from public.community_submissions where id = v_second) is null
     and (select possible_duplicate_of from public.community_submissions where id = v_first) is null then
    raise exception 'FAIL 28: similar report was not flagged as a possible duplicate';
  end if;

  perform public.review_submission(v_first, 'accepted', 'TEST accepted');
  perform public.review_submission(v_second, 'duplicate', 'TEST duplicate', v_first);
  if (select status from public.community_submissions where id = v_second) <> 'duplicate' then
    raise exception 'FAIL 28: duplicate decision not saved';
  end if;
  raise notice 'PASS 28: submissions start pending, duplicates are flagged, moderators decide';
end $$;

-- Fare rules: two verified rules for the same mode/area cannot overlap.
insert into public.sources (source_type, title, published_on, document_number)
values ('official_document', 'TEST fare circular', private.today_ph() - 30, 'TEST-MC-1');
insert into public.fare_rules (mode_code, area_scope, minimum_fare, minimum_distance_km, succeeding_km_rate, legal_basis, effective_from)
values ('jeepney', 'TEST Region', 10, 4, 1, 'TEST-MC-1', '2026-01-01'),
       ('jeepney', 'TEST Region', 11, 4, 1, 'TEST-MC-2', '2026-06-01');
insert into public.evidence (source_id, claim, fare_rule_id)
select s.id, 'fare', f.id from public.sources s, public.fare_rules f
where s.title = 'TEST fare circular' and f.area_scope = 'TEST Region';
insert into public.verification_records (status_to, method, observed_on, fare_rule_id)
select 'verified', 'document_review', private.today_ph(), id from public.fare_rules where legal_basis = 'TEST-MC-1';

do $$ begin
  insert into public.verification_records (status_to, method, observed_on, fare_rule_id)
  select 'verified', 'document_review', private.today_ph(), id from public.fare_rules where legal_basis = 'TEST-MC-2';
  raise exception 'FAIL 29: two overlapping fare rules were both verified';
exception when exclusion_violation then
  raise notice 'PASS 29: overlapping verified fare rules are rejected (set effective_to on the old rule first)';
end $$;

-- Attack: an API user flips the internal "verification in progress" flag.
insert into public.stops (name, location, municipality, province)
values ('TEST Flag Stop', extensions.st_setsrid(extensions.st_makepoint(120.93, 14.79), 4326)::extensions.geography,
        'Test Town', 'Test Province');
do $$ begin
  perform set_config('lakbay.via_verification', 'on', true);
  update public.stops set status = 'verified' where name = 'TEST Flag Stop';
  raise exception 'FAIL 30: internal flag let an API user skip verification';
exception when insufficient_privilege then
  raise notice 'PASS 30: setting the internal flag does not bypass verification';
end $$;

-- ===================== ANONYMOUS: map queries (migration 6) ==========
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);

do $$
declare
  v_names text;
begin
  select string_agg(kind || ':' || name, ', ') into v_names
  from public.map_locations_in_bbox(120.90, 14.70, 121.00, 14.80)
  where name ilike 'test%';
  if v_names is distinct from 'terminal:TEST Central Terminal' then
    raise exception 'FAIL 32: map bbox returned %, expected only the verified terminal', v_names;
  end if;
  begin
    perform public.map_locations_in_bbox(119.0, 13.0, 122.0, 16.0);
    raise exception 'FAIL 32: oversized map area was accepted';
  exception when invalid_parameter_value then
    null;
  end;
  if not exists (select 1 from public.search_locations('test central') where name = 'TEST Central Terminal') then
    raise exception 'FAIL 32: search_locations missed the verified terminal';
  end if;
  if exists (select 1 from public.search_locations('test plaza')) then
    raise exception 'FAIL 32: search_locations returned an unverified stop';
  end if;
  if (select terminals from public.map_location_counts()) < 1 then
    raise exception 'FAIL 32: map_location_counts did not count the verified terminal';
  end if;
  raise notice 'PASS 32: map queries return only verified locations and refuse huge areas';
end $$;

-- ===================== DATA IMPORT (migration 7) =====================
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.mapper'), 'role', 'authenticated')::text, true);

do $$ begin
  perform public.start_import_run('openstreetmap_overpass', null, 'osm_overpass');
  raise exception 'FAIL 33: a mapper started an import run';
exception when insufficient_privilege then
  null;
end $$;
do $$ begin
  if exists (select 1 from public.staged_features) or exists (select 1 from public.admin_review_queue) then
    raise exception 'FAIL 33: a mapper can read the staging area';
  end if;
  raise notice 'PASS 33: only moderators/admins can import or see staged data';
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.admin'), 'role', 'authenticated')::text, true);

do $$ begin
  perform public.start_import_run('dotc_ptis_gtfs', null, 'gtfs');
  raise exception 'FAIL 34: imported from a provider whose license is not approved';
exception when insufficient_privilege then
  raise notice 'PASS 34: providers must be approved in the registry before import';
end $$;

do $$
declare
  v_run uuid;
  v_res jsonb;
  v_stop_staged uuid;
  v_route_staged uuid;
  v_stop uuid;
  v_promo jsonb;
begin
  v_run := public.start_import_run('openstreetmap_overpass', null, 'osm_overpass', '{"test": true}');
  v_res := public.upsert_staged_features(v_run, jsonb_build_array(
    jsonb_build_object(
      'external_id', 'osm:node/999000001', 'external_url', 'https://www.openstreetmap.org/node/999000001',
      'kind', 'stop', 'classification', 'designated_stop', 'name', 'TEST Imported Stop',
      'mode_hints', jsonb_build_array('jeepney'), 'mode_confidence', 'inferred',
      'municipality', 'Test Town', 'province', 'Test Province',
      'lon', 120.9400, 'lat', 14.7800, 'issues', '[]'::jsonb, 'quality', 'ok',
      'content_hash', repeat('a', 64)),
    jsonb_build_object(
      'external_id', 'osm:relation/999000002', 'external_url', 'https://www.openstreetmap.org/relation/999000002',
      'kind', 'route', 'classification', 'route', 'name', 'TEST Imported Route', 'from_label', 'TEST A', 'to_label', 'TEST B',
      'mode_hints', jsonb_build_array('jeepney'), 'mode_confidence', 'inferred',
      'path', jsonb_build_object('type', 'LineString', 'coordinates', jsonb_build_array(jsonb_build_array(120.94, 14.78), jsonb_build_array(120.95, 14.77))),
      'path_complete', true, 'issues', '[]'::jsonb, 'quality', 'warning',
      'members', jsonb_build_array(jsonb_build_object('external_id', 'osm:node/999000001', 'role', 'platform')),
      'content_hash', repeat('b', 64))
  ));
  if (v_res ->> 'inserted')::int <> 2 then
    raise exception 'FAIL 35: staging upsert returned %', v_res;
  end if;
  -- Same content again = unchanged (no duplicate rows)
  v_res := public.upsert_staged_features(v_run, jsonb_build_array(jsonb_build_object(
      'external_id', 'osm:node/999000001', 'kind', 'stop', 'classification', 'designated_stop',
      'name', 'TEST Imported Stop', 'lon', 120.9400, 'lat', 14.7800, 'quality', 'ok', 'content_hash', repeat('a', 64))));
  if (v_res ->> 'unchanged')::int <> 1 then
    raise exception 'FAIL 35: re-import was not recognised as unchanged: %', v_res;
  end if;
  perform public.finish_import_run(v_run, 'completed', '{"test": true}');

  select id into v_stop_staged from public.staged_features where external_id = 'osm:node/999000001';
  select id into v_route_staged from public.staged_features where external_id = 'osm:relation/999000002';
  v_stop := public.promote_staged_feature(v_stop_staged);
  if (select status from public.stops where id = v_stop) <> 'draft' then
    raise exception 'FAIL 35: promoted stop is not a draft';
  end if;
  v_promo := public.promote_staged_route(v_route_staged, 'jeepney');
  if (v_promo ->> 'stops_linked')::int <> 1 or not (v_promo ->> 'geometry_added')::boolean then
    raise exception 'FAIL 35: route promotion result %', v_promo;
  end if;

  begin
    insert into public.verification_records (status_to, method, observed_on, stop_id)
    values ('verified', 'desk_review', private.today_ph(), v_stop);
    raise exception 'FAIL 35: an OpenStreetMap import alone verified a stop';
  exception when check_violation then
    null;
  end;
  insert into public.sources (source_type, title, observed_on) values ('field_survey', 'TEST survey of imported stop', private.today_ph());
  insert into public.evidence (source_id, claim, stop_id)
  select id, 'existence', v_stop from public.sources where title = 'TEST survey of imported stop';
  insert into public.verification_records (status_to, method, observed_on, stop_id)
  values ('verified', 'field_survey', private.today_ph(), v_stop);
  if (select status from public.stops where id = v_stop) <> 'verified' then
    raise exception 'FAIL 35: field survey did not verify the stop';
  end if;
  raise notice 'PASS 35: imports stage, promote only to drafts, and need a field survey/official source to verify';
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$ begin
  if not exists (select 1 from public.data_providers where code = 'openstreetmap_overpass') then
    raise exception 'FAIL 36: anon cannot read the source registry';
  end if;
  begin
    perform 1 from public.staged_features;
    raise exception 'FAIL 36: anon can read staged data';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS 36: the source registry is public; staged data is not';
end $$;

reset role;

-- ===================== FIELD VERIFICATION (migration 8) =====================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.mapper'), 'role', 'authenticated')::text, true);
do $$ begin
  perform public.field_check_nearby(120.95, 14.76);
  raise exception 'FAIL 37: a mapper used the field check tool';
exception when insufficient_privilege then
  null;
end $$;
do $$ begin
  if exists (select 1 from public.field_checks) then
    raise exception 'FAIL 37: a mapper can read field checks';
  end if;
  raise notice 'PASS 37: only moderators/admins can do field checks';
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.admin'), 'role', 'authenticated')::text, true);

do $$
declare
  v_stop uuid;
  v_stop2 uuid;
  v_term uuid;
  v_res jsonb;
  v_pt extensions.geography;
begin
  insert into public.stops (name, location, municipality, province)
  values ('TEST Field Stop', extensions.st_setsrid(extensions.st_makepoint(121.0000, 14.7000), 4326)::extensions.geography, 'Test Town', 'Test Province')
  returning id into v_stop;

  -- bad GPS accuracy
  begin
    perform public.submit_field_check('stop', v_stop, 'confirmed', now(), 121.0000, 14.7000, 80);
    raise exception 'FAIL 38: confirmed with 80 m GPS accuracy';
  exception when invalid_parameter_value then null; end;
  -- no GPS at all
  begin
    perform public.submit_field_check('stop', v_stop, 'confirmed', now());
    raise exception 'FAIL 38: confirmed without GPS';
  exception when invalid_parameter_value then null; end;
  -- too far (about 220 m north)
  begin
    perform public.submit_field_check('stop', v_stop, 'confirmed', now(), 121.0000, 14.7020, 10);
    raise exception 'FAIL 38: confirmed from 220 m away';
  exception when invalid_parameter_value then null; end;
  -- future / too old
  begin
    perform public.submit_field_check('stop', v_stop, 'confirmed', now() + interval '1 day', 121.0, 14.7, 10);
    raise exception 'FAIL 38: accepted a future check';
  exception when invalid_datetime_format then null; end;
  begin
    perform public.submit_field_check('stop', v_stop, 'confirmed', now() - interval '30 days', 121.0, 14.7, 10);
    raise exception 'FAIL 38: accepted a 30-day-old check';
  exception when invalid_datetime_format then null; end;
  -- fare on a stop
  begin
    perform public.submit_field_check('stop', v_stop, 'confirmed', now(), 121.0, 14.7, 10, null, 13);
    raise exception 'FAIL 38: accepted a fare on a stop';
  exception when invalid_parameter_value then null; end;

  -- good check, ~11 m away with 10 m accuracy
  v_res := public.submit_field_check('stop', v_stop, 'confirmed', now(), 121.0000, 14.7001, 10, 'TEST SIGN', null, null, null, null, 'private note');
  if (select status from public.stops where id = v_stop) <> 'verified' or v_res ->> 'status_after' <> 'verified' then
    raise exception 'FAIL 38: a good field check did not verify the stop: %', v_res;
  end if;
  if (select count(*) from public.evidence e join public.sources s on s.id = e.source_id
      where e.stop_id = v_stop and s.source_type = 'field_survey') < 3 then
    raise exception 'FAIL 38: evidence (existence, location, signboard) missing';
  end if;
  if exists (select 1 from public.sources s join public.evidence e on e.source_id = s.id
             where e.stop_id = v_stop and s.notes like '%private note%') then
    raise exception 'FAIL 38: private notes leaked into the public source';
  end if;

  -- not found on a DRAFT only logs
  insert into public.stops (name, location, municipality, province)
  values ('TEST Draft Stop', extensions.st_setsrid(extensions.st_makepoint(121.0100, 14.7100), 4326)::extensions.geography, 'Test Town', 'Test Province')
  returning id into v_stop2;
  v_res := public.submit_field_check('stop', v_stop2, 'not_found', now(), 121.0100, 14.7100, 10);
  if (select status from public.stops where id = v_stop2) <> 'draft' then
    raise exception 'FAIL 38: one "not found" changed a draft';
  end if;
  -- moved: location replaced by the measured point (~100 m east)
  v_res := public.submit_field_check('stop', v_stop2, 'moved', now(), 121.0109, 14.7100, 8);
  select location into v_pt from public.stops where id = v_stop2;
  if extensions.st_distance(v_pt, extensions.st_setsrid(extensions.st_makepoint(121.0109, 14.7100), 4326)::extensions.geography) > 1
     or (select status from public.stops where id = v_stop2) <> 'verified' then
    raise exception 'FAIL 38: "moved" did not update and verify the location: %', v_res;
  end if;
  -- not found on a VERIFIED record: needs re-check
  perform public.submit_field_check('stop', v_stop, 'not_found', now(), 121.0000, 14.7000, 10);
  if (select status from public.stops where id = v_stop) <> 'needs_recheck' then
    raise exception 'FAIL 38: "not found" on a verified stop did not ask for a re-check';
  end if;
  -- closed: retired
  insert into public.terminals (name, location, municipality, province)
  values ('TEST Field Terminal', extensions.st_setsrid(extensions.st_makepoint(121.0200, 14.7200), 4326)::extensions.geography, 'Test Town', 'Test Province')
  returning id into v_term;
  perform public.submit_field_check('terminal', v_term, 'closed', now());
  if (select status from public.terminals where id = v_term) <> 'retired' then
    raise exception 'FAIL 38: "closed" did not retire the terminal';
  end if;
  if (select count(*) from public.field_checks where stop_id in (v_stop, v_stop2) or terminal_id = v_term) <> 5 then
    raise exception 'FAIL 38: field checks were not all logged';
  end if;
  raise notice 'PASS 38: place checks need good GPS near the spot; drafts are not removed by one visit; notes stay private';
end $$;

do $$
declare
  v_a uuid; v_b uuid; v_route uuid; v_var uuid; v_geo uuid; v_res jsonb;
  v_fare_rules bigint := (select count(*) from public.fare_rules);
begin
  insert into public.stops (name, location, municipality, province) values
    ('TEST Ride A', extensions.st_setsrid(extensions.st_makepoint(121.0300, 14.7300), 4326)::extensions.geography, 'Test Town', 'Test Province')
  returning id into v_a;
  insert into public.stops (name, location, municipality, province) values
    ('TEST Ride B', extensions.st_setsrid(extensions.st_makepoint(121.0400, 14.7400), 4326)::extensions.geography, 'Test Town', 'Test Province')
  returning id into v_b;
  insert into public.routes (mode_code, name) values ('jeepney', 'TEST Field Route') returning id into v_route;
  insert into public.route_variants (route_id, direction) values (v_route, 'outbound') returning id into v_var;
  insert into public.route_variant_stops (variant_id, stop_sequence, stop_id) values (v_var, 1, v_a), (v_var, 2, v_b);
  insert into public.route_geometries (variant_id, geom, capture_method)
  values (v_var, extensions.st_geomfromgeojson('{"type":"LineString","coordinates":[[121.03,14.73],[121.04,14.74]]}')::extensions.geography, 'osm')
  returning id into v_geo;

  begin
    perform public.submit_field_check('route_variant', v_var, 'confirmed', now(), null, null, null, null, 13, v_b, v_a);
    raise exception 'FAIL 39: accepted a ride in the wrong direction';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.submit_field_check('route_variant', v_var, 'unsure', now(), null, null, null, null, 13);
    raise exception 'FAIL 39: accepted a fare without a ride';
  exception when invalid_parameter_value then null; end;

  -- ride without confirming the line
  v_res := public.submit_field_check('route_variant', v_var, 'confirmed', now(), null, null, null, 'TEST - SIGN', 13, v_a, v_b, false);
  if (select status from public.route_variants where id = v_var) <> 'verified'
     or (select status from public.routes where id = v_route) <> 'verified' then
    raise exception 'FAIL 39: riding did not verify the variant and route: %', v_res;
  end if;
  if (select status from public.route_geometries where id = v_geo) = 'verified' then
    raise exception 'FAIL 39: the line was verified although the rider said it does not match';
  end if;
  if not exists (select 1 from public.evidence where route_variant_id = v_var and claim = 'fare' and note like '%not an official fare%') then
    raise exception 'FAIL 39: the fare paid was not recorded as an observation';
  end if;
  if (select count(*) from public.fare_rules) <> v_fare_rules then
    raise exception 'FAIL 39: a field check created a fare rule';
  end if;
  if (select signboard_text from public.route_variants where id = v_var) <> 'TEST - SIGN' then
    raise exception 'FAIL 39: signboard text not stored';
  end if;
  -- second ride confirming the line
  perform public.submit_field_check('route_variant', v_var, 'confirmed', now(), null, null, null, null, null, v_a, v_b, true);
  if (select status from public.route_geometries where id = v_geo) <> 'verified' then
    raise exception 'FAIL 39: the line was not verified when the rider confirmed it';
  end if;
  raise notice 'PASS 39: rides verify routes; fares stay observations; the line needs the rider''s confirmation';
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$ begin
  begin
    perform 1 from public.field_checks;
    raise exception 'FAIL 40: anon can read field checks (GPS positions)';
  exception when insufficient_privilege then null; end;
  if not exists (select 1 from public.stops where name = 'TEST Draft Stop' and status = 'verified') then
    raise exception 'FAIL 40: a field-verified stop is not public';
  end if;
  if not exists (select 1 from public.sources where source_type = 'field_survey' and title like 'LAKBAY field check: TEST Draft Stop%') then
    raise exception 'FAIL 40: the field survey source of a public stop is not visible';
  end if;
  raise notice 'PASS 40: verified results and their sources are public; raw field checks are not';
end $$;

reset role;

-- Privilege audit: Supabase grants EXECUTE on new functions to anon by
-- default. Only the public functions listed below may be callable without signing in.
do $$
declare
  v_extra text;
begin
  select string_agg(p.proname, ', ') into v_extra
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('nearby_terminals', 'nearby_stops', 'route_variant_stop_list', 'submit_community_report',
                          'map_locations_in_bbox', 'map_location_counts', 'search_locations', 'routes_serving',
                          'route_variant_geojson')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'); -- ignore extension functions
  if v_extra is not null then
    raise exception 'FAIL 31: anon can execute extra functions: %', v_extra;
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) then
    raise exception 'FAIL 31: a public table has Row Level Security switched off';
  end if;
  raise notice 'PASS 31: anon can only call the public functions, and every table has RLS on';
end $$;

do $$ begin raise notice 'ALL TESTS PASSED (everything is now rolled back)'; end $$;
rollback;

-- Reached only if every check above passed (any failure stops the script).
select 'ALL 40 SECURITY TESTS PASSED. Test data was rolled back.' as result;
