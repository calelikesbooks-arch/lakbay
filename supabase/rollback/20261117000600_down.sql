-- Rollback of migration 6 (map queries). Safe on its own. Data is not touched.
-- The app's Map page will show "map data unavailable" until it is re-applied.
drop function if exists public.route_variant_geojson(uuid);
drop function if exists public.routes_serving(uuid, uuid);
drop function if exists public.search_locations(text, integer);
drop function if exists public.map_location_counts();
drop function if exists public.map_locations_in_bbox(double precision, double precision, double precision, double precision, integer);
