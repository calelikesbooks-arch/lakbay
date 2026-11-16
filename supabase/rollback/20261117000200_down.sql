-- Rollback of migration 2 (transport network).
-- WARNING: deletes ALL transport data, sources, evidence and verification
-- history. Export first:  Dashboard -> Table editor -> each table -> Export CSV,
-- or `supabase db dump --data-only -f backup.sql` with the Supabase CLI.
drop table if exists public.verification_records;
drop table if exists public.evidence;
drop table if exists public.fare_matrix_entries;
drop table if exists public.fare_matrices;
drop table if exists public.fare_rules;
drop table if exists public.route_geometries;
drop table if exists public.route_variant_stops;
drop table if exists public.route_variants;
drop table if exists public.routes;
drop table if exists public.stops;
drop table if exists public.terminals;
drop table if exists public.sources;
drop table if exists public.operators;

drop function if exists private.apply_verification();
drop function if exists private.guard_record_status();
drop function if exists private.set_geometry_length();
drop function if exists private.in_philippines(extensions.geography);
