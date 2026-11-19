-- LAKBAY: full database setup in ONE file (all migrations, in order).
-- Only for a NEW, empty project. If you already ran some migrations, run the missing files one by one instead.
-- It runs as one transaction: if anything fails, NOTHING is changed.
begin;

-- ===================== migrations/0001_community_reports.sql =====================
-- LAKBAY: community reports (moderation queue)
-- SUPERSEDED by 20261117000300_community_and_user_data.sql, which moves these
-- rows into public.community_submissions and drops this table.
-- Kept so migration history stays complete. Safe to run (or skip) on a new project.
-- Run this in Supabase: Dashboard -> SQL Editor -> paste -> Run.
--
-- Security model:
--   * Anyone (anon) may INSERT a report, but only with status 'pending'.
--   * Nobody using the public key can SELECT, UPDATE or DELETE reports.
--     Moderators review them in the Supabase dashboard.
--   * No personal data is collected (no names, emails or phone numbers).

create table if not exists public.community_reports (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  category      text not null
                check (category in ('route_changed', 'fare_changed', 'terminal_moved', 'new_route', 'other')),
  location_text text not null check (char_length(location_text) between 3 and 120),
  details       text not null check (char_length(details) between 10 and 1000),
  observed_on   date not null,
  status        text not null default 'pending'
                check (status in ('pending', 'accepted', 'rejected'))
);

alter table public.community_reports enable row level security;

-- Make the permission explicit (newer Supabase projects may not grant it by default).
grant insert on table public.community_reports to anon, authenticated;

drop policy if exists "Anyone can submit a pending report" on public.community_reports;
create policy "Anyone can submit a pending report"
  on public.community_reports
  for insert
  to anon, authenticated
  with check (status = 'pending');


-- ===================== migrations/20261117000100_core_setup.sql =====================
-- =====================================================================
-- LAKBAY migration 1/5: extensions, types, roles, profiles, audit log
-- =====================================================================
-- Run order: this file, then 0200, 0300, 0400, 0500.
-- Rollback:  supabase/rollback/ (run in reverse order).

-- ---------------------------------------------------------------------
-- Extensions (Supabase keeps them in the "extensions" schema)
-- ---------------------------------------------------------------------
create extension if not exists postgis    with schema extensions; -- coordinates and distances
create extension if not exists pg_trgm    with schema extensions; -- fuzzy name matching (duplicates)
create extension if not exists btree_gist with schema extensions; -- non-overlapping fare periods

-- ---------------------------------------------------------------------
-- "private" schema: helper functions used by policies and triggers.
-- It is NOT exposed through the Supabase API, so nobody can call these
-- functions over HTTP. Roles still need USAGE so RLS policies can run them.
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Enumerated types (small, stable sets of values)
-- Transport MODES are deliberately a table (transport_modes), not an enum,
-- so new modes can be added later without a migration.
-- ---------------------------------------------------------------------
create type public.app_role as enum ('mapper', 'moderator', 'admin');

-- Lifecycle of every transport record. Only 'verified' and 'needs_recheck'
-- are visible to the public.
create type public.record_status as enum ('draft', 'pending_review', 'verified', 'needs_recheck', 'retired');

create type public.submission_status as enum ('pending', 'in_review', 'accepted', 'rejected', 'duplicate');
create type public.submission_type as enum ('report', 'new_stop', 'new_terminal', 'new_route', 'correction', 'fare_observation');
create type public.mapper_status as enum ('applied', 'active', 'suspended');

create type public.source_type as enum ('field_survey', 'official_document', 'operator', 'openstreetmap', 'community', 'news', 'other');
create type public.verification_method as enum (
  'field_survey', 'document_review', 'operator_confirmation', 'community_corroboration', 'desk_review'
);
create type public.evidence_claim as enum ('existence', 'location', 'path', 'stops', 'signboard', 'fare', 'schedule', 'operator', 'other');

create type public.route_direction as enum ('outbound', 'inbound', 'loop', 'bidirectional');
create type public.stop_kind as enum ('designated_stop', 'loading_area', 'rail_station', 'terminal_bay', 'informal_stop');
create type public.terminal_kind as enum ('terminal', 'transport_hub', 'rail_station', 'loading_bay');
create type public.operator_type as enum ('cooperative', 'corporation', 'government', 'individual', 'unknown');
create type public.mode_category as enum ('road', 'rail', 'water', 'other');

-- ---------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------

-- Normalizes names for duplicate checks: lowercase, single spaces, trimmed.
create or replace function private.normalize_name(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'));
$$;

-- Today's date in the Philippines (used to reject "future" observations).
create or replace function private.today_ph()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Manila')::date;
$$;

-- ---------------------------------------------------------------------
-- Profiles: one row per signed-up user (created automatically).
-- No email, phone or real name is copied here.
-- ---------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 2 and 40),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.profiles is 'Public-safe profile for each auth user. Created by trigger on auth.users.';

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Users created BEFORE this migration have no profile yet: add one for each.
insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Roles. A user may hold several. Only admins can grant roles.
-- The first admin is created by hand in the SQL editor (see docs).
-- ---------------------------------------------------------------------
create table public.user_roles (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.app_role not null,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- Community mapper applications and status.
create table public.mapper_profiles (
  user_id     uuid primary key references public.profiles (id) on delete cascade default auth.uid(),
  home_area   text check (home_area is null or char_length(home_area) <= 80),
  bio         text check (bio is null or char_length(bio) <= 500),
  status      public.mapper_status not null default 'applied',
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Role checks used by RLS policies. SECURITY DEFINER so they can read
-- user_roles even though users cannot read other people's roles.
create or replace function private.has_role(p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles r
    where r.user_id = (select auth.uid())
      and r.role = p_role
      and (
        p_role <> 'mapper'
        or exists (
          select 1 from public.mapper_profiles m
          where m.user_id = r.user_id and m.status = 'active'
        )
      )
  );
$$;

-- Moderators and admins review data.
create or replace function private.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role('moderator') or private.has_role('admin');
$$;

-- Contributors may create draft records: active mappers, moderators, admins.
create or replace function private.is_contributor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role('mapper') or private.is_moderator();
$$;

revoke all on function private.has_role(public.app_role), private.is_moderator(), private.is_contributor() from public;
grant execute on function private.has_role(public.app_role), private.is_moderator(), private.is_contributor()
  to anon, authenticated, service_role;
grant execute on function private.normalize_name(text), private.today_ph() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Row stamping: keeps created_by / created_at honest and updated_* fresh.
-- Users can never fake who created a row.
-- ---------------------------------------------------------------------
create or replace function private.stamp_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce((select auth.uid()), new.created_by);
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger mapper_profiles_touch before update on public.mapper_profiles
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Transport modes (extensible lookup table)
-- ---------------------------------------------------------------------
create table public.transport_modes (
  code           text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  label          text not null,
  category       public.mode_category not null,
  -- Who sets fares, e.g. LTFRB, LGU ordinance, rail operator. Informational.
  fare_authority text,
  has_timetable  boolean not null default false,
  sort_order     smallint not null default 100,
  is_active      boolean not null default true
);

insert into public.transport_modes (code, label, category, fare_authority, has_timetable, sort_order) values
  ('jeepney',        'Jeepney',              'road',  'LTFRB',               false, 10),
  ('modern_jeepney', 'Modern jeepney',       'road',  'LTFRB',               false, 20),
  ('city_bus',       'City bus',             'road',  'LTFRB',               false, 30),
  ('provincial_bus', 'Provincial bus',       'road',  'LTFRB',               false, 40),
  ('p2p_bus',        'P2P bus',              'road',  'LTFRB',               true,  50),
  ('uv_express',     'UV Express',           'road',  'LTFRB',               false, 60),
  ('tricycle',       'Tricycle',             'road',  'LGU ordinance',       false, 70),
  ('e_trike',        'E-trike',              'road',  'LGU ordinance',       false, 80),
  ('lrt',            'LRT',                  'rail',  'Rail operator',       true,  90),
  ('mrt',            'MRT',                  'rail',  'Rail operator',       true,  100),
  ('commuter_rail',  'Commuter rail',        'rail',  'Rail operator',       true,  110),
  ('ferry',          'Ferry',                'water', 'MARINA / operator',   true,  120);

-- ---------------------------------------------------------------------
-- Audit log: every change to transport data is recorded (who, when, what).
-- Readable by admins only. Written only by triggers.
-- ---------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   text,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor       uuid,
  occurred_at timestamptz not null default now(),
  old_data    jsonb,
  new_data    jsonb
);
create index audit_log_record_idx on public.audit_log (table_name, record_id, occurred_at desc);

create or replace function private.write_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  insert into public.audit_log (table_name, record_id, action, actor, old_data, new_data)
  values (
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    tg_op,
    (select auth.uid()),
    v_old,
    v_new
  );
  return coalesce(new, old);
end;
$$;


-- ===================== migrations/20261117000200_transport_network.sql =====================
-- =====================================================================
-- LAKBAY migration 2/5: transport network, fares, sources, evidence,
-- verification records
-- =====================================================================
-- Every transport table shares these columns:
--   status            record_status (draft -> pending_review -> verified ...)
--   last_verified_on  date of the latest verification
--   next_review_on    when it must be checked again
--   created_by/at, updated_by/at (stamped by trigger, cannot be faked)
-- Records become 'verified' ONLY by inserting a verification_records row,
-- and only if at least one piece of evidence is attached.
-- Coordinates use PostGIS geography (WGS 84 / EPSG:4326, meters for distance).

-- Rough Philippines bounding box, to catch swapped latitude/longitude.
create or replace function private.in_philippines(p extensions.geography)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select extensions.st_x(p::extensions.geometry) between 114 and 127
     and extensions.st_y(p::extensions.geometry) between 4 and 22;
$$;
grant execute on function private.in_philippines(extensions.geography) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Operators (cooperatives, companies, rail operators)
-- ---------------------------------------------------------------------
create table public.operators (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(name) between 2 and 160),
  operator_type       public.operator_type not null default 'unknown',
  franchise_reference text check (franchise_reference is null or char_length(franchise_reference) <= 120),
  website_url         text check (website_url is null or website_url ~ '^https?://'),
  status              public.record_status not null default 'draft',
  last_verified_on    date,
  next_review_on      date,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles (id) on delete set null,
  updated_at          timestamptz not null default now()
);
create unique index operators_name_uniq on public.operators (private.normalize_name(name)) where status <> 'retired';

-- ---------------------------------------------------------------------
-- Research sources (citations). Sources are reusable across records.
-- ---------------------------------------------------------------------
create table public.sources (
  id              uuid primary key default gen_random_uuid(),
  source_type     public.source_type not null,
  title           text not null check (char_length(title) between 3 and 300),
  url             text check (url is null or url ~ '^https?://'),
  publisher       text check (publisher is null or char_length(publisher) <= 160),
  -- e.g. LTFRB Memorandum Circular number
  document_number text check (document_number is null or char_length(document_number) <= 120),
  -- When the document was issued (official documents, news)
  published_on    date,
  -- When the information was seen in the field / confirmed
  observed_on     date,
  -- When LAKBAY retrieved or downloaded it
  retrieved_at    timestamptz,
  observer_id     uuid references public.profiles (id) on delete set null,
  -- Path in Supabase Storage for photos / PDFs (later)
  storage_path    text check (storage_path is null or char_length(storage_path) <= 300),
  -- SHA-256 of the file, to detect the same document uploaded twice
  content_sha256  text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  notes           text check (notes is null or char_length(notes) <= 2000),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id) on delete set null,
  updated_at      timestamptz not null default now(),
  constraint sources_has_date check (published_on is not null or observed_on is not null),
  constraint sources_dates_not_future check (
    coalesce(published_on, observed_on) <= (now() at time zone 'Asia/Manila')::date + 1
    and coalesce(observed_on, published_on) <= (now() at time zone 'Asia/Manila')::date + 1
  )
);
-- Duplicate detection for sources: same file or same URL is rejected.
create unique index sources_sha256_uniq on public.sources (content_sha256) where content_sha256 is not null;
create unique index sources_url_uniq on public.sources (lower(url)) where url is not null;

-- ---------------------------------------------------------------------
-- Terminals
-- ---------------------------------------------------------------------
create table public.terminals (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (char_length(name) between 2 and 160),
  alt_names              text[] not null default '{}',
  terminal_kind          public.terminal_kind not null default 'terminal',
  location               extensions.geography(Point, 4326) not null check (private.in_philippines(location)),
  municipality           text not null check (char_length(municipality) between 2 and 80),
  province               text not null check (char_length(province) between 2 and 80),
  address_text           text check (address_text is null or char_length(address_text) <= 300),
  landmark_text          text check (landmark_text is null or char_length(landmark_text) <= 300),
  operating_hours        text check (operating_hours is null or char_length(operating_hours) <= 200),
  notes                  text check (notes is null or char_length(notes) <= 2000),
  -- Set automatically when a similar terminal exists nearby (see migration 5)
  possible_duplicate_of  uuid references public.terminals (id) on delete set null,
  status                 public.record_status not null default 'draft',
  last_verified_on       date,
  next_review_on         date,
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_by             uuid references public.profiles (id) on delete set null,
  updated_at             timestamptz not null default now()
);
create index terminals_location_gix on public.terminals using gist (location);
create index terminals_name_trgm on public.terminals using gin (private.normalize_name(name) extensions.gin_trgm_ops);
create index terminals_status_idx on public.terminals (status);
create unique index terminals_name_town_uniq
  on public.terminals (private.normalize_name(name), private.normalize_name(municipality)) where status <> 'retired';

-- ---------------------------------------------------------------------
-- Stops (designated stops, loading areas, rail stations, terminal bays)
-- ---------------------------------------------------------------------
create table public.stops (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (char_length(name) between 2 and 160),
  alt_names              text[] not null default '{}',
  stop_kind              public.stop_kind not null default 'designated_stop',
  terminal_id            uuid references public.terminals (id) on delete set null,
  location               extensions.geography(Point, 4326) not null check (private.in_philippines(location)),
  municipality           text not null check (char_length(municipality) between 2 and 80),
  province               text not null check (char_length(province) between 2 and 80),
  landmark_text          text check (landmark_text is null or char_length(landmark_text) <= 300),
  notes                  text check (notes is null or char_length(notes) <= 2000),
  possible_duplicate_of  uuid references public.stops (id) on delete set null,
  status                 public.record_status not null default 'draft',
  last_verified_on       date,
  next_review_on         date,
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_by             uuid references public.profiles (id) on delete set null,
  updated_at             timestamptz not null default now()
);
create index stops_location_gix on public.stops using gist (location);
create index stops_name_trgm on public.stops using gin (private.normalize_name(name) extensions.gin_trgm_ops);
create index stops_terminal_idx on public.stops (terminal_id);
create index stops_status_idx on public.stops (status);

-- ---------------------------------------------------------------------
-- Routes -> variants (direction / branch) -> ordered stops + geometry
-- ---------------------------------------------------------------------
create table public.routes (
  id                uuid primary key default gen_random_uuid(),
  mode_code         text not null references public.transport_modes (code) on update cascade,
  operator_id       uuid references public.operators (id) on delete set null,
  -- Official route code (e.g. from an LTFRB franchise), if known
  route_code        text check (route_code is null or char_length(route_code) <= 60),
  name              text not null check (char_length(name) between 3 and 160),
  common_signboard  text check (common_signboard is null or char_length(common_signboard) <= 120),
  description       text check (description is null or char_length(description) <= 2000),
  status            public.record_status not null default 'draft',
  last_verified_on  date,
  next_review_on    date,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id) on delete set null,
  updated_at        timestamptz not null default now()
);
create index routes_mode_idx on public.routes (mode_code);
create index routes_operator_idx on public.routes (operator_id);
create index routes_status_idx on public.routes (status);
-- Same mode + same name + same operator = duplicate.
create unique index routes_identity_uniq on public.routes (
  mode_code,
  private.normalize_name(name),
  coalesce(operator_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where status <> 'retired';

create table public.route_variants (
  id                  uuid primary key default gen_random_uuid(),
  route_id            uuid not null references public.routes (id) on delete cascade,
  direction           public.route_direction not null,
  variant_name        text not null default 'Main' check (char_length(variant_name) between 1 and 80),
  signboard_text      text check (signboard_text is null or char_length(signboard_text) <= 120),
  origin_stop_id      uuid references public.stops (id) on delete set null,
  destination_stop_id uuid references public.stops (id) on delete set null,
  is_primary          boolean not null default false,
  service_hours       text check (service_hours is null or char_length(service_hours) <= 200),
  frequency_note      text check (frequency_note is null or char_length(frequency_note) <= 200),
  status              public.record_status not null default 'draft',
  last_verified_on    date,
  next_review_on      date,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles (id) on delete set null,
  updated_at          timestamptz not null default now(),
  constraint route_variants_name_uniq unique (route_id, direction, variant_name)
);
create index route_variants_route_idx on public.route_variants (route_id);
create index route_variants_status_idx on public.route_variants (status);
-- At most one primary variant per route and direction.
create unique index route_variants_one_primary on public.route_variants (route_id, direction) where is_primary;

-- Ordered stops of a variant. Sequence starts at 1.
-- The key is DEFERRABLE so stops can be re-ordered inside one transaction.
create table public.route_variant_stops (
  variant_id            uuid not null references public.route_variants (id) on delete cascade,
  stop_sequence         smallint not null check (stop_sequence > 0),
  stop_id               uuid not null references public.stops (id) on delete restrict,
  distance_from_start_m numeric(9, 1) check (distance_from_start_m is null or distance_from_start_m >= 0),
  boarding_allowed      boolean not null default true,
  alighting_allowed     boolean not null default true,
  constraint route_variant_stops_pkey primary key (variant_id, stop_sequence) deferrable initially immediate
);
create index route_variant_stops_stop_idx on public.route_variant_stops (stop_id);

-- Path of a variant. Old versions are kept; one is "current".
create table public.route_geometries (
  id                uuid primary key default gen_random_uuid(),
  variant_id        uuid not null references public.route_variants (id) on delete cascade,
  geom              extensions.geography(LineString, 4326) not null,
  length_m          numeric(10, 1),
  -- 'gps_trace', 'drawn', 'osm', 'imported'
  capture_method    text not null default 'gps_trace'
                    check (capture_method in ('gps_trace', 'drawn', 'osm', 'imported')),
  is_current        boolean not null default true,
  status            public.record_status not null default 'draft',
  last_verified_on  date,
  next_review_on    date,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id) on delete set null,
  updated_at        timestamptz not null default now()
);
create index route_geometries_geom_gix on public.route_geometries using gist (geom);
create unique index route_geometries_one_current on public.route_geometries (variant_id) where is_current;

create or replace function private.set_geometry_length()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if extensions.st_npoints(new.geom::extensions.geometry) < 2 then
    raise exception 'A route line needs at least 2 points' using errcode = '22023';
  end if;
  new.length_m := round(extensions.st_length(new.geom)::numeric, 1);
  return new;
end;
$$;
create trigger route_geometries_length before insert or update of geom on public.route_geometries
  for each row execute function private.set_geometry_length();

-- ---------------------------------------------------------------------
-- Fares
-- fare_rules         : formula fares (minimum fare for first N km + per km)
-- fare_matrices      : stop-to-stop fare tables (UV Express, provincial bus)
-- fare_matrix_entries: one row per origin/destination stop pair
-- ---------------------------------------------------------------------
create table public.fare_rules (
  id                      uuid primary key default gen_random_uuid(),
  mode_code               text not null references public.transport_modes (code) on update cascade,
  -- Where the rule applies, e.g. 'NCR', 'Region III', 'Marilao, Bulacan'
  area_scope              text not null check (char_length(area_scope) between 2 and 120),
  minimum_fare            numeric(8, 2) not null check (minimum_fare >= 0),
  minimum_distance_km     numeric(6, 2) not null default 0 check (minimum_distance_km >= 0),
  succeeding_km_rate      numeric(8, 2) not null default 0 check (succeeding_km_rate >= 0),
  -- Published discounted amounts (students, seniors, PWDs). NULL = unknown.
  discounted_minimum_fare numeric(8, 2) check (discounted_minimum_fare is null or discounted_minimum_fare >= 0),
  discounted_km_rate      numeric(8, 2) check (discounted_km_rate is null or discounted_km_rate >= 0),
  -- Rounding step in pesos if the issuing document states one. NULL = not stated.
  rounding_step           numeric(4, 2) check (rounding_step is null or rounding_step > 0),
  legal_basis             text not null check (char_length(legal_basis) between 3 and 200),
  effective_from          date not null,
  effective_to            date,
  status                  public.record_status not null default 'draft',
  last_verified_on        date,
  next_review_on          date,
  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_by              uuid references public.profiles (id) on delete set null,
  updated_at              timestamptz not null default now(),
  constraint fare_rules_period check (effective_to is null or effective_to > effective_from),
  -- Two VERIFIED rules for the same mode and area may not overlap in time.
  constraint fare_rules_no_overlap exclude using gist (
    mode_code with =,
    area_scope with =,
    daterange(effective_from, effective_to, '[)') with &&
  ) where (status in ('verified', 'needs_recheck'))
);
create index fare_rules_mode_idx on public.fare_rules (mode_code, area_scope);

create table public.fare_matrices (
  id               uuid primary key default gen_random_uuid(),
  route_variant_id uuid not null references public.route_variants (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 120),
  legal_basis      text check (legal_basis is null or char_length(legal_basis) <= 200),
  effective_from   date not null,
  effective_to     date,
  status           public.record_status not null default 'draft',
  last_verified_on date,
  next_review_on   date,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null,
  updated_at       timestamptz not null default now(),
  constraint fare_matrices_period check (effective_to is null or effective_to > effective_from)
);
create index fare_matrices_variant_idx on public.fare_matrices (route_variant_id);

create table public.fare_matrix_entries (
  matrix_id       uuid not null references public.fare_matrices (id) on delete cascade,
  from_stop_id    uuid not null references public.stops (id) on delete restrict,
  to_stop_id      uuid not null references public.stops (id) on delete restrict,
  regular_fare    numeric(8, 2) not null check (regular_fare >= 0),
  discounted_fare numeric(8, 2) check (discounted_fare is null or discounted_fare >= 0),
  primary key (matrix_id, from_stop_id, to_stop_id),
  constraint fare_matrix_entries_distinct check (from_stop_id <> to_stop_id)
);

-- ---------------------------------------------------------------------
-- Evidence: links a source to exactly ONE record, saying what it proves.
-- Uses one nullable foreign key per target table (real FKs, no guessing).
-- ---------------------------------------------------------------------
create table public.evidence (
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid not null references public.sources (id) on delete restrict,
  claim             public.evidence_claim not null,
  note              text check (note is null or char_length(note) <= 1000),
  operator_id       uuid references public.operators (id) on delete cascade,
  terminal_id       uuid references public.terminals (id) on delete cascade,
  stop_id           uuid references public.stops (id) on delete cascade,
  route_id          uuid references public.routes (id) on delete cascade,
  route_variant_id  uuid references public.route_variants (id) on delete cascade,
  route_geometry_id uuid references public.route_geometries (id) on delete cascade,
  fare_rule_id      uuid references public.fare_rules (id) on delete cascade,
  fare_matrix_id    uuid references public.fare_matrices (id) on delete cascade,
  created_by        uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  constraint evidence_one_target check (
    num_nonnulls(operator_id, terminal_id, stop_id, route_id, route_variant_id,
                 route_geometry_id, fare_rule_id, fare_matrix_id) = 1
  )
);
create index evidence_source_idx on public.evidence (source_id);
create index evidence_terminal_idx on public.evidence (terminal_id) where terminal_id is not null;
create index evidence_stop_idx on public.evidence (stop_id) where stop_id is not null;
create index evidence_route_idx on public.evidence (route_id) where route_id is not null;
create index evidence_variant_idx on public.evidence (route_variant_id) where route_variant_id is not null;
create index evidence_geometry_idx on public.evidence (route_geometry_id) where route_geometry_id is not null;
create index evidence_fare_rule_idx on public.evidence (fare_rule_id) where fare_rule_id is not null;
create index evidence_fare_matrix_idx on public.evidence (fare_matrix_id) where fare_matrix_id is not null;
create index evidence_operator_idx on public.evidence (operator_id) where operator_id is not null;

-- ---------------------------------------------------------------------
-- Verification records: append-only history of review decisions.
-- Inserting one is the ONLY way to change a record's status to
-- verified / needs_recheck / retired (enforced by triggers below).
-- ---------------------------------------------------------------------
create table public.verification_records (
  id                uuid primary key default gen_random_uuid(),
  status_to         public.record_status not null check (status_to in ('verified', 'needs_recheck', 'retired', 'draft')),
  method            public.verification_method not null,
  observed_on       date not null,
  next_review_on    date,
  notes             text check (notes is null or char_length(notes) <= 2000),
  verified_by       uuid not null references public.profiles (id) on delete restrict default auth.uid(),
  verified_at       timestamptz not null default now(),
  operator_id       uuid references public.operators (id) on delete cascade,
  terminal_id       uuid references public.terminals (id) on delete cascade,
  stop_id           uuid references public.stops (id) on delete cascade,
  route_id          uuid references public.routes (id) on delete cascade,
  route_variant_id  uuid references public.route_variants (id) on delete cascade,
  route_geometry_id uuid references public.route_geometries (id) on delete cascade,
  fare_rule_id      uuid references public.fare_rules (id) on delete cascade,
  fare_matrix_id    uuid references public.fare_matrices (id) on delete cascade,
  constraint verification_one_target check (
    num_nonnulls(operator_id, terminal_id, stop_id, route_id, route_variant_id,
                 route_geometry_id, fare_rule_id, fare_matrix_id) = 1
  ),
  constraint verification_review_after_observation check (next_review_on is null or next_review_on > observed_on)
);
create index verification_terminal_idx on public.verification_records (terminal_id, verified_at desc) where terminal_id is not null;
create index verification_stop_idx on public.verification_records (stop_id, verified_at desc) where stop_id is not null;
create index verification_route_idx on public.verification_records (route_id, verified_at desc) where route_id is not null;
create index verification_variant_idx on public.verification_records (route_variant_id, verified_at desc) where route_variant_id is not null;
create index verification_geometry_idx on public.verification_records (route_geometry_id) where route_geometry_id is not null;
create index verification_fare_rule_idx on public.verification_records (fare_rule_id) where fare_rule_id is not null;
create index verification_fare_matrix_idx on public.verification_records (fare_matrix_id) where fare_matrix_id is not null;
create index verification_operator_idx on public.verification_records (operator_id) where operator_id is not null;

-- ---------------------------------------------------------------------
-- Status guard: blocks direct status changes to verified / needs_recheck /
-- retired. Only private.apply_verification (below) may make them; it runs
-- as the table owner and sets a transaction flag first. API users
-- (anon / authenticated) can never pass this check, even if they could
-- set the flag, because they are never the current_user inside it.
-- ---------------------------------------------------------------------
create or replace function private.guard_record_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_trusted boolean :=
    coalesce(current_setting('lakbay.via_verification', true), '') = 'on'
    and current_user not in ('anon', 'authenticated');
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'pending_review') and not v_trusted then
      raise exception 'New % records must start as draft or pending_review', tg_table_name
        using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status then
    if (new.status not in ('draft', 'pending_review') or old.status not in ('draft', 'pending_review'))
       and not v_trusted then
      raise exception 'Changing % status from % to % requires a verification record', tg_table_name, old.status, new.status
        using errcode = '42501',
              hint = 'Insert a row into public.verification_records instead.';
    end if;
  end if;
  if not v_trusted then
    -- Verification dates are owned by verification_records too.
    if tg_op = 'INSERT' then
      new.last_verified_on := null;
      new.next_review_on := null;
    else
      new.last_verified_on := old.last_verified_on;
      new.next_review_on := old.next_review_on;
    end if;
  end if;
  return new;
end;
$$;

-- Applies a verification record to its target and enforces "no evidence,
-- no verification".
create or replace function private.apply_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_id uuid;
  v_fk text;
  v_has_evidence boolean;
begin
  select t.tbl, t.id, t.fk into v_table, v_id, v_fk
  from (values
    ('operators', new.operator_id, 'operator_id'),
    ('terminals', new.terminal_id, 'terminal_id'),
    ('stops', new.stop_id, 'stop_id'),
    ('routes', new.route_id, 'route_id'),
    ('route_variants', new.route_variant_id, 'route_variant_id'),
    ('route_geometries', new.route_geometry_id, 'route_geometry_id'),
    ('fare_rules', new.fare_rule_id, 'fare_rule_id'),
    ('fare_matrices', new.fare_matrix_id, 'fare_matrix_id')
  ) as t (tbl, id, fk)
  where t.id is not null;

  if new.status_to in ('verified', 'needs_recheck') then
    execute format('select exists (select 1 from public.evidence where %I = $1)', v_fk)
      into v_has_evidence using v_id;
    if not v_has_evidence then
      raise exception 'Cannot mark % % as %: attach at least one source in public.evidence first',
        v_table, v_id, new.status_to using errcode = '23514';
    end if;
  end if;

  if new.observed_on > private.today_ph() then
    raise exception 'observed_on cannot be in the future' using errcode = '22007';
  end if;

  perform set_config('lakbay.via_verification', 'on', true);
  execute format(
    'update public.%I set status = $1, last_verified_on = $2, next_review_on = $3 where id = $4',
    v_table
  ) using
    new.status_to,
    case when new.status_to in ('verified', 'needs_recheck') then new.observed_on end,
    new.next_review_on,
    v_id;
  perform set_config('lakbay.via_verification', 'off', true);

  return new;
end;
$$;

create trigger verification_records_apply
  after insert on public.verification_records
  for each row execute function private.apply_verification();

-- Attach stamp, status guard and audit triggers to every status-bearing table.
do $$
declare
  t text;
begin
  foreach t in array array['operators', 'terminals', 'stops', 'routes', 'route_variants',
                           'route_geometries', 'fare_rules', 'fare_matrices', 'sources']
  loop
    execute format('create trigger %I before insert or update on public.%I
                    for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function private.write_audit()', t || '_audit', t);
    if t <> 'sources' then
      execute format('create trigger %I before insert or update on public.%I
                      for each row execute function private.guard_record_status()', t || '_guard_status', t);
    end if;
  end loop;
end;
$$;

-- Child tables and evidence are audited too.
create trigger route_variant_stops_audit after insert or update or delete on public.route_variant_stops
  for each row execute function private.write_audit();
create trigger fare_matrix_entries_audit after insert or update or delete on public.fare_matrix_entries
  for each row execute function private.write_audit();
create trigger evidence_audit after insert or update or delete on public.evidence
  for each row execute function private.write_audit();
create trigger verification_records_audit after insert on public.verification_records
  for each row execute function private.write_audit();


-- ===================== migrations/20261117000300_community_and_user_data.sql =====================
-- =====================================================================
-- LAKBAY migration 3/5: community submissions, saved destinations,
-- saved trips, and the functions (RPCs) that control them
-- =====================================================================
-- Public users NEVER write transport tables. They send submissions, which
-- always start as 'pending' and are reviewed by a moderator. Moderators
-- then create or update records through the draft -> verification flow.

create table public.community_submissions (
  id                    uuid primary key default gen_random_uuid(),
  submission_type       public.submission_type not null,
  -- For 'report': route_changed, fare_changed, terminal_moved, new_route, other
  category              text check (category is null or category ~ '^[a-z_]{2,40}$'),
  submitted_by          uuid references public.profiles (id) on delete set null,
  location_text         text not null check (char_length(location_text) between 3 and 120),
  location              extensions.geography(Point, 4326) check (location is null or private.in_philippines(location)),
  details               text not null check (char_length(details) between 10 and 1000),
  -- Structured proposal from mappers (e.g. stop name, signboard, fare paid)
  payload               jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 16384),
  observed_on           date not null,
  -- Optional pointer to an existing record the submission is about
  target_table          text check (target_table is null or target_table in
                          ('terminals', 'stops', 'routes', 'route_variants', 'fare_rules', 'fare_matrices', 'operators')),
  target_id             uuid,
  status                public.submission_status not null default 'pending',
  -- Filled automatically when a similar pending submission exists
  possible_duplicate_of uuid references public.community_submissions (id) on delete set null,
  -- Filled by the moderator when status = 'duplicate'
  duplicate_of          uuid references public.community_submissions (id) on delete set null,
  reviewed_by           uuid references public.profiles (id) on delete set null,
  reviewed_at           timestamptz,
  review_notes          text check (review_notes is null or char_length(review_notes) <= 2000),
  created_at            timestamptz not null default now(),
  constraint submissions_target_pair check ((target_table is null) = (target_id is null)),
  constraint submissions_duplicate_needs_ref check (status <> 'duplicate' or duplicate_of is not null)
);
create index community_submissions_status_idx on public.community_submissions (status, created_at desc);
create index community_submissions_user_idx on public.community_submissions (submitted_by, created_at desc);
create index community_submissions_location_gix on public.community_submissions using gist (location);
create index community_submissions_text_trgm on public.community_submissions
  using gin (private.normalize_name(location_text) extensions.gin_trgm_ops);

create trigger community_submissions_audit after insert or update or delete on public.community_submissions
  for each row execute function private.write_audit();

-- Move reports made with migration 0001 (if that table exists), then drop it.
do $$
begin
  if to_regclass('public.community_reports') is not null then
    insert into public.community_submissions
      (id, submission_type, category, location_text, details, observed_on, status, created_at)
    select id, 'report', category, location_text, details, observed_on,
           case status when 'accepted' then 'accepted'::public.submission_status
                       when 'rejected' then 'rejected'::public.submission_status
                       else 'pending'::public.submission_status end,
           created_at
    from public.community_reports;
    drop table public.community_reports;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Saved destinations and trips (signed-in users, for syncing later).
-- The app currently keeps these on the device; these tables are ready
-- for when accounts are switched on.
-- ---------------------------------------------------------------------
create table public.saved_destinations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  label       text not null check (char_length(label) between 1 and 80),
  stop_id     uuid references public.stops (id) on delete set null,
  terminal_id uuid references public.terminals (id) on delete set null,
  location    extensions.geography(Point, 4326) check (location is null or private.in_philippines(location)),
  created_at  timestamptz not null default now(),
  constraint saved_destinations_has_place check (num_nonnulls(stop_id, terminal_id, location) >= 1),
  constraint saved_destinations_label_uniq unique (user_id, label)
);
create index saved_destinations_user_idx on public.saved_destinations (user_id);

create table public.saved_trips (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  label                    text check (label is null or char_length(label) <= 80),
  origin_label             text not null check (char_length(origin_label) between 1 and 120),
  origin_stop_id           uuid references public.stops (id) on delete set null,
  origin_terminal_id       uuid references public.terminals (id) on delete set null,
  origin_location          extensions.geography(Point, 4326),
  destination_label        text not null check (char_length(destination_label) between 1 and 120),
  destination_stop_id      uuid references public.stops (id) on delete set null,
  destination_terminal_id  uuid references public.terminals (id) on delete set null,
  destination_location     extensions.geography(Point, 4326),
  created_at               timestamptz not null default now()
);
create index saved_trips_user_idx on public.saved_trips (user_id, created_at desc);
-- The same trip cannot be saved twice by the same user.
create unique index saved_trips_uniq on public.saved_trips (
  user_id, private.normalize_name(origin_label), private.normalize_name(destination_label)
);

-- Cap per user, so one account cannot fill the free database.
create or replace function private.limit_saved_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name) into v_count using new.user_id;
  if v_count >= 200 then
    raise exception 'Limit of 200 saved items reached' using errcode = '54000';
  end if;
  return new;
end;
$$;
create trigger saved_destinations_limit before insert on public.saved_destinations
  for each row execute function private.limit_saved_rows();
create trigger saved_trips_limit before insert on public.saved_trips
  for each row execute function private.limit_saved_rows();

-- ---------------------------------------------------------------------
-- RPC: submit a community report (anyone, signed in or not)
-- Called from the app with supabase.rpc('submit_community_report', {...}).
-- SECURITY DEFINER: the function decides every sensitive column itself
-- (status is always 'pending'; submitted_by is the real caller).
-- ---------------------------------------------------------------------
create or replace function public.submit_community_report(
  p_category      text,
  p_location_text text,
  p_details       text,
  p_observed_on   date,
  p_lon           double precision default null,
  p_lat           double precision default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_location extensions.geography;
  v_location_text text := btrim(coalesce(p_location_text, ''));
  v_details text := btrim(coalesce(p_details, ''));
  v_dup uuid;
  v_id uuid;
begin
  if p_category is null or p_category not in ('route_changed', 'fare_changed', 'terminal_moved', 'new_route', 'other') then
    raise exception 'Unknown report category' using errcode = '22023';
  end if;
  if p_observed_on is null or p_observed_on > private.today_ph() then
    raise exception 'observed_on must be today or earlier' using errcode = '22007';
  end if;
  if (p_lon is null) <> (p_lat is null) then
    raise exception 'Give both longitude and latitude, or neither' using errcode = '22023';
  end if;
  if p_lon is not null then
    v_location := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography;
  end if;

  -- Basic flood protection.
  if v_uid is not null and (
       select count(*) from public.community_submissions
       where submitted_by = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many reports in the last hour. Please try again later.' using errcode = '54000';
  end if;
  if v_uid is null and (
       select count(*) from public.community_submissions
       where submitted_by is null and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'Reporting is busy right now. Please try again in a few minutes.' using errcode = '54000';
  end if;

  -- Duplicate hint: a similar open report from the last 30 days.
  select s.id into v_dup
  from public.community_submissions s
  where s.status in ('pending', 'in_review')
    and s.created_at > now() - interval '30 days'
    and coalesce(s.category, '') = p_category
    and (
      (v_location is not null and s.location is not null
         and extensions.st_dwithin(s.location, v_location, 150))
      or extensions.similarity(private.normalize_name(s.location_text), private.normalize_name(v_location_text)) >= 0.6
    )
  order by s.created_at desc
  limit 1;

  insert into public.community_submissions
    (submission_type, category, submitted_by, location_text, location, details, observed_on, status, possible_duplicate_of)
  values
    ('report', p_category, v_uid, v_location_text, v_location, v_details, p_observed_on, 'pending', v_dup)
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: structured proposal from an active mapper (new stop, terminal...)
-- ---------------------------------------------------------------------
create or replace function public.submit_mapper_proposal(
  p_type          public.submission_type,
  p_location_text text,
  p_details       text,
  p_observed_on   date,
  p_payload       jsonb default '{}'::jsonb,
  p_lon           double precision default null,
  p_lat           double precision default null,
  p_target_table  text default null,
  p_target_id     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_location extensions.geography;
begin
  if not private.is_contributor() then
    raise exception 'Only active community mappers can send proposals' using errcode = '42501';
  end if;
  if p_type = 'report' then
    raise exception 'Use submit_community_report for simple reports' using errcode = '22023';
  end if;
  if p_observed_on is null or p_observed_on > private.today_ph() then
    raise exception 'observed_on must be today or earlier' using errcode = '22007';
  end if;
  if (p_lon is null) <> (p_lat is null) then
    raise exception 'Give both longitude and latitude, or neither' using errcode = '22023';
  end if;
  if p_lon is not null then
    v_location := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography;
  end if;

  insert into public.community_submissions
    (submission_type, submitted_by, location_text, location, details, payload, observed_on, target_table, target_id, status)
  values
    (p_type, (select auth.uid()), btrim(p_location_text), v_location, btrim(p_details), coalesce(p_payload, '{}'::jsonb),
     p_observed_on, p_target_table, p_target_id, 'pending')
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: moderator decision on a submission
-- ---------------------------------------------------------------------
create or replace function public.review_submission(
  p_submission_id uuid,
  p_decision      public.submission_status,
  p_notes         text default null,
  p_duplicate_of  uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.submission_status;
begin
  if not private.is_moderator() then
    raise exception 'Only moderators can review submissions' using errcode = '42501';
  end if;
  if p_decision = 'pending' then
    raise exception 'A review cannot set a submission back to pending' using errcode = '22023';
  end if;
  if p_decision = 'duplicate' and (p_duplicate_of is null or p_duplicate_of = p_submission_id) then
    raise exception 'Name the original submission in p_duplicate_of' using errcode = '22023';
  end if;

  select status into v_current from public.community_submissions where id = p_submission_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if v_current in ('accepted', 'rejected', 'duplicate') then
    raise exception 'Submission was already decided (%)', v_current using errcode = '22023';
  end if;

  update public.community_submissions
  set status = p_decision,
      review_notes = p_notes,
      duplicate_of = case when p_decision = 'duplicate' then p_duplicate_of end,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = p_submission_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RPCs: mapper applications and approvals
-- ---------------------------------------------------------------------
create or replace function public.apply_as_mapper(p_home_area text, p_bio text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  insert into public.mapper_profiles (user_id, home_area, bio, status)
  values ((select auth.uid()), btrim(p_home_area), nullif(btrim(coalesce(p_bio, '')), ''), 'applied')
  on conflict (user_id) do update
    set home_area = excluded.home_area, bio = excluded.bio;
end;
$$;

-- Admin approves / suspends a mapper. Keeps user_roles in sync.
create or replace function public.set_mapper_status(p_user_id uuid, p_status public.mapper_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role('admin') then
    raise exception 'Only admins can change mapper status' using errcode = '42501';
  end if;
  update public.mapper_profiles
  set status = p_status,
      approved_by = case when p_status = 'active' then (select auth.uid()) else approved_by end,
      approved_at = case when p_status = 'active' then now() else approved_at end
  where user_id = p_user_id;
  if not found then
    raise exception 'That user has not applied as a mapper' using errcode = 'P0002';
  end if;

  if p_status = 'active' then
    insert into public.user_roles (user_id, role, granted_by)
    values (p_user_id, 'mapper', (select auth.uid()))
    on conflict (user_id, role) do nothing;
  else
    delete from public.user_roles where user_id = p_user_id and role = 'mapper';
  end if;
end;
$$;

-- Admin grants or removes moderator/admin roles. Admins cannot remove
-- their own admin role (prevents locking everyone out by accident).
create or replace function public.set_user_role(p_user_id uuid, p_role public.app_role, p_grant boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role('admin') then
    raise exception 'Only admins can change roles' using errcode = '42501';
  end if;
  if p_role = 'mapper' then
    raise exception 'Use set_mapper_status for mappers' using errcode = '22023';
  end if;
  if p_grant then
    insert into public.user_roles (user_id, role, granted_by)
    values (p_user_id, p_role, (select auth.uid()))
    on conflict (user_id, role) do nothing;
  else
    if p_user_id = (select auth.uid()) and p_role = 'admin' then
      raise exception 'You cannot remove your own admin role' using errcode = '22023';
    end if;
    delete from public.user_roles where user_id = p_user_id and role = p_role;
  end if;
end;
$$;

create trigger user_roles_audit after insert or update or delete on public.user_roles
  for each row execute function private.write_audit();


-- ===================== migrations/20261117000400_rls_policies.sql =====================
-- =====================================================================
-- LAKBAY migration 4/5: privileges and Row Level Security (RLS)
-- =====================================================================
-- Who can do what (summary):
--   anon (not signed in)  : read verified / needs_recheck transport data,
--                           call submit_community_report and nearby_* queries
--   authenticated user    : the above + own profile, own saved items,
--                           own submissions
--   active mapper         : + create and edit OWN draft / pending records,
--                           attach evidence, send proposals
--   moderator             : + read/edit all records, review submissions,
--                           insert verification records (the ONLY way to verify)
--   admin                 : + delete records, manage roles and mappers, audit log
--   service_role          : bypasses RLS. Server-side scripts only. NEVER in the app.

-- ---------------------------------------------------------------------
-- 1. Start from zero: remove the broad default grants, then add back
--    exactly what each role needs. RLS then filters rows.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Read access (rows are filtered by policies below)
grant select on
  public.transport_modes, public.operators, public.sources, public.terminals, public.stops,
  public.routes, public.route_variants, public.route_variant_stops, public.route_geometries,
  public.fare_rules, public.fare_matrices, public.fare_matrix_entries,
  public.evidence, public.verification_records
to anon, authenticated;

grant select on
  public.profiles, public.user_roles, public.mapper_profiles,
  public.community_submissions, public.audit_log,
  public.saved_destinations, public.saved_trips
to authenticated;

-- Write access for signed-in users (policies decide who really may)
grant insert, update, delete on
  public.operators, public.sources, public.terminals, public.stops,
  public.routes, public.route_variants, public.route_variant_stops, public.route_geometries,
  public.fare_rules, public.fare_matrices, public.fare_matrix_entries
to authenticated;
grant insert, delete on public.evidence to authenticated;
grant insert on public.verification_records to authenticated;        -- no update/delete: append-only
grant insert, update on public.transport_modes to authenticated;      -- admins only (policy)
grant update (display_name) on public.profiles to authenticated;      -- only this column
grant insert, update, delete on public.saved_destinations, public.saved_trips to authenticated;
-- community_submissions, user_roles, mapper_profiles: no direct writes.
-- Use the RPC functions from migration 3.

-- RPC functions callable through the API
grant execute on function public.submit_community_report(text, text, text, date, double precision, double precision)
  to anon, authenticated;
grant execute on function public.submit_mapper_proposal(public.submission_type, text, text, date, jsonb,
  double precision, double precision, text, uuid) to authenticated;
grant execute on function public.review_submission(uuid, public.submission_status, text, uuid) to authenticated;
grant execute on function public.apply_as_mapper(text, text) to authenticated;
grant execute on function public.set_mapper_status(uuid, public.mapper_status) to authenticated;
grant execute on function public.set_user_role(uuid, public.app_role, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Turn on RLS everywhere. A table with RLS on and no matching policy
--    returns nothing and accepts nothing.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_roles', 'mapper_profiles', 'transport_modes', 'audit_log',
    'operators', 'sources', 'terminals', 'stops', 'routes', 'route_variants',
    'route_variant_stops', 'route_geometries', 'fare_rules', 'fare_matrices',
    'fare_matrix_entries', 'evidence', 'verification_records',
    'community_submissions', 'saved_destinations', 'saved_trips']
  loop
    -- (Not FORCE: the trusted SECURITY DEFINER functions run as the table
    --  owner and must not be filtered. API roles are always filtered.)
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Transport records with a status column: same rules for all eight.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['operators', 'terminals', 'stops', 'routes', 'route_variants',
                           'route_geometries', 'fare_rules', 'fare_matrices']
  loop
    -- Everyone: verified data only
    execute format($p$create policy "public reads verified" on public.%I for select to anon, authenticated
      using (status in ('verified', 'needs_recheck'))$p$, t);
    -- Contributors see drafts too (helps avoid duplicates)
    execute format($p$create policy "contributors read all" on public.%I for select to authenticated
      using (private.is_contributor())$p$, t);
    -- Creators always see their own rows
    execute format($p$create policy "creators read own" on public.%I for select to authenticated
      using (created_by = (select auth.uid()))$p$, t);
    -- New rows: contributors only, never already verified
    execute format($p$create policy "contributors create drafts" on public.%I for insert to authenticated
      with check (private.is_contributor() and status in ('draft', 'pending_review'))$p$, t);
    -- Mappers edit only their own unverified rows
    execute format($p$create policy "mappers edit own drafts" on public.%I for update to authenticated
      using (private.has_role('mapper') and created_by = (select auth.uid()) and status in ('draft', 'pending_review'))
      with check (created_by = (select auth.uid()) and status in ('draft', 'pending_review'))$p$, t);
    -- Moderators edit any row (status changes still need a verification record)
    execute format($p$create policy "moderators edit" on public.%I for update to authenticated
      using (private.is_moderator()) with check (private.is_moderator())$p$, t);
    -- Deleting: creators may delete their own DRAFTS; admins anything.
    -- Prefer retiring records (verification status 'retired') over deleting.
    execute format($p$create policy "creators delete own drafts" on public.%I for delete to authenticated
      using (private.is_contributor() and created_by = (select auth.uid()) and status = 'draft')$p$, t);
    execute format($p$create policy "admins delete" on public.%I for delete to authenticated
      using (private.has_role('admin'))$p$, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Child tables follow their parent
-- ---------------------------------------------------------------------
create or replace function private.can_edit_variant(p_variant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_moderator() or exists (
    select 1 from public.route_variants v
    where v.id = p_variant_id
      and v.created_by = (select auth.uid())
      and v.status in ('draft', 'pending_review')
      and private.has_role('mapper')
  );
$$;

create or replace function private.can_edit_matrix(p_matrix_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_moderator() or exists (
    select 1 from public.fare_matrices m
    where m.id = p_matrix_id
      and m.created_by = (select auth.uid())
      and m.status in ('draft', 'pending_review')
      and private.has_role('mapper')
  );
$$;
revoke all on function private.can_edit_variant(uuid), private.can_edit_matrix(uuid) from public;
grant execute on function private.can_edit_variant(uuid), private.can_edit_matrix(uuid) to authenticated;

-- Visible when the parent variant is visible to the same user (RLS applies inside EXISTS).
create policy "read with parent" on public.route_variant_stops for select to anon, authenticated
  using (exists (select 1 from public.route_variants v where v.id = variant_id));
create policy "edit with parent" on public.route_variant_stops for all to authenticated
  using (private.can_edit_variant(variant_id)) with check (private.can_edit_variant(variant_id));

create policy "read with parent" on public.fare_matrix_entries for select to anon, authenticated
  using (exists (select 1 from public.fare_matrices m where m.id = matrix_id));
create policy "edit with parent" on public.fare_matrix_entries for all to authenticated
  using (private.can_edit_matrix(matrix_id)) with check (private.can_edit_matrix(matrix_id));

-- ---------------------------------------------------------------------
-- 5. Sources, evidence, verification records
-- ---------------------------------------------------------------------

-- True when the record an evidence row points to is publicly visible.
create or replace function private.evidence_is_public(p_evidence_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.evidence e
    where e.id = p_evidence_id
      and (
           exists (select 1 from public.operators x where x.id = e.operator_id and x.status in ('verified', 'needs_recheck'))
        or exists (select 1 from public.terminals x where x.id = e.terminal_id and x.status in ('verified', 'needs_recheck'))
        or exists (select 1 from public.stops x where x.id = e.stop_id and x.status in ('verified', 'needs_recheck'))
        or exists (select 1 from public.routes x where x.id = e.route_id and x.status in ('verified', 'needs_recheck'))
        or exists (select 1 from public.route_variants x where x.id = e.route_variant_id and x.status in ('verified', 'needs_recheck'))
        or exists (select 1 from public.route_geometries x where x.id = e.route_geometry_id and x.status in ('verified', 'needs_recheck'))
        or exists (select 1 from public.fare_rules x where x.id = e.fare_rule_id and x.status in ('verified', 'needs_recheck'))
        or exists (select 1 from public.fare_matrices x where x.id = e.fare_matrix_id and x.status in ('verified', 'needs_recheck'))
      )
  );
$$;

-- A source is public once it supports at least one public record.
create or replace function private.source_is_public(p_source_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.evidence e
    where e.source_id = p_source_id and private.evidence_is_public(e.id)
  );
$$;
revoke all on function private.evidence_is_public(uuid), private.source_is_public(uuid) from public;
grant execute on function private.evidence_is_public(uuid), private.source_is_public(uuid) to anon, authenticated;

create policy "public reads cited sources" on public.sources for select to anon, authenticated
  using (private.source_is_public(id));
create policy "contributors read all" on public.sources for select to authenticated
  using (private.is_contributor());
create policy "contributors add" on public.sources for insert to authenticated
  with check (private.is_contributor());
create policy "creator or moderator edits" on public.sources for update to authenticated
  using (private.is_moderator() or (private.is_contributor() and created_by = (select auth.uid())))
  with check (private.is_moderator() or (private.is_contributor() and created_by = (select auth.uid())));
create policy "admins delete" on public.sources for delete to authenticated
  using (private.has_role('admin'));

create policy "public reads evidence of public records" on public.evidence for select to anon, authenticated
  using (private.evidence_is_public(id));
create policy "contributors read all" on public.evidence for select to authenticated
  using (private.is_contributor());
create policy "contributors attach" on public.evidence for insert to authenticated
  with check (private.is_contributor() and created_by = (select auth.uid()));
create policy "moderators remove" on public.evidence for delete to authenticated
  using (private.is_moderator());

create policy "public reads verification history" on public.verification_records for select to anon, authenticated
  using (status_to in ('verified', 'needs_recheck'));
create policy "contributors read all" on public.verification_records for select to authenticated
  using (private.is_contributor());
create policy "moderators verify" on public.verification_records for insert to authenticated
  with check (private.is_moderator() and verified_by = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 6. Lookup and admin tables
-- ---------------------------------------------------------------------
create policy "anyone reads modes" on public.transport_modes for select to anon, authenticated using (true);
create policy "admins add modes" on public.transport_modes for insert to authenticated with check (private.has_role('admin'));
create policy "admins edit modes" on public.transport_modes for update to authenticated
  using (private.has_role('admin')) with check (private.has_role('admin'));

create policy "admins read audit" on public.audit_log for select to authenticated using (private.has_role('admin'));

-- ---------------------------------------------------------------------
-- 7. People
-- ---------------------------------------------------------------------
create policy "read own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "moderators read profiles" on public.profiles for select to authenticated
  using (private.is_moderator());
create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "read own roles" on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "admins read roles" on public.user_roles for select to authenticated
  using (private.has_role('admin'));

create policy "read own mapper profile" on public.mapper_profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "moderators read mapper profiles" on public.mapper_profiles for select to authenticated
  using (private.is_moderator());

-- ---------------------------------------------------------------------
-- 8. Community submissions and saved items
-- ---------------------------------------------------------------------
create policy "read own submissions" on public.community_submissions for select to authenticated
  using (submitted_by = (select auth.uid()));
create policy "moderators read submissions" on public.community_submissions for select to authenticated
  using (private.is_moderator());

create policy "owner manages" on public.saved_destinations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owner manages" on public.saved_trips for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));


-- ===================== migrations/20261117000500_queries_and_duplicates.sql =====================
-- =====================================================================
-- LAKBAY migration 5/5: nearby queries, duplicate detection, review queue
-- =====================================================================
-- Query functions are SECURITY INVOKER: they run with the caller's
-- permissions, so RLS still hides drafts from the public.

-- ---------------------------------------------------------------------
-- Nearby terminals
--   select * from nearby_terminals(120.9581, 14.7563, 1500);
--   supabase.rpc('nearby_terminals', { p_lon, p_lat, p_radius_m: 1500 })
-- ---------------------------------------------------------------------
create or replace function public.nearby_terminals(
  p_lon      double precision,
  p_lat      double precision,
  p_radius_m integer default 1000,
  p_limit    integer default 20
)
returns table (
  id               uuid,
  name             text,
  terminal_kind    public.terminal_kind,
  municipality     text,
  status           public.record_status,
  last_verified_on date,
  distance_m       double precision,
  lon              double precision,
  lat              double precision,
  modes            text[]
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_origin geography;
begin
  if p_lon is null or p_lat is null or p_lon not between -180 and 180 or p_lat not between -90 and 90 then
    raise exception 'Invalid coordinates' using errcode = '22023';
  end if;
  v_origin := st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography;

  return query
  select
    t.id,
    t.name,
    t.terminal_kind,
    t.municipality,
    t.status,
    t.last_verified_on,
    st_distance(t.location, v_origin)::double precision as distance_m,
    st_x(t.location::geometry) as lon,
    st_y(t.location::geometry) as lat,
    coalesce((
      select array_agg(distinct r.mode_code order by r.mode_code)
      from stops s
      join route_variant_stops rvs on rvs.stop_id = s.id
      join route_variants v on v.id = rvs.variant_id
      join routes r on r.id = v.route_id
      where s.terminal_id = t.id
    ), '{}'::text[]) as modes
  from terminals t
  where st_dwithin(t.location, v_origin, least(greatest(coalesce(p_radius_m, 1000), 1), 5000))
    and t.status <> 'retired'
  order by t.location <-> v_origin
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- ---------------------------------------------------------------------
-- Nearby stops, optionally only those served by one mode
--   select * from nearby_stops(120.9581, 14.7563, 400, 'jeepney');
-- ---------------------------------------------------------------------
create or replace function public.nearby_stops(
  p_lon       double precision,
  p_lat       double precision,
  p_radius_m  integer default 500,
  p_mode_code text default null,
  p_limit     integer default 30
)
returns table (
  id               uuid,
  name             text,
  stop_kind        public.stop_kind,
  terminal_id      uuid,
  status           public.record_status,
  last_verified_on date,
  distance_m       double precision,
  lon              double precision,
  lat              double precision,
  modes            text[]
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_origin geography;
begin
  if p_lon is null or p_lat is null or p_lon not between -180 and 180 or p_lat not between -90 and 90 then
    raise exception 'Invalid coordinates' using errcode = '22023';
  end if;
  v_origin := st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography;

  return query
  with near as (
    select s.*
    from stops s
    where st_dwithin(s.location, v_origin, least(greatest(coalesce(p_radius_m, 500), 1), 3000))
      and s.status <> 'retired'
  ),
  served as (
    select n.id as stop_id, array_agg(distinct r.mode_code order by r.mode_code) as modes
    from near n
    join route_variant_stops rvs on rvs.stop_id = n.id
    join route_variants v on v.id = rvs.variant_id
    join routes r on r.id = v.route_id
    group by n.id
  )
  select
    n.id,
    n.name,
    n.stop_kind,
    n.terminal_id,
    n.status,
    n.last_verified_on,
    st_distance(n.location, v_origin)::double precision,
    st_x(n.location::geometry),
    st_y(n.location::geometry),
    coalesce(sv.modes, '{}'::text[])
  from near n
  left join served sv on sv.stop_id = n.id
  where p_mode_code is null or p_mode_code = any (sv.modes)
  order by n.location <-> v_origin
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- ---------------------------------------------------------------------
-- Ordered stops of one route variant (for drawing and instructions)
-- ---------------------------------------------------------------------
create or replace function public.route_variant_stop_list(p_variant_id uuid)
returns table (
  stop_sequence         smallint,
  stop_id               uuid,
  name                  text,
  lon                   double precision,
  lat                   double precision,
  distance_from_start_m numeric,
  boarding_allowed      boolean,
  alighting_allowed     boolean
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select rvs.stop_sequence, s.id, s.name,
         st_x(s.location::geometry), st_y(s.location::geometry),
         rvs.distance_from_start_m, rvs.boarding_allowed, rvs.alighting_allowed
  from route_variant_stops rvs
  join stops s on s.id = rvs.stop_id
  where rvs.variant_id = p_variant_id
  order by rvs.stop_sequence;
$$;

-- ---------------------------------------------------------------------
-- DUPLICATE DETECTION
-- Layer 1 (hard): unique indexes from migration 2 (route identity,
--          terminal name + town, source file hash / URL, variant names,
--          ordered stop positions, fare-rule date overlaps).
-- Layer 2 (soft, automatic): a new stop/terminal close to an existing
--          one with a similar name gets possible_duplicate_of filled in.
--          It is still saved; a moderator decides.
-- Layer 3 (on demand): find_similar_* lets mappers check BEFORE adding,
--          and the *_duplicate_candidates views list pairs to review.
-- ---------------------------------------------------------------------

-- Tunable thresholds in one place.
create or replace function private.dup_thresholds(p_kind text, out radius_m double precision, out min_similarity real, out always_radius_m double precision)
language sql
immutable
set search_path = ''
as $$
  select case p_kind when 'terminal' then 120.0 else 30.0 end,
         0.45::real,
         case p_kind when 'terminal' then 25.0 else 8.0 end;
$$;

create or replace function private.flag_possible_duplicate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := case tg_table_name when 'terminals' then 'terminal' else 'stop' end;
  v_t record;
  v_match uuid;
begin
  select * into v_t from private.dup_thresholds(v_kind);
  execute format($q$
    select x.id
    from public.%I x
    where x.id <> $1
      and x.status <> 'retired'
      and extensions.st_dwithin(x.location, $2, $3)
      and (
        extensions.st_dwithin(x.location, $2, $5)
        or extensions.similarity(private.normalize_name(x.name), private.normalize_name($4)) >= $6
      )
    order by extensions.st_distance(x.location, $2)
    limit 1
  $q$, tg_table_name)
  into v_match
  using new.id, new.location, v_t.radius_m, new.name, v_t.always_radius_m, v_t.min_similarity;

  new.possible_duplicate_of := v_match;
  return new;
end;
$$;

create trigger terminals_flag_duplicate before insert or update of location, name on public.terminals
  for each row execute function private.flag_possible_duplicate();
create trigger stops_flag_duplicate before insert or update of location, name on public.stops
  for each row execute function private.flag_possible_duplicate();

-- Mappers: "is this stop already in LAKBAY?" before adding it.
create or replace function public.find_similar_stops(
  p_name     text,
  p_lon      double precision,
  p_lat      double precision,
  p_radius_m integer default 75
)
returns table (id uuid, name text, status public.record_status, distance_m double precision, name_similarity real)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with origin as (select st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography as g)
  select s.id, s.name, s.status,
         st_distance(s.location, o.g)::double precision,
         similarity(private.normalize_name(s.name), private.normalize_name(p_name))
  from stops s, origin o
  where st_dwithin(s.location, o.g, least(greatest(p_radius_m, 1), 500))
    and s.status <> 'retired'
  order by similarity(private.normalize_name(s.name), private.normalize_name(p_name)) desc,
           st_distance(s.location, o.g)
  limit 10;
$$;

create or replace function public.find_similar_terminals(
  p_name     text,
  p_lon      double precision,
  p_lat      double precision,
  p_radius_m integer default 250
)
returns table (id uuid, name text, status public.record_status, distance_m double precision, name_similarity real)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with origin as (select st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography as g)
  select t.id, t.name, t.status,
         st_distance(t.location, o.g)::double precision,
         similarity(private.normalize_name(t.name), private.normalize_name(p_name))
  from terminals t, origin o
  where st_dwithin(t.location, o.g, least(greatest(p_radius_m, 1), 1000))
    and t.status <> 'retired'
  order by similarity(private.normalize_name(t.name), private.normalize_name(p_name)) desc,
           st_distance(t.location, o.g)
  limit 10;
$$;

-- Pairs for moderators to review. security_invoker = RLS of the viewer applies.
create view public.stop_duplicate_candidates with (security_invoker = true) as
select a.id as stop_id, a.name as stop_name, b.id as other_stop_id, b.name as other_name,
       extensions.st_distance(a.location, b.location)::double precision as distance_m,
       extensions.similarity(private.normalize_name(a.name), private.normalize_name(b.name)) as name_similarity
from public.stops a
join public.stops b
  on a.id < b.id
 and extensions.st_dwithin(a.location, b.location, 30)
where a.status <> 'retired' and b.status <> 'retired'
  and (extensions.st_dwithin(a.location, b.location, 8)
       or extensions.similarity(private.normalize_name(a.name), private.normalize_name(b.name)) >= 0.45);

create view public.terminal_duplicate_candidates with (security_invoker = true) as
select a.id as terminal_id, a.name as terminal_name, b.id as other_terminal_id, b.name as other_name,
       extensions.st_distance(a.location, b.location)::double precision as distance_m,
       extensions.similarity(private.normalize_name(a.name), private.normalize_name(b.name)) as name_similarity
from public.terminals a
join public.terminals b
  on a.id < b.id
 and extensions.st_dwithin(a.location, b.location, 120)
where a.status <> 'retired' and b.status <> 'retired'
  and (extensions.st_dwithin(a.location, b.location, 25)
       or extensions.similarity(private.normalize_name(a.name), private.normalize_name(b.name)) >= 0.45);

-- ---------------------------------------------------------------------
-- Review queue: verified records whose review date has passed
-- ---------------------------------------------------------------------
create or replace function public.records_due_for_review(p_on date default null)
returns table (table_name text, record_id uuid, label text, status public.record_status,
               last_verified_on date, next_review_on date)
language sql
stable
security invoker
set search_path = public
as $$
  with d as (select coalesce(p_on, private.today_ph()) as day)
  select 'terminals', id, name, status, last_verified_on, next_review_on from terminals, d
    where status in ('verified', 'needs_recheck') and next_review_on <= d.day
  union all
  select 'stops', id, name, status, last_verified_on, next_review_on from stops, d
    where status in ('verified', 'needs_recheck') and next_review_on <= d.day
  union all
  select 'routes', id, name, status, last_verified_on, next_review_on from routes, d
    where status in ('verified', 'needs_recheck') and next_review_on <= d.day
  union all
  select 'route_variants', id, variant_name, status, last_verified_on, next_review_on from route_variants, d
    where status in ('verified', 'needs_recheck') and next_review_on <= d.day
  union all
  select 'fare_rules', id, legal_basis, status, last_verified_on, next_review_on from fare_rules, d
    where status in ('verified', 'needs_recheck') and next_review_on <= d.day
  union all
  select 'fare_matrices', id, name, status, last_verified_on, next_review_on from fare_matrices, d
    where status in ('verified', 'needs_recheck') and next_review_on <= d.day
  order by next_review_on;
$$;

-- ---------------------------------------------------------------------
-- Privileges for this migration's objects
-- Supabase's default privileges give anon + authenticated EXECUTE on every
-- new function in "public", so revoke from them explicitly, then re-grant.
-- ---------------------------------------------------------------------
revoke execute on function
  public.nearby_terminals(double precision, double precision, integer, integer),
  public.nearby_stops(double precision, double precision, integer, text, integer),
  public.route_variant_stop_list(uuid),
  public.find_similar_stops(text, double precision, double precision, integer),
  public.find_similar_terminals(text, double precision, double precision, integer),
  public.records_due_for_review(date)
from public, anon, authenticated;

grant execute on function
  public.nearby_terminals(double precision, double precision, integer, integer),
  public.nearby_stops(double precision, double precision, integer, text, integer),
  public.route_variant_stop_list(uuid)
to anon, authenticated;

grant execute on function
  public.find_similar_stops(text, double precision, double precision, integer),
  public.find_similar_terminals(text, double precision, double precision, integer),
  public.records_due_for_review(date)
to authenticated;

revoke all on public.stop_duplicate_candidates, public.terminal_duplicate_candidates from anon, authenticated;
grant select on public.stop_duplicate_candidates, public.terminal_duplicate_candidates to authenticated;

revoke all on function private.flag_possible_duplicate(), private.dup_thresholds(text) from public;


-- ===================== migrations/20261117000600_map_queries.sql =====================
-- =====================================================================
-- LAKBAY migration 6: map queries
-- =====================================================================
-- Everything here is SECURITY INVOKER: RLS still applies, so the public
-- only ever receives verified / needs_recheck records.
-- Spatial filters use the GiST indexes on terminals.location and
-- stops.location (migration 2).

-- ---------------------------------------------------------------------
-- Terminals and stops inside the visible map area (bounding box).
--   select * from map_locations_in_bbox(120.90, 14.70, 121.00, 14.80);
-- The box may cover at most 1 square degree (about 110 km x 110 km),
-- so one request can never download the whole country.
-- ---------------------------------------------------------------------
create or replace function public.map_locations_in_bbox(
  p_west  double precision,
  p_south double precision,
  p_east  double precision,
  p_north double precision,
  p_limit integer default 400
)
returns table (
  kind             text,
  id               uuid,
  name             text,
  subtype          text,
  municipality     text,
  status           public.record_status,
  last_verified_on date,
  lon              double precision,
  lat              double precision,
  terminal_id      uuid,
  modes            text[]
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_box geography;
  v_limit integer := least(greatest(coalesce(p_limit, 400), 1), 1000);
begin
  if p_west is null or p_south is null or p_east is null or p_north is null
     or p_west >= p_east or p_south >= p_north
     or p_west < -180 or p_east > 180 or p_south < -90 or p_north > 90 then
    raise exception 'Invalid map bounds' using errcode = '22023';
  end if;
  if (p_east - p_west) * (p_north - p_south) > 1.0 then
    raise exception 'Map area too large. Zoom in to load locations.' using errcode = '22023';
  end if;

  v_box := st_makeenvelope(p_west, p_south, p_east, p_north, 4326)::geography;

  return query
  with t as (
    select 'terminal'::text as kind, x.id, x.name, x.terminal_kind::text as subtype, x.municipality,
           x.status, x.last_verified_on, x.location, null::uuid as terminal_id
    from terminals x
    where st_intersects(x.location, v_box) and x.status <> 'retired'
  ),
  s as (
    select 'stop'::text, x.id, x.name, x.stop_kind::text, x.municipality,
           x.status, x.last_verified_on, x.location, x.terminal_id
    from stops x
    where st_intersects(x.location, v_box) and x.status <> 'retired'
  ),
  both_kinds as (
    select * from t
    union all
    select * from s
  )
  select
    b.kind, b.id, b.name, b.subtype, b.municipality, b.status, b.last_verified_on,
    st_x(b.location::geometry), st_y(b.location::geometry), b.terminal_id,
    coalesce((
      select array_agg(distinct r.mode_code order by r.mode_code)
      from route_variant_stops rvs
      join route_variants v on v.id = rvs.variant_id
      join routes r on r.id = v.route_id
      join stops st on st.id = rvs.stop_id
      where (b.kind = 'stop' and st.id = b.id)
         or (b.kind = 'terminal' and st.terminal_id = b.id)
    ), '{}'::text[])
  from both_kinds b
  order by b.kind desc, b.name   -- terminals first
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------
-- How many locations the caller can see in total (for empty states).
-- ---------------------------------------------------------------------
create or replace function public.map_location_counts()
returns table (terminals bigint, stops bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select (select count(*) from terminals where status <> 'retired'),
         (select count(*) from stops where status <> 'retired');
$$;

-- ---------------------------------------------------------------------
-- Search LAKBAY's own terminals and stops by name, alternate name or town.
-- ---------------------------------------------------------------------
create or replace function public.search_locations(p_query text, p_limit integer default 8)
returns table (
  kind         text,
  id           uuid,
  name         text,
  municipality text,
  status       public.record_status,
  lon          double precision,
  lat          double precision,
  score        real
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_q text := private.normalize_name(left(coalesce(p_query, ''), 80));
  -- Escape LIKE wildcards typed by the user.
  v_like text;
begin
  if char_length(v_q) < 2 then
    return;
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with candidates as (
    select 'terminal'::text as kind, x.id, x.name, x.municipality, x.status, x.location, x.alt_names
    from terminals x where x.status <> 'retired'
    union all
    select 'stop'::text, x.id, x.name, x.municipality, x.status, x.location, x.alt_names
    from stops x where x.status <> 'retired'
  ),
  scored as (
    select c.*,
           greatest(
             similarity(private.normalize_name(c.name), v_q),
             case when private.normalize_name(c.name) like v_like then 0.9 else 0 end,
             case when exists (select 1 from unnest(c.alt_names) a where private.normalize_name(a) like v_like) then 0.8 else 0 end,
             case when private.normalize_name(c.municipality) like v_like then 0.5 else 0 end
           )::real as score
    from candidates c
  )
  select s.kind, s.id, s.name, s.municipality, s.status,
         st_x(s.location::geometry), st_y(s.location::geometry), s.score
  from scored s
  where s.score >= 0.3
  order by s.score desc, s.kind desc, s.name
  limit least(greatest(coalesce(p_limit, 8), 1), 20);
end;
$$;

-- ---------------------------------------------------------------------
-- Route variants that serve a terminal or a stop (for the details panel).
-- Pass exactly one of p_terminal_id / p_stop_id.
-- ---------------------------------------------------------------------
create or replace function public.routes_serving(p_terminal_id uuid default null, p_stop_id uuid default null)
returns table (
  variant_id       uuid,
  route_id         uuid,
  route_name       text,
  mode_code        text,
  mode_label       text,
  direction        public.route_direction,
  variant_name     text,
  signboard_text   text,
  status           public.record_status,
  last_verified_on date,
  has_geometry     boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (v.id)
    v.id, r.id, r.name, r.mode_code, m.label, v.direction, v.variant_name,
    coalesce(v.signboard_text, r.common_signboard), v.status, v.last_verified_on,
    exists (select 1 from route_geometries g where g.variant_id = v.id and g.is_current)
  from route_variants v
  join routes r on r.id = v.route_id
  join transport_modes m on m.code = r.mode_code
  join route_variant_stops rvs on rvs.variant_id = v.id
  join stops s on s.id = rvs.stop_id
  where num_nonnulls(p_terminal_id, p_stop_id) = 1
    and v.status <> 'retired' and r.status <> 'retired'
    and ((p_terminal_id is not null and s.terminal_id = p_terminal_id)
      or (p_stop_id is not null and s.id = p_stop_id))
  order by v.id;
$$;

-- ---------------------------------------------------------------------
-- Current geometry of one variant as a GeoJSON Feature (null if none
-- visible to the caller).
-- ---------------------------------------------------------------------
create or replace function public.route_variant_geojson(p_variant_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'type', 'Feature',
    'geometry', st_asgeojson(g.geom, 6)::jsonb,
    'properties', jsonb_build_object(
      'variant_id', v.id,
      'mode_code', r.mode_code,
      'length_m', g.length_m,
      'status', g.status,
      'last_verified_on', g.last_verified_on
    )
  )
  from route_geometries g
  join route_variants v on v.id = g.variant_id
  join routes r on r.id = v.route_id
  where g.variant_id = p_variant_id and g.is_current
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- Privileges (Supabase grants new functions to anon by default: revoke first)
-- ---------------------------------------------------------------------
revoke execute on function
  public.map_locations_in_bbox(double precision, double precision, double precision, double precision, integer),
  public.map_location_counts(),
  public.search_locations(text, integer),
  public.routes_serving(uuid, uuid),
  public.route_variant_geojson(uuid)
from public, anon, authenticated;

grant execute on function
  public.map_locations_in_bbox(double precision, double precision, double precision, double precision, integer),
  public.map_location_counts(),
  public.search_locations(text, integer),
  public.routes_serving(uuid, uuid),
  public.route_variant_geojson(uuid)
to anon, authenticated;


-- ===================== migrations/20261120000700_data_acquisition.sql =====================
-- =====================================================================
-- LAKBAY migration 7: data acquisition (source registry, import runs,
-- staging area, admin review queue) + stricter verification rule
-- =====================================================================
-- Imported data NEVER goes straight into the transport tables.
--   1. The pipeline writes candidates into public.staged_features.
--   2. A moderator reviews them in the admin review queue.
--   3. "Promote" creates a DRAFT record with the import cited as evidence.
--   4. Only a field survey, official document or operator source can then
--      make it 'verified' (rule enforced below). OpenStreetMap, GTFS hints
--      and community reports alone can never verify anything.

create type public.provider_status as enum ('approved', 'restricted', 'pending_review', 'rejected');
create type public.import_run_status as enum ('running', 'completed', 'failed');
create type public.staged_kind as enum ('terminal', 'stop', 'route');
create type public.staged_quality as enum ('ok', 'warning', 'blocked');
create type public.staged_review_status as enum ('pending', 'needs_info', 'promoted', 'linked', 'rejected');

-- ---------------------------------------------------------------------
-- 1. Data source registry
-- usage_status = 'approved' is required before the pipeline may import.
-- ---------------------------------------------------------------------
create table public.data_providers (
  code              text primary key check (code ~ '^[a-z][a-z0-9_]{2,40}$'),
  name              text not null check (char_length(name) between 3 and 160),
  provider_type     text not null check (provider_type in
                      ('community_map', 'government', 'operator', 'open_dataset', 'field_survey', 'commercial')),
  homepage_url      text check (homepage_url is null or homepage_url ~ '^https?://'),
  license_name      text not null check (char_length(license_name) between 2 and 160),
  license_url       text check (license_url is null or license_url ~ '^https?://'),
  attribution_text  text not null check (char_length(attribution_text) between 2 and 300),
  terms_url         text check (terms_url is null or terms_url ~ '^https?://'),
  access_method     text not null check (access_method in ('api', 'download', 'manual')),
  rate_limit_policy text check (rate_limit_policy is null or char_length(rate_limit_policy) <= 500),
  usage_status      public.provider_status not null default 'pending_review',
  usage_notes       text check (usage_notes is null or char_length(usage_notes) <= 2000),
  -- What a record from this provider may prove (see apply_verification).
  can_verify        boolean not null default false,
  last_reviewed_on  date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger data_providers_touch before update on public.data_providers
  for each row execute function private.touch_updated_at();
create trigger data_providers_audit after insert or update or delete on public.data_providers
  for each row execute function private.write_audit();

insert into public.data_providers
  (code, name, provider_type, homepage_url, license_name, license_url, attribution_text, terms_url,
   access_method, rate_limit_policy, usage_status, usage_notes, can_verify, last_reviewed_on)
values
  ('openstreetmap_overpass', 'OpenStreetMap (via Overpass API)', 'community_map',
   'https://www.openstreetmap.org', 'Open Database License (ODbL) 1.0', 'https://opendatacommons.org/licenses/odbl/1-0/',
   '© OpenStreetMap contributors', 'https://wiki.openstreetmap.org/wiki/Overpass_API',
   'api',
   'Public instance: about 10,000 queries and 1 GB per day for one-off use; divide by 100 for regular use; counted per application; identify with a custom User-Agent.',
   'approved',
   'Community-mapped. Route relations show where mappers recorded a service, not that it currently runs. ODbL share-alike applies to derivative databases: keep provenance so OSM-derived records can be exported.',
   false, '2026-11-20'),
  ('lakbay_field_survey', 'LAKBAY field surveys', 'field_survey',
   null, 'LAKBAY own data', null, 'LAKBAY field survey', null,
   'manual', null, 'approved',
   'Rides and walks recorded by LAKBAY researchers and trained mappers (docs/survey-protocol.md). Imported through the CSV importer with observer and date.',
   true, '2026-11-20'),
  ('ltfrb_issuances', 'LTFRB memorandum circulars and fare matrices', 'government',
   'https://ltfrb.gov.ph', 'Public government issuance (confirm reuse terms)', null,
   'Land Transportation Franchising and Regulatory Board', null,
   'manual', 'Do not scrape. Enter documents manually with circular number and date.', 'approved',
   'Official fares and franchise route descriptions.', true, '2026-11-20'),
  ('lgu_records', 'Municipal ordinances and route plans (Marilao, Meycauayan, Bocaue)', 'government',
   null, 'Public record (confirm reuse terms)', null, 'Municipal Government (named per document)', null,
   'manual', 'Request through FOI (foi.gov.ph) or the municipal hall.', 'approved',
   'Tricycle fare ordinances, Local Public Transport Route Plans (LPTRP), terminal designations.', true, '2026-11-20'),
  ('psa_psgc', 'PSA Philippine Standard Geographic Code', 'government',
   'https://psa.gov.ph/classification/psgc', 'Government open data (confirm terms)', null,
   'Philippine Statistics Authority', null,
   'download', null, 'approved',
   'Official names and codes of regions, provinces, cities, municipalities and barangays. Contains no coordinates.', false, '2026-11-20'),
  ('rail_operators', 'Rail operator publications (LRT-1, LRT-2, MRT-3, PNR)', 'operator',
   null, 'Operator publication (confirm reuse terms)', null, 'Named per document', null,
   'manual', 'Do not scrape. Record station lists and fare tables manually with the page URL and date.', 'approved',
   'Station names, operating hours and fare tables from official operator pages.', true, '2026-11-20'),
  ('dotc_ptis_gtfs', 'DOTC Philippine Transit Information Service GTFS (Metro Manila)', 'open_dataset',
   'https://github.com/sakayph/gtfs', 'Unclear: read the LICENSE file in the repository before use', null,
   'DOTC Philippine Transit App Challenge data', null,
   'download', 'One-time manual download.', 'pending_review',
   'Released for the Philippine Transit App Challenge. Metro Manila only, about a decade old. At most a hint for what to field-check. Approve only after the license is confirmed.',
   false, '2026-11-20'),
  ('sakay_ph', 'Sakay.ph', 'commercial', 'https://sakay.ph', 'Proprietary', null, 'Sakay.ph', null,
   'manual', null, 'rejected', 'Proprietary journey planner. Do not copy or scrape.', false, '2026-11-20'),
  ('google_maps', 'Google Maps', 'commercial', 'https://www.google.com/maps', 'Proprietary', null, 'Google', null,
   'manual', null, 'rejected', 'Terms prohibit extracting data. Do not copy coordinates or routes.', false, '2026-11-20');

-- ---------------------------------------------------------------------
-- 2. Import areas (where the pipeline has run). Boundaries come from
--    OpenStreetMap administrative relations at import time, never typed in.
-- ---------------------------------------------------------------------
create table public.import_areas (
  code                text primary key check (code ~ '^[a-z0-9][a-z0-9-]{2,60}$'),
  name                text not null,
  municipality        text not null,
  province            text not null,
  region              text,
  osm_admin_level     smallint,
  osm_parent_name     text,
  osm_parent_level    smallint,
  osm_relation_id     bigint,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger import_areas_touch before update on public.import_areas
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. Import runs (one per pipeline execution and area)
-- ---------------------------------------------------------------------
create table public.import_runs (
  id                 uuid primary key default gen_random_uuid(),
  provider_code      text not null references public.data_providers (code),
  area_code          text references public.import_areas (code),
  run_kind           text not null check (run_kind in ('osm_overpass', 'gtfs', 'csv')),
  status             public.import_run_status not null default 'running',
  params             jsonb not null default '{}'::jsonb,
  stats              jsonb not null default '{}'::jsonb,
  -- SHA-256 of the raw downloaded/loaded data, for reproducibility
  snapshot_sha256    text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  -- e.g. Overpass "timestamp_osm_base": how fresh the OSM data was
  upstream_timestamp timestamptz,
  error              text,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  created_by         uuid references public.profiles (id) on delete set null default auth.uid()
);
create index import_runs_provider_idx on public.import_runs (provider_code, started_at desc);

-- ---------------------------------------------------------------------
-- 4. Staging area: candidates waiting for review. NOT public, NOT used by
--    the app, routing or the map.
-- ---------------------------------------------------------------------
create table public.staged_features (
  id                     uuid primary key default gen_random_uuid(),
  provider_code          text not null references public.data_providers (code),
  -- Stable id in the provider, e.g. "osm:node/123", "gtfs:stop/ABC", "survey:MAR-T-001"
  external_id            text not null check (char_length(external_id) between 3 and 200),
  external_url           text check (external_url is null or external_url ~ '^https?://'),
  kind                   public.staged_kind not null,
  -- terminal: terminal_kind values; stop: stop_kind values; route: 'route'
  classification         text not null,
  name                   text,
  alt_names              text[] not null default '{}',
  ref                    text,
  operator_name          text,
  network                text,
  from_label             text,
  to_label               text,
  -- Possible transport_modes codes. Empty = unknown. Never a confirmed fact.
  mode_hints             text[] not null default '{}',
  mode_confidence        text not null default 'unknown' check (mode_confidence in ('tagged', 'inferred', 'unknown')),
  area_code              text references public.import_areas (code),
  municipality           text,
  province               text,
  location               extensions.geography(Point, 4326) check (location is null or private.in_philippines(location)),
  path                   extensions.geography(LineString, 4326),
  path_complete          boolean,
  raw_tags               jsonb not null default '{}'::jsonb,
  attributes             jsonb not null default '{}'::jsonb,
  issues                 jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  quality                public.staged_quality not null,
  upstream_version       text,
  upstream_timestamp     timestamptz,
  content_hash           text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  first_run_id           uuid not null references public.import_runs (id),
  last_run_id            uuid not null references public.import_runs (id),
  last_seen_at           timestamptz not null default now(),
  review_status          public.staged_review_status not null default 'pending',
  changed_since_review   boolean not null default false,
  batch_duplicate_of     uuid references public.staged_features (id) on delete set null,
  matched_table          text check (matched_table is null or matched_table in ('terminals', 'stops', 'routes')),
  matched_id             uuid,
  match_distance_m       numeric(9, 1),
  match_name_similarity  real,
  reviewed_by            uuid references public.profiles (id) on delete set null,
  reviewed_at            timestamptz,
  review_notes           text check (review_notes is null or char_length(review_notes) <= 2000),
  promoted_table         text check (promoted_table is null or promoted_table in ('terminals', 'stops', 'routes')),
  promoted_id            uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint staged_features_provider_external_uniq unique (provider_code, external_id),
  constraint staged_point_or_path check (
    (kind in ('terminal', 'stop') and path is null) or (kind = 'route' and location is null)
  )
);
create index staged_features_location_gix on public.staged_features using gist (location);
create index staged_features_queue_idx on public.staged_features (review_status, quality, kind);
create index staged_features_run_idx on public.staged_features (last_run_id);
create trigger staged_features_touch before update on public.staged_features
  for each row execute function private.touch_updated_at();

-- Ordered stop members of a staged route (as listed by the provider).
create table public.staged_route_members (
  route_id            uuid not null references public.staged_features (id) on delete cascade,
  member_seq          integer not null check (member_seq > 0),
  member_external_id  text not null,
  member_role         text,
  primary key (route_id, member_seq)
);

-- ---------------------------------------------------------------------
-- 5. Stricter verification: only field surveys, official documents and
--    operator sources can make a record 'verified'.
-- ---------------------------------------------------------------------
create or replace function private.apply_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
  v_id uuid;
  v_fk text;
  v_has_evidence boolean;
  v_has_primary boolean;
begin
  select t.tbl, t.id, t.fk into v_table, v_id, v_fk
  from (values
    ('operators', new.operator_id, 'operator_id'),
    ('terminals', new.terminal_id, 'terminal_id'),
    ('stops', new.stop_id, 'stop_id'),
    ('routes', new.route_id, 'route_id'),
    ('route_variants', new.route_variant_id, 'route_variant_id'),
    ('route_geometries', new.route_geometry_id, 'route_geometry_id'),
    ('fare_rules', new.fare_rule_id, 'fare_rule_id'),
    ('fare_matrices', new.fare_matrix_id, 'fare_matrix_id')
  ) as t (tbl, id, fk)
  where t.id is not null;

  if new.status_to in ('verified', 'needs_recheck') then
    execute format('select exists (select 1 from public.evidence where %I = $1)', v_fk)
      into v_has_evidence using v_id;
    if not v_has_evidence then
      raise exception 'Cannot mark % % as %: attach at least one source in public.evidence first',
        v_table, v_id, new.status_to using errcode = '23514';
    end if;
  end if;

  if new.status_to = 'verified' then
    execute format(
      'select exists (select 1 from public.evidence e join public.sources s on s.id = e.source_id
                      where e.%I = $1 and s.source_type in (''field_survey'', ''official_document'', ''operator''))', v_fk)
      into v_has_primary using v_id;
    if not v_has_primary then
      raise exception 'Cannot verify % %: OpenStreetMap, datasets or community reports alone cannot verify. Attach a field survey, official document or operator source.',
        v_table, v_id using errcode = '23514';
    end if;
  end if;

  if new.observed_on > private.today_ph() then
    raise exception 'observed_on cannot be in the future' using errcode = '22007';
  end if;

  perform set_config('lakbay.via_verification', 'on', true);
  execute format(
    'update public.%I set status = $1, last_verified_on = $2, next_review_on = $3 where id = $4',
    v_table
  ) using
    new.status_to,
    case when new.status_to in ('verified', 'needs_recheck') then new.observed_on end,
    new.next_review_on,
    v_id;
  perform set_config('lakbay.via_verification', 'off', true);

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Pipeline RPCs (moderators/admins only; SECURITY DEFINER with checks)
-- ---------------------------------------------------------------------
create or replace function private.require_moderator()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_moderator() then
    raise exception 'Only moderators and admins can run imports or review staged data' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.upsert_import_area(
  p_code text, p_name text, p_municipality text, p_province text, p_region text,
  p_admin_level smallint, p_parent_name text, p_parent_level smallint, p_relation_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_moderator();
  insert into public.import_areas
    (code, name, municipality, province, region, osm_admin_level, osm_parent_name, osm_parent_level, osm_relation_id)
  values (p_code, p_name, p_municipality, p_province, p_region, p_admin_level, p_parent_name, p_parent_level, p_relation_id)
  on conflict (code) do update set
    name = excluded.name, municipality = excluded.municipality, province = excluded.province,
    region = excluded.region, osm_admin_level = excluded.osm_admin_level,
    osm_parent_name = excluded.osm_parent_name, osm_parent_level = excluded.osm_parent_level,
    osm_relation_id = coalesce(excluded.osm_relation_id, public.import_areas.osm_relation_id);
end;
$$;

create or replace function public.start_import_run(
  p_provider_code text, p_area_code text, p_run_kind text, p_params jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.provider_status;
  v_id uuid;
begin
  perform private.require_moderator();
  select usage_status into v_status from public.data_providers where code = p_provider_code;
  if not found then
    raise exception 'Unknown data provider %', p_provider_code using errcode = 'P0002';
  end if;
  if v_status <> 'approved' then
    raise exception 'Provider % is %, not approved for import. Review its license first.', p_provider_code, v_status
      using errcode = '42501';
  end if;
  insert into public.import_runs (provider_code, area_code, run_kind, params, created_by)
  values (p_provider_code, p_area_code, p_run_kind, coalesce(p_params, '{}'::jsonb), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.finish_import_run(
  p_run_id uuid, p_status public.import_run_status, p_stats jsonb,
  p_snapshot_sha256 text default null, p_upstream_timestamp timestamptz default null, p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.import_runs%rowtype;
begin
  perform private.require_moderator();
  update public.import_runs
  set status = p_status, stats = coalesce(p_stats, '{}'::jsonb), snapshot_sha256 = p_snapshot_sha256,
      upstream_timestamp = p_upstream_timestamp, error = left(p_error, 2000), finished_at = now()
  where id = p_run_id and status = 'running'
  returning * into v_run;
  if not found then
    raise exception 'Run % not found or already finished', p_run_id using errcode = 'P0002';
  end if;

  -- Candidates from earlier runs of the same provider and area(s) that this
  -- completed run no longer contains: flag them (deleted or retagged upstream).
  -- Areas = the run's area_code, or params.area_codes for multi-area runs.
  if p_status = 'completed' then
    update public.staged_features
    set attributes = attributes || jsonb_build_object('missing_in_latest_run', true),
        changed_since_review = case when review_status in ('promoted', 'linked') then true else changed_since_review end
    where provider_code = v_run.provider_code
      and area_code is not null
      and (area_code = v_run.area_code
           or area_code in (select jsonb_array_elements_text(coalesce(v_run.params -> 'area_codes', '[]'::jsonb))))
      and last_run_id <> v_run.id
      and coalesce((attributes ->> 'missing_in_latest_run')::boolean, false) = false;
  end if;
end;
$$;

-- Inserts or updates candidates by (provider, external_id). Keeps review
-- decisions; flags changes that happen after a review.
create or replace function public.upsert_staged_features(p_run_id uuid, p_features jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.import_runs%rowtype;
  f jsonb;
  v_existing record;
  v_id uuid;
  v_location extensions.geography;
  v_path extensions.geography;
  v_attributes jsonb;
  v_inserted int := 0;
  v_updated int := 0;
  v_unchanged int := 0;
  v_changed_after_review int := 0;
  m jsonb;
  v_seq int;
begin
  perform private.require_moderator();
  select * into v_run from public.import_runs where id = p_run_id;
  if not found or v_run.status <> 'running' then
    raise exception 'Run % is not running', p_run_id using errcode = '22023';
  end if;
  if jsonb_typeof(p_features) <> 'array' or jsonb_array_length(p_features) > 500 then
    raise exception 'Send features as a JSON array of at most 500 items' using errcode = '22023';
  end if;

  for f in select * from jsonb_array_elements(p_features)
  loop
    v_location := null;
    v_path := null;
    v_attributes := coalesce(f -> 'attributes', '{}'::jsonb);
    if f ? 'lon' and f ? 'lat' and f ->> 'lon' is not null and f ->> 'lat' is not null then
      v_location := extensions.st_setsrid(
        extensions.st_makepoint((f ->> 'lon')::double precision, (f ->> 'lat')::double precision), 4326)::extensions.geography;
      -- Impossible coordinates (e.g. swapped) are NOT stored as a location;
      -- they are kept only as a note for the reviewer (the pipeline marks
      -- such candidates as blocked).
      if not private.in_philippines(v_location) then
        v_attributes := v_attributes || jsonb_build_object('rejected_coordinates',
                          jsonb_build_array((f ->> 'lon')::double precision, (f ->> 'lat')::double precision));
        v_location := null;
      end if;
    end if;
    if f ? 'path' and jsonb_typeof(f -> 'path') = 'object' then
      v_path := extensions.st_setsrid(extensions.st_geomfromgeojson((f -> 'path')::text), 4326)::extensions.geography;
    end if;

    select id, content_hash, review_status into v_existing
    from public.staged_features
    where provider_code = v_run.provider_code and external_id = f ->> 'external_id'
    for update;

    if not found then
      insert into public.staged_features (
        provider_code, external_id, external_url, kind, classification, name, alt_names, ref, operator_name,
        network, from_label, to_label, mode_hints, mode_confidence, area_code, municipality, province,
        location, path, path_complete, raw_tags, attributes, issues, quality, upstream_version,
        upstream_timestamp, content_hash, first_run_id, last_run_id
      ) values (
        v_run.provider_code, f ->> 'external_id', f ->> 'external_url', (f ->> 'kind')::public.staged_kind,
        f ->> 'classification', f ->> 'name',
        coalesce(array(select jsonb_array_elements_text(f -> 'alt_names')), '{}'),
        f ->> 'ref', f ->> 'operator_name', f ->> 'network', f ->> 'from_label', f ->> 'to_label',
        coalesce(array(select jsonb_array_elements_text(f -> 'mode_hints')), '{}'),
        coalesce(f ->> 'mode_confidence', 'unknown'),
        f ->> 'area_code', f ->> 'municipality', f ->> 'province',
        v_location, v_path, (f ->> 'path_complete')::boolean,
        coalesce(f -> 'raw_tags', '{}'::jsonb), v_attributes,
        coalesce(f -> 'issues', '[]'::jsonb), (f ->> 'quality')::public.staged_quality,
        f ->> 'upstream_version', (f ->> 'upstream_timestamp')::timestamptz,
        f ->> 'content_hash', v_run.id, v_run.id
      ) returning id into v_id;
      v_inserted := v_inserted + 1;
    elsif v_existing.content_hash = f ->> 'content_hash' then
      update public.staged_features
      set last_run_id = v_run.id, last_seen_at = now(),
          attributes = attributes - 'missing_in_latest_run'
      where id = v_existing.id;
      v_id := v_existing.id;
      v_unchanged := v_unchanged + 1;
    else
      update public.staged_features set
        external_url = f ->> 'external_url', classification = f ->> 'classification', name = f ->> 'name',
        alt_names = coalesce(array(select jsonb_array_elements_text(f -> 'alt_names')), '{}'),
        ref = f ->> 'ref', operator_name = f ->> 'operator_name', network = f ->> 'network',
        from_label = f ->> 'from_label', to_label = f ->> 'to_label',
        mode_hints = coalesce(array(select jsonb_array_elements_text(f -> 'mode_hints')), '{}'),
        mode_confidence = coalesce(f ->> 'mode_confidence', 'unknown'),
        area_code = coalesce(f ->> 'area_code', area_code),
        municipality = coalesce(f ->> 'municipality', municipality), province = coalesce(f ->> 'province', province),
        location = v_location, path = v_path, path_complete = (f ->> 'path_complete')::boolean,
        raw_tags = coalesce(f -> 'raw_tags', '{}'::jsonb), attributes = v_attributes,
        issues = coalesce(f -> 'issues', '[]'::jsonb), quality = (f ->> 'quality')::public.staged_quality,
        upstream_version = f ->> 'upstream_version', upstream_timestamp = (f ->> 'upstream_timestamp')::timestamptz,
        content_hash = f ->> 'content_hash', last_run_id = v_run.id, last_seen_at = now(),
        changed_since_review = changed_since_review or review_status in ('promoted', 'linked', 'rejected')
      where id = v_existing.id;
      v_id := v_existing.id;
      v_updated := v_updated + 1;
      if v_existing.review_status in ('promoted', 'linked', 'rejected') then
        v_changed_after_review := v_changed_after_review + 1;
      end if;
    end if;

    if f ->> 'kind' = 'route' then
      delete from public.staged_route_members where route_id = v_id;
      v_seq := 0;
      for m in select * from jsonb_array_elements(coalesce(f -> 'members', '[]'::jsonb))
      loop
        v_seq := v_seq + 1;
        insert into public.staged_route_members (route_id, member_seq, member_external_id, member_role)
        values (v_id, v_seq, m ->> 'external_id', m ->> 'role');
      end loop;
    end if;
  end loop;

  -- Resolve "duplicate within this batch" pointers sent by the pipeline.
  update public.staged_features s
  set batch_duplicate_of = d.id
  from jsonb_array_elements(p_features) f2
  join public.staged_features d
    on d.provider_code = v_run.provider_code and d.external_id = f2 ->> 'batch_duplicate_of'
  where f2 ->> 'batch_duplicate_of' is not null
    and s.provider_code = v_run.provider_code
    and s.external_id = f2 ->> 'external_id';

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged,
                            'changed_after_review', v_changed_after_review);
end;
$$;

-- Duplicate detection against records ALREADY in LAKBAY.
create or replace function public.match_staged_run(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  perform private.require_moderator();

  with candidates as (
    select s.id as staged_id, m.table_name, m.id as match_id, m.distance_m, m.sim
    from public.staged_features s
    cross join lateral (
      select x.table_name, x.id, x.distance_m, x.sim
      from (
        select 'terminals'::text as table_name, t.id,
               extensions.st_distance(t.location, s.location) as distance_m,
               extensions.similarity(private.normalize_name(t.name), private.normalize_name(coalesce(s.name, ''))) as sim
        from public.terminals t
        where s.kind = 'terminal' and t.status <> 'retired'
          and extensions.st_dwithin(t.location, s.location, 150)
        union all
        select 'stops', st.id,
               extensions.st_distance(st.location, s.location),
               extensions.similarity(private.normalize_name(st.name), private.normalize_name(coalesce(s.name, '')))
        from public.stops st
        where s.kind = 'stop' and st.status <> 'retired'
          and extensions.st_dwithin(st.location, s.location, 60)
      ) x
      where x.distance_m <= 15 or x.sim >= 0.35
      order by x.sim desc, x.distance_m
      limit 1
    ) m
    where s.last_run_id = p_run_id and s.location is not null and s.review_status in ('pending', 'needs_info')
  )
  update public.staged_features s
  set matched_table = c.table_name, matched_id = c.match_id,
      match_distance_m = round(c.distance_m::numeric, 1), match_name_similarity = c.sim
  from candidates c
  where s.id = c.staged_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Creates or reuses a source row that cites the staged record.
create or replace function private.source_for_staged(p_staged public.staged_features)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.data_providers%rowtype;
  v_run public.import_runs%rowtype;
  v_type public.source_type;
  v_id uuid;
  v_title text;
  v_observed date;
  v_published date;
begin
  select * into v_provider from public.data_providers where code = p_staged.provider_code;
  select * into v_run from public.import_runs where id = p_staged.last_run_id;

  v_type := case v_provider.provider_type
    when 'community_map' then 'openstreetmap'
    when 'field_survey' then 'field_survey'
    when 'government' then 'official_document'
    when 'operator' then 'operator'
    else 'other'
  end::public.source_type;

  -- CSV rows carry their own source details (field survey or document).
  if p_staged.attributes ? 'source' then
    v_type := coalesce(nullif(p_staged.attributes -> 'source' ->> 'type', ''), v_type::text)::public.source_type;
    v_title := left(p_staged.attributes -> 'source' ->> 'title', 300);
    v_observed := (p_staged.attributes -> 'source' ->> 'observed_on')::date;
    v_published := (p_staged.attributes -> 'source' ->> 'published_on')::date;
  end if;

  v_title := coalesce(v_title, left(format('%s: %s (%s)', v_provider.name, coalesce(p_staged.name, p_staged.ref, 'unnamed'),
                                           p_staged.external_id), 300));
  v_published := coalesce(v_published, p_staged.upstream_timestamp::date);
  if v_published is null and v_observed is null then
    v_published := coalesce(v_run.upstream_timestamp::date, v_run.started_at::date);
  end if;

  if p_staged.external_url is not null then
    select id into v_id from public.sources where lower(url) = lower(p_staged.external_url);
    if found then
      return v_id;
    end if;
  end if;

  insert into public.sources
    (source_type, title, url, publisher, document_number, published_on, observed_on, retrieved_at, notes)
  values (
    v_type, v_title, p_staged.external_url, left(v_provider.attribution_text, 160),
    left(p_staged.attributes -> 'source' ->> 'document_number', 120),
    v_published, v_observed, coalesce(v_run.finished_at, v_run.started_at),
    left(format('License: %s. Attribution: %s. Imported by the LAKBAY pipeline (run %s, %s).',
                v_provider.license_name, v_provider.attribution_text, v_run.id, p_staged.external_id), 2000)
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Promote a terminal/stop candidate to a DRAFT record.
create or replace function public.promote_staged_feature(
  p_staged_id uuid,
  p_municipality text default null,
  p_province text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.staged_features%rowtype;
  v_new uuid;
  v_source uuid;
  v_municipality text;
  v_province text;
  v_note text;
begin
  perform private.require_moderator();
  select * into s from public.staged_features where id = p_staged_id for update;
  if not found then
    raise exception 'Staged feature not found' using errcode = 'P0002';
  end if;
  if s.kind = 'route' then
    raise exception 'Use promote_staged_route for routes' using errcode = '22023';
  end if;
  if s.review_status not in ('pending', 'needs_info') then
    raise exception 'Already reviewed (%)', s.review_status using errcode = '22023';
  end if;
  if s.quality = 'blocked' then
    raise exception 'This candidate has blocking issues and cannot be promoted' using errcode = '22023';
  end if;
  if s.location is null or coalesce(btrim(s.name), '') = '' then
    raise exception 'A candidate needs real coordinates and a name before promotion' using errcode = '22023';
  end if;

  v_municipality := coalesce(nullif(btrim(p_municipality), ''), s.municipality);
  v_province := coalesce(nullif(btrim(p_province), ''), s.province);
  if v_municipality is null or v_province is null then
    raise exception 'Municipality and province are unknown for this candidate. Enter them (from your own knowledge or PSGC) to promote.'
      using errcode = '22023';
  end if;

  if s.kind = 'terminal' then
    insert into public.terminals (name, alt_names, terminal_kind, location, municipality, province, status, notes)
    values (btrim(s.name), s.alt_names, s.classification::public.terminal_kind, s.location, v_municipality, v_province, 'draft',
            left(concat_ws(' ', 'Imported candidate', s.external_id || '.', p_notes), 2000))
    returning id into v_new;
  else
    insert into public.stops (name, alt_names, stop_kind, location, municipality, province, status, notes)
    values (btrim(s.name), s.alt_names, s.classification::public.stop_kind, s.location, v_municipality, v_province, 'draft',
            left(concat_ws(' ', 'Imported candidate', s.external_id || '.', p_notes), 2000))
    returning id into v_new;
  end if;

  v_source := private.source_for_staged(s);
  v_note := format('Imported from %s (%s). Not verified: confirm on the ground.', s.provider_code, s.external_id);
  if s.kind = 'terminal' then
    insert into public.evidence (source_id, claim, terminal_id, note) values
      (v_source, 'existence', v_new, v_note), (v_source, 'location', v_new, v_note);
  else
    insert into public.evidence (source_id, claim, stop_id, note) values
      (v_source, 'existence', v_new, v_note), (v_source, 'location', v_new, v_note);
  end if;

  update public.staged_features
  set review_status = 'promoted', promoted_table = case s.kind when 'terminal' then 'terminals' else 'stops' end,
      promoted_id = v_new, reviewed_by = (select auth.uid()), reviewed_at = now(),
      review_notes = p_notes, changed_since_review = false
  where id = s.id;
  return v_new;
end;
$$;

-- Promote a route candidate to a DRAFT route + variant (+ geometry and
-- stops when they are available). The reviewer MUST choose the mode.
create or replace function public.promote_staged_route(
  p_staged_id uuid,
  p_mode_code text,
  p_direction public.route_direction default 'outbound',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.staged_features%rowtype;
  v_route uuid;
  v_variant uuid;
  v_source uuid;
  v_geometry uuid;
  v_seq int := 0;
  v_linked int := 0;
  v_skipped int := 0;
  v_last_stop uuid;
  v_stop uuid;
  mem record;
  v_name text;
  v_note text;
begin
  perform private.require_moderator();
  select * into s from public.staged_features where id = p_staged_id for update;
  if not found or s.kind <> 'route' then
    raise exception 'Route candidate not found' using errcode = 'P0002';
  end if;
  if s.review_status not in ('pending', 'needs_info') then
    raise exception 'Already reviewed (%)', s.review_status using errcode = '22023';
  end if;
  if s.quality = 'blocked' then
    raise exception 'This route candidate has blocking issues and cannot be promoted' using errcode = '22023';
  end if;
  if not exists (select 1 from public.transport_modes where code = p_mode_code and is_active) then
    raise exception 'Choose a valid transport mode' using errcode = '22023';
  end if;

  v_name := left(coalesce(nullif(btrim(s.name), ''), nullif(btrim(s.ref), '')), 160);
  if v_name is null or char_length(v_name) < 3 then
    raise exception 'The route candidate has no usable name' using errcode = '22023';
  end if;

  begin
    insert into public.routes (mode_code, name, description, status)
    values (p_mode_code, v_name,
            left(concat_ws(' ', 'Imported candidate', s.external_id || '.',
                           case when s.from_label is not null or s.to_label is not null
                                then format('Mapped from "%s" to "%s".', coalesce(s.from_label, '?'), coalesce(s.to_label, '?')) end,
                           p_notes), 2000),
            'draft')
    returning id into v_route;
  exception when unique_violation then
    raise exception 'A route with this mode and name already exists. Link to it or rename first.' using errcode = '23505';
  end;

  insert into public.route_variants (route_id, direction, variant_name, is_primary, status)
  values (v_route, p_direction,
          left(coalesce(nullif(concat_ws(' → ', s.from_label, s.to_label), ''), 'Main'), 80), true, 'draft')
  returning id into v_variant;

  if s.path is not null and coalesce(s.path_complete, false) then
    insert into public.route_geometries (variant_id, geom, capture_method, status)
    values (v_variant, s.path, case when s.provider_code like '%gtfs%' then 'imported' else 'osm' end, 'draft')
    returning id into v_geometry;
  end if;

  -- Ordered stops: only members already promoted or linked to real records.
  for mem in
    select m.member_seq, f.promoted_table, f.promoted_id, f.matched_table, f.matched_id, f.review_status
    from public.staged_route_members m
    left join public.staged_features f
      on f.provider_code = s.provider_code and f.external_id = m.member_external_id
    where m.route_id = s.id
    order by m.member_seq
  loop
    v_stop := case
      when mem.review_status = 'promoted' and mem.promoted_table = 'stops' then mem.promoted_id
      when mem.review_status = 'linked' and mem.matched_table = 'stops' then mem.matched_id
    end;
    if v_stop is null then
      v_skipped := v_skipped + 1;
    elsif v_stop is distinct from v_last_stop then
      v_seq := v_seq + 1;
      insert into public.route_variant_stops (variant_id, stop_sequence, stop_id) values (v_variant, v_seq, v_stop);
      v_last_stop := v_stop;
      v_linked := v_linked + 1;
    end if;
  end loop;

  v_source := private.source_for_staged(s);
  v_note := format('Imported from %s (%s). A mapped route is not proof that the service runs today.', s.provider_code, s.external_id);
  insert into public.evidence (source_id, claim, route_id, note) values (v_source, 'existence', v_route, v_note);
  insert into public.evidence (source_id, claim, route_variant_id, note) values (v_source, 'stops', v_variant, v_note);
  if v_geometry is not null then
    insert into public.evidence (source_id, claim, route_geometry_id, note) values (v_source, 'path', v_geometry, v_note);
  end if;

  update public.staged_features
  set review_status = 'promoted', promoted_table = 'routes', promoted_id = v_route,
      reviewed_by = (select auth.uid()), reviewed_at = now(), review_notes = p_notes, changed_since_review = false
  where id = s.id;

  return jsonb_build_object('route_id', v_route, 'variant_id', v_variant, 'geometry_added', v_geometry is not null,
                            'stops_linked', v_linked, 'stops_skipped', v_skipped);
end;
$$;

-- The candidate is the same as an existing LAKBAY record: cite it there.
create or replace function public.link_staged_feature(p_staged_id uuid, p_target_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.staged_features%rowtype;
  v_table text;
  v_source uuid;
  v_note text;
  v_exists boolean;
begin
  perform private.require_moderator();
  select * into s from public.staged_features where id = p_staged_id for update;
  if not found then
    raise exception 'Staged feature not found' using errcode = 'P0002';
  end if;
  if s.review_status not in ('pending', 'needs_info') and not s.changed_since_review then
    raise exception 'Already reviewed (%)', s.review_status using errcode = '22023';
  end if;
  v_table := case s.kind when 'terminal' then 'terminals' when 'stop' then 'stops' else 'routes' end;
  -- (EXECUTE does not set FOUND, so ask for a boolean explicitly.)
  execute format('select exists (select 1 from public.%I where id = $1)', v_table) into v_exists using p_target_id;
  if not v_exists then
    raise exception 'No % record with that id', v_table using errcode = 'P0002';
  end if;

  v_source := private.source_for_staged(s);
  v_note := format('Matched import %s (%s). Not verified by itself.', s.external_id, s.provider_code);
  if v_table = 'terminals' then
    insert into public.evidence (source_id, claim, terminal_id, note) values (v_source, 'location', p_target_id, v_note);
  elsif v_table = 'stops' then
    insert into public.evidence (source_id, claim, stop_id, note) values (v_source, 'location', p_target_id, v_note);
  else
    insert into public.evidence (source_id, claim, route_id, note) values (v_source, 'existence', p_target_id, v_note);
  end if;

  update public.staged_features
  set review_status = 'linked', matched_table = v_table, matched_id = p_target_id,
      reviewed_by = (select auth.uid()), reviewed_at = now(), review_notes = p_notes, changed_since_review = false
  where id = s.id;
end;
$$;

create or replace function public.reject_staged_feature(p_staged_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_moderator();
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for rejecting' using errcode = '22023';
  end if;
  update public.staged_features
  set review_status = 'rejected', review_notes = left(p_reason, 2000),
      reviewed_by = (select auth.uid()), reviewed_at = now(), changed_since_review = false
  where id = p_staged_id and review_status in ('pending', 'needs_info', 'rejected');
  if not found then
    raise exception 'Staged feature not found or already promoted/linked' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.mark_staged_needs_info(p_staged_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_moderator();
  update public.staged_features
  set review_status = 'needs_info', review_notes = left(p_note, 2000),
      reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = p_staged_id and review_status in ('pending', 'needs_info');
  if not found then
    raise exception 'Staged feature not found or already decided' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Admin review queue (moderators see it through RLS on staged_features)
-- ---------------------------------------------------------------------
create view public.admin_review_queue with (security_invoker = true) as
select
  s.id, s.kind, s.classification, s.name, s.alt_names, s.ref, s.from_label, s.to_label,
  s.mode_hints, s.mode_confidence, s.quality, s.issues, jsonb_array_length(s.issues) as issue_count,
  s.review_status, s.changed_since_review,
  coalesce((s.attributes ->> 'missing_in_latest_run')::boolean, false) as missing_upstream,
  s.provider_code, p.name as provider_name, p.attribution_text, s.external_id, s.external_url,
  s.area_code, s.municipality, s.province,
  extensions.st_x(s.location::extensions.geometry) as lon,
  extensions.st_y(s.location::extensions.geometry) as lat,
  s.path is not null as has_path, s.path_complete,
  (select count(*) from public.staged_route_members m where m.route_id = s.id) as member_count,
  s.batch_duplicate_of, s.matched_table, s.matched_id, s.match_distance_m, s.match_name_similarity,
  coalesce(t.name, st.name) as matched_name,
  s.raw_tags, s.upstream_timestamp, s.last_seen_at, s.review_notes
from public.staged_features s
join public.data_providers p on p.code = s.provider_code
left join public.terminals t on s.matched_table = 'terminals' and t.id = s.matched_id
left join public.stops st on s.matched_table = 'stops' and st.id = s.matched_id
where s.review_status in ('pending', 'needs_info') or s.changed_since_review;

-- ---------------------------------------------------------------------
-- 8. Privileges and RLS
-- ---------------------------------------------------------------------
alter table public.data_providers enable row level security;
alter table public.import_areas enable row level security;
alter table public.import_runs enable row level security;
alter table public.staged_features enable row level security;
alter table public.staged_route_members enable row level security;

revoke all on public.data_providers, public.import_areas, public.import_runs,
  public.staged_features, public.staged_route_members, public.admin_review_queue from anon, authenticated;

-- The registry is public on purpose (transparency about sources).
grant select on public.data_providers, public.import_areas to anon, authenticated;
grant insert, update on public.data_providers to authenticated;          -- admins only (policy)
grant select on public.import_runs, public.staged_features, public.staged_route_members,
  public.admin_review_queue to authenticated;                               -- moderators only (policy)

create policy "anyone reads the source registry" on public.data_providers for select to anon, authenticated using (true);
create policy "admins add providers" on public.data_providers for insert to authenticated with check (private.has_role('admin'));
create policy "admins edit providers" on public.data_providers for update to authenticated
  using (private.has_role('admin')) with check (private.has_role('admin'));
create policy "anyone reads import areas" on public.import_areas for select to anon, authenticated using (true);
create policy "moderators read runs" on public.import_runs for select to authenticated using (private.is_moderator());
create policy "moderators read staged" on public.staged_features for select to authenticated using (private.is_moderator());
create policy "moderators read staged members" on public.staged_route_members for select to authenticated using (private.is_moderator());

revoke execute on function
  public.upsert_import_area(text, text, text, text, text, smallint, text, smallint, bigint),
  public.start_import_run(text, text, text, jsonb),
  public.finish_import_run(uuid, public.import_run_status, jsonb, text, timestamptz, text),
  public.upsert_staged_features(uuid, jsonb),
  public.match_staged_run(uuid),
  public.promote_staged_feature(uuid, text, text, text),
  public.promote_staged_route(uuid, text, public.route_direction, text),
  public.link_staged_feature(uuid, uuid, text),
  public.reject_staged_feature(uuid, text),
  public.mark_staged_needs_info(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.upsert_import_area(text, text, text, text, text, smallint, text, smallint, bigint),
  public.start_import_run(text, text, text, jsonb),
  public.finish_import_run(uuid, public.import_run_status, jsonb, text, timestamptz, text),
  public.upsert_staged_features(uuid, jsonb),
  public.match_staged_run(uuid),
  public.promote_staged_feature(uuid, text, text, text),
  public.promote_staged_route(uuid, text, public.route_direction, text),
  public.link_staged_feature(uuid, uuid, text),
  public.reject_staged_feature(uuid, text),
  public.mark_staged_needs_info(uuid, text)
to authenticated;

revoke all on function private.require_moderator(), private.source_for_staged(public.staged_features) from public;
grant execute on function private.require_moderator() to authenticated;


-- ===================== migrations/20261121000800_field_verification.sql =====================
-- =====================================================================
-- LAKBAY migration 8: field verification
--
-- A moderator standing at a terminal/stop (or riding a route) records what
-- they saw. One call to submit_field_check() then:
--   1. checks the phone's GPS position and accuracy against the record,
--   2. stores the observation privately in field_checks,
--   3. creates a field_survey source + evidence (public once the record is),
--   4. inserts the verification record that changes the status.
--
-- Rules:
--   * "Confirmed" needs a GPS fix close to the record. Coordinates are never
--     typed by hand. If the place moved, "moved" replaces the location with
--     the measured GPS point.
--   * "Not found" on a draft only logs the visit (one visit is not enough to
--     delete anything). On a public record it sets needs_recheck.
--   * A fare paid is stored as an observation (evidence), never as an
--     official fare rule.
--   * Exact GPS positions and free notes stay private (moderators only).
-- Depends on migrations 1 to 7.
-- =====================================================================

create type public.field_outcome as enum ('confirmed', 'moved', 'not_found', 'closed', 'unsure');

create table public.field_checks (
  id                uuid primary key default gen_random_uuid(),
  terminal_id       uuid references public.terminals (id) on delete cascade,
  stop_id           uuid references public.stops (id) on delete cascade,
  route_variant_id  uuid references public.route_variants (id) on delete cascade,
  outcome           public.field_outcome not null,
  observed_at       timestamptz not null,
  position          extensions.geography(Point, 4326),
  gps_accuracy_m    numeric(7, 1) check (gps_accuracy_m is null or gps_accuracy_m > 0),
  distance_m        numeric(9, 1),
  previous_location extensions.geography(Point, 4326),
  signboard_text    text check (signboard_text is null or char_length(signboard_text) <= 120),
  fare_paid         numeric(7, 2) check (fare_paid is null or (fare_paid > 0 and fare_paid < 2000)),
  boarded_stop_id   uuid references public.stops (id) on delete set null,
  alighted_stop_id  uuid references public.stops (id) on delete set null,
  line_matches      boolean,
  notes             text check (notes is null or char_length(notes) <= 2000),
  status_before     public.record_status not null,
  status_after      public.record_status not null,
  source_id         uuid references public.sources (id) on delete set null,
  checked_by        uuid not null references public.profiles (id) on delete restrict default auth.uid(),
  created_at        timestamptz not null default now(),
  constraint field_checks_one_target check (num_nonnulls(terminal_id, stop_id, route_variant_id) = 1)
);
create index field_checks_terminal_idx on public.field_checks (terminal_id, created_at desc) where terminal_id is not null;
create index field_checks_stop_idx on public.field_checks (stop_id, created_at desc) where stop_id is not null;
create index field_checks_variant_idx on public.field_checks (route_variant_id, created_at desc) where route_variant_id is not null;
comment on table public.field_checks is 'Private log of on-site checks by moderators (GPS, notes). Public users only see the resulting source/verification.';

-- ---------------------------------------------------------------------
-- Settings (one place to change them)
-- ---------------------------------------------------------------------
create or replace function private.field_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'max_accuracy_stop_m', 35,      -- GPS must be at least this good at a stop
    'max_accuracy_terminal_m', 60,
    'tolerance_stop_m', 30,         -- allowed distance = accuracy + tolerance
    'tolerance_terminal_m', 120,    -- terminals are big
    'max_move_m', 500,              -- farther than this: it is a different place
    'max_age_days', 14,             -- checks must be entered within 14 days
    'review_days_place', 180,
    'review_days_route', 90
  );
$$;

-- ---------------------------------------------------------------------
-- Records to check near the moderator (drafts first, then overdue)
-- ---------------------------------------------------------------------
create or replace function public.field_check_nearby(
  p_lon double precision,
  p_lat double precision,
  p_radius_m integer default 2000,
  p_limit integer default 60
)
returns table (
  kind text, id uuid, name text, subtype text, municipality text,
  status public.record_status, last_verified_on date, next_review_on date,
  lon double precision, lat double precision, distance_m double precision, due boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_here extensions.geography;
  v_today date := private.today_ph();
begin
  perform private.require_moderator();
  if p_radius_m is null or p_radius_m < 50 or p_radius_m > 20000 then
    raise exception 'Radius must be between 50 m and 20 km' using errcode = '22023';
  end if;
  v_here := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography;

  return query
  select x.kind, x.id, x.name, x.subtype, x.municipality, x.status, x.last_verified_on, x.next_review_on,
         extensions.st_x(x.location::extensions.geometry), extensions.st_y(x.location::extensions.geometry),
         extensions.st_distance(x.location, v_here)::double precision,
         (x.status <> 'verified' or x.next_review_on is null or x.next_review_on <= v_today)
  from (
    select 'terminal'::text as kind, t.id, t.name, t.terminal_kind::text as subtype, t.municipality, t.status,
           t.last_verified_on, t.next_review_on, t.location
    from public.terminals t where t.status <> 'retired'
    union all
    select 'stop', s.id, s.name, s.stop_kind::text, s.municipality, s.status, s.last_verified_on, s.next_review_on, s.location
    from public.stops s where s.status <> 'retired'
  ) x
  where extensions.st_dwithin(x.location, v_here, p_radius_m)
  order by (x.status <> 'verified' or x.next_review_on is null or x.next_review_on <= v_today) desc,
           extensions.st_distance(x.location, v_here)
  limit least(greatest(coalesce(p_limit, 60), 1), 200);
end;
$$;

-- ---------------------------------------------------------------------
-- Route variants to ride (with their stops in order)
-- ---------------------------------------------------------------------
create or replace function public.field_check_routes(p_search text default null, p_limit integer default 50)
returns table (
  variant_id uuid, route_id uuid, route_name text, mode_code text, direction public.route_direction,
  variant_name text, signboard_text text, variant_status public.record_status, route_status public.record_status,
  last_verified_on date, next_review_on date, has_geometry boolean, stops jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_moderator();
  return query
  select v.id, r.id, r.name, r.mode_code, v.direction, v.variant_name,
         coalesce(v.signboard_text, r.common_signboard), v.status, r.status, v.last_verified_on, v.next_review_on,
         exists (select 1 from public.route_geometries g where g.variant_id = v.id and g.is_current),
         coalesce((
           select jsonb_agg(jsonb_build_object('seq', rvs.stop_sequence, 'id', s.id, 'name', s.name, 'status', s.status)
                            order by rvs.stop_sequence)
           from public.route_variant_stops rvs join public.stops s on s.id = rvs.stop_id
           where rvs.variant_id = v.id), '[]'::jsonb)
  from public.route_variants v
  join public.routes r on r.id = v.route_id
  where v.status <> 'retired' and r.status <> 'retired'
    and (p_search is null or btrim(p_search) = ''
         or r.name ilike '%' || btrim(p_search) || '%'
         or coalesce(v.signboard_text, r.common_signboard, '') ilike '%' || btrim(p_search) || '%')
  order by (v.status <> 'verified') desc, r.name, v.direction
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- ---------------------------------------------------------------------
-- Helper: one field-survey source per check, with evidence on a target
-- ---------------------------------------------------------------------
create or replace function private.field_evidence(p_source uuid, p_claim public.evidence_claim, p_fk text, p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  execute format('insert into public.evidence (source_id, claim, note, %I) values ($1, $2, $3, $4)', p_fk)
    using p_source, p_claim, left(p_note, 1000), p_id;
end;
$$;

create or replace function private.field_verify(p_fk text, p_id uuid, p_status public.record_status,
                                                p_observed date, p_review_days int, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  execute format(
    'insert into public.verification_records (status_to, method, observed_on, next_review_on, notes, %I)
     values ($1, ''field_survey'', $2, $3, $4, $5)', p_fk)
    using p_status, p_observed,
          case when p_status in ('verified', 'needs_recheck') then p_observed + p_review_days end,
          p_note, p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- The one entry point used by the app
-- ---------------------------------------------------------------------
create or replace function public.submit_field_check(
  p_target_kind text,                 -- 'terminal' | 'stop' | 'route_variant'
  p_target_id uuid,
  p_outcome public.field_outcome,
  p_observed_at timestamptz,
  p_lon double precision default null,
  p_lat double precision default null,
  p_accuracy_m double precision default null,
  p_signboard_text text default null,
  p_fare_paid numeric default null,
  p_boarded_stop_id uuid default null,
  p_alighted_stop_id uuid default null,
  p_line_matches boolean default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb := private.field_rules();
  v_table text;
  v_fk text;
  v_name text;
  v_status public.record_status;
  v_new_status public.record_status;
  v_location extensions.geography;
  v_position extensions.geography;
  v_distance double precision;
  v_max_acc double precision;
  v_allowed double precision;
  v_observed date;
  v_source uuid;
  v_check uuid;
  v_route uuid;
  v_route_status public.record_status;
  v_direction public.route_direction;
  v_seq_on smallint;
  v_seq_off smallint;
  v_on_name text;
  v_off_name text;
  v_geometry uuid;
  v_unverified_stops int := 0;
  v_messages text[] := '{}';
begin
  perform private.require_moderator();

  -- ---- when ----
  if p_observed_at is null or p_observed_at > now() + interval '5 minutes' then
    raise exception 'The check time cannot be in the future' using errcode = '22007';
  end if;
  if p_observed_at < now() - make_interval(days => (r ->> 'max_age_days')::int) then
    raise exception 'Checks must be entered within % days of the visit', r ->> 'max_age_days' using errcode = '22007';
  end if;
  v_observed := (p_observed_at at time zone 'Asia/Manila')::date;

  if p_notes is not null and char_length(p_notes) > 2000 then
    raise exception 'Notes are too long (max 2000 characters)' using errcode = '22001';
  end if;

  -- ---- where ----
  if (p_lon is null) <> (p_lat is null) then
    raise exception 'Give both longitude and latitude, or neither' using errcode = '22023';
  end if;
  if p_lon is not null then
    if p_accuracy_m is null or p_accuracy_m <= 0 then
      raise exception 'A GPS position needs its accuracy (from the phone)' using errcode = '22023';
    end if;
    v_position := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography;
    if not private.in_philippines(v_position) then
      raise exception 'The GPS position is outside the Philippines' using errcode = '22023';
    end if;
  end if;

  -- ---- what ----
  v_table := case p_target_kind when 'terminal' then 'terminals' when 'stop' then 'stops'
                                when 'route_variant' then 'route_variants' end;
  if v_table is null then
    raise exception 'Unknown target kind %', p_target_kind using errcode = '22023';
  end if;
  v_fk := case p_target_kind when 'terminal' then 'terminal_id' when 'stop' then 'stop_id' else 'route_variant_id' end;

  if p_target_kind in ('terminal', 'stop') then
    execute format('select name, status, location from public.%I where id = $1 for update', v_table)
      into v_name, v_status, v_location using p_target_id;
    if v_name is null then
      raise exception '% not found', p_target_kind using errcode = 'P0002';
    end if;

    if p_outcome in ('confirmed', 'moved', 'not_found') then
      if v_position is null then
        raise exception 'This outcome needs your GPS position: be at the place and allow location' using errcode = '22023';
      end if;
      v_max_acc := (r ->> case when p_target_kind = 'stop' then 'max_accuracy_stop_m' else 'max_accuracy_terminal_m' end)::double precision;
      if p_accuracy_m > v_max_acc then
        raise exception 'GPS accuracy is % m; it must be % m or better. Wait outside, away from tall buildings, and try again.',
          round(p_accuracy_m::numeric), v_max_acc using errcode = '22023';
      end if;
      v_distance := extensions.st_distance(v_location, v_position);
      v_allowed := p_accuracy_m + (r ->> case when p_target_kind = 'stop' then 'tolerance_stop_m' else 'tolerance_terminal_m' end)::double precision;
      if p_outcome in ('confirmed', 'not_found') and v_distance > v_allowed then
        raise exception 'You are % m from the recorded spot (allowed: % m). Go closer, or choose "moved" if it is really here.',
          round(v_distance::numeric), round(v_allowed::numeric) using errcode = '22023';
      end if;
      if p_outcome = 'moved' then
        if v_distance > (r ->> 'max_move_m')::double precision then
          raise exception 'That is % m away: treat it as a different place, not a move', round(v_distance::numeric) using errcode = '22023';
        end if;
        if v_distance <= p_accuracy_m then
          raise exception 'You are within GPS accuracy of the recorded spot: choose "confirmed" instead' using errcode = '22023';
        end if;
      end if;
    end if;
    if p_fare_paid is not null or p_boarded_stop_id is not null or p_alighted_stop_id is not null or p_line_matches is not null then
      raise exception 'Fare, boarding/alighting and line answers only apply to routes' using errcode = '22023';
    end if;
  else
    select coalesce(v.variant_name, 'Main'), v.status, v.route_id, v.direction, r2.status,
           r2.name || ' (' || v.direction || ')'
      into v_name, v_status, v_route, v_direction, v_route_status, v_name
    from public.route_variants v join public.routes r2 on r2.id = v.route_id
    where v.id = p_target_id
    for update of v;
    if v_route is null then
      raise exception 'Route variant not found' using errcode = 'P0002';
    end if;

    if p_outcome = 'confirmed' then
      if p_boarded_stop_id is null or p_alighted_stop_id is null or p_boarded_stop_id = p_alighted_stop_id then
        raise exception 'Choose the stop where you boarded and the stop where you got off' using errcode = '22023';
      end if;
      select min(stop_sequence), max(s.name) into v_seq_on, v_on_name
        from public.route_variant_stops rvs join public.stops s on s.id = rvs.stop_id
        where rvs.variant_id = p_target_id and rvs.stop_id = p_boarded_stop_id;
      select max(stop_sequence), max(s.name) into v_seq_off, v_off_name
        from public.route_variant_stops rvs join public.stops s on s.id = rvs.stop_id
        where rvs.variant_id = p_target_id and rvs.stop_id = p_alighted_stop_id;
      if v_seq_on is null or v_seq_off is null then
        raise exception 'Both stops must be stops of this route' using errcode = '22023';
      end if;
      if v_direction in ('outbound', 'inbound') and v_seq_on >= v_seq_off then
        raise exception 'The boarding stop must come before the alighting stop on this route' using errcode = '22023';
      end if;
    elsif p_fare_paid is not null then
      raise exception 'A fare can only be recorded when you rode the route' using errcode = '22023';
    end if;
    if v_position is not null then
      v_distance := null; -- position is kept as context only for rides
    end if;
  end if;

  -- ---- decide the new status ----
  v_new_status := case
    when p_outcome in ('confirmed', 'moved') then 'verified'
    when p_outcome = 'closed' then 'retired'
    when p_outcome = 'not_found' and v_status in ('verified', 'needs_recheck') then 'needs_recheck'
    else v_status   -- unsure, or not found on a draft: only logged
  end::public.record_status;

  -- ---- source (public once the record is public: keep it free of personal notes) ----
  if v_new_status is distinct from v_status or p_outcome in ('confirmed', 'moved') then
    insert into public.sources (source_type, title, publisher, observed_on, observer_id, notes)
    values ('field_survey', left('LAKBAY field check: ' || v_name || ' (' || v_observed || ')', 300),
            'LAKBAY field team', v_observed, auth.uid(),
            'On-site check, outcome: ' || p_outcome::text || '.')
    returning id into v_source;
  end if;

  -- ---- apply ----
  if p_target_kind in ('terminal', 'stop') then
    if p_outcome = 'moved' then
      execute format('update public.%I set location = $1 where id = $2', v_table) using v_position, p_target_id;
      v_messages := v_messages || ('Location updated by ' || round(v_distance::numeric) || ' m.');
    end if;
    if v_source is not null then
      perform private.field_evidence(v_source, 'existence', v_fk, p_target_id,
        case p_outcome when 'not_found' then 'Not found on site.' when 'closed' then 'Closed / no longer used.' else 'Seen on site.' end);
      if p_outcome in ('confirmed', 'moved') then
        perform private.field_evidence(v_source, 'location', v_fk, p_target_id,
          'Location checked with phone GPS (accuracy ' || round(p_accuracy_m::numeric) || ' m).');
      end if;
      if p_signboard_text is not null and btrim(p_signboard_text) <> '' then
        perform private.field_evidence(v_source, 'signboard', v_fk, p_target_id, 'Sign reads: ' || btrim(p_signboard_text));
      end if;
    end if;
    if v_new_status is distinct from v_status or p_outcome in ('confirmed', 'moved') then
      perform private.field_verify(v_fk, p_target_id, v_new_status, v_observed, (r ->> 'review_days_place')::int,
                                   'Field check: ' || p_outcome::text);
    end if;
  else
    if v_source is not null then
      perform private.field_evidence(v_source, 'existence', v_fk, p_target_id,
        case p_outcome when 'confirmed' then 'Rode from ' || v_on_name || ' to ' || v_off_name || '.'
                       when 'not_found' then 'Not found on site.' else 'Reported closed.' end);
      if p_outcome = 'confirmed' then
        perform private.field_evidence(v_source, 'stops', v_fk, p_target_id,
          'Boarded at ' || v_on_name || ', got off at ' || v_off_name || '.');
      end if;
      if p_signboard_text is not null and btrim(p_signboard_text) <> '' then
        perform private.field_evidence(v_source, 'signboard', v_fk, p_target_id, 'Signboard reads: ' || btrim(p_signboard_text));
        update public.route_variants set signboard_text = left(btrim(p_signboard_text), 120)
        where id = p_target_id and signboard_text is null;
      end if;
      if p_fare_paid is not null then
        perform private.field_evidence(v_source, 'fare', v_fk, p_target_id,
          'Observed fare paid: PHP ' || p_fare_paid || ' from ' || v_on_name || ' to ' || v_off_name
          || ' on ' || v_observed || '. One observation, not an official fare.');
      end if;
    end if;
    if v_new_status is distinct from v_status or p_outcome = 'confirmed' then
      perform private.field_verify(v_fk, p_target_id, v_new_status, v_observed, (r ->> 'review_days_route')::int,
                                   'Field check: ' || p_outcome::text);
    end if;

    if p_outcome = 'confirmed' then
      -- The parent route exists too.
      if v_route_status <> 'verified' then
        perform private.field_evidence(v_source, 'existence', 'route_id', v_route, 'A variant was ridden on ' || v_observed || '.');
        perform private.field_verify('route_id', v_route, 'verified', v_observed, (r ->> 'review_days_route')::int,
                                     'Field check of a variant');
      end if;
      -- The line on the map: only when the rider says it matches.
      select g.id into v_geometry from public.route_geometries g where g.variant_id = p_target_id and g.is_current;
      if v_geometry is not null and p_line_matches is true then
        perform private.field_evidence(v_source, 'path', 'route_geometry_id', v_geometry, 'Rider confirmed the line matches the ride.');
        perform private.field_verify('route_geometry_id', v_geometry, 'verified', v_observed, (r ->> 'review_days_route')::int,
                                     'Line confirmed during ride');
      elsif v_geometry is not null and p_line_matches is false then
        v_messages := v_messages || 'The line was NOT verified (you said it does not match).'::text;
      end if;
      select count(*) into v_unverified_stops
      from public.route_variant_stops rvs join public.stops s on s.id = rvs.stop_id
      where rvs.variant_id = p_target_id and s.status <> 'verified';
      if v_unverified_stops > 0 then
        v_messages := v_messages || (v_unverified_stops || ' stops of this route are not verified yet; check them too.');
      end if;
    elsif p_outcome = 'closed' then
      v_messages := v_messages || 'Only this variant was retired; the route itself was not changed.'::text;
    end if;
  end if;

  if p_outcome = 'not_found' and v_new_status = v_status then
    v_messages := v_messages || 'Logged only: one visit is not enough to remove a draft. Mark it closed if you are sure.'::text;
  end if;

  insert into public.field_checks (
    terminal_id, stop_id, route_variant_id, outcome, observed_at, position, gps_accuracy_m, distance_m,
    previous_location, signboard_text, fare_paid, boarded_stop_id, alighted_stop_id, line_matches, notes,
    status_before, status_after, source_id
  ) values (
    case when p_target_kind = 'terminal' then p_target_id end,
    case when p_target_kind = 'stop' then p_target_id end,
    case when p_target_kind = 'route_variant' then p_target_id end,
    p_outcome, p_observed_at, v_position, p_accuracy_m, v_distance,
    case when p_outcome = 'moved' then v_location end,
    nullif(btrim(coalesce(p_signboard_text, '')), ''), p_fare_paid, p_boarded_stop_id, p_alighted_stop_id, p_line_matches,
    nullif(btrim(coalesce(p_notes, '')), ''), v_status, v_new_status, v_source
  ) returning id into v_check;

  return jsonb_build_object(
    'check_id', v_check, 'status_before', v_status, 'status_after', v_new_status,
    'distance_m', round(v_distance::numeric, 1), 'messages', to_jsonb(v_messages)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------
alter table public.field_checks enable row level security;
revoke all on public.field_checks from anon, authenticated;
grant select on public.field_checks to authenticated;
create policy "moderators read field checks" on public.field_checks for select to authenticated using (private.is_moderator());

revoke execute on function
  public.field_check_nearby(double precision, double precision, integer, integer),
  public.field_check_routes(text, integer),
  public.submit_field_check(text, uuid, public.field_outcome, timestamptz, double precision, double precision,
                            double precision, text, numeric, uuid, uuid, boolean, text)
from public, anon, authenticated;
grant execute on function
  public.field_check_nearby(double precision, double precision, integer, integer),
  public.field_check_routes(text, integer),
  public.submit_field_check(text, uuid, public.field_outcome, timestamptz, double precision, double precision,
                            double precision, text, numeric, uuid, uuid, boolean, text)
to authenticated;

revoke all on function private.field_rules(), private.field_evidence(uuid, public.evidence_claim, text, uuid, text),
  private.field_verify(text, uuid, public.record_status, date, int, text) from public;

commit;
select 'LAKBAY DATABASE SETUP COMPLETE' as result;
