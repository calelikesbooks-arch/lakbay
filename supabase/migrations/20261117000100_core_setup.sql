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
