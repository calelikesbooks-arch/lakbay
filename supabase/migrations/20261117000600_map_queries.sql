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
