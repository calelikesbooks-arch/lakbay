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
