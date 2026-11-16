-- Rollback of migration 5 (queries and duplicate detection).
-- Safe on its own. Data is not touched.
drop view if exists public.terminal_duplicate_candidates;
drop view if exists public.stop_duplicate_candidates;
drop trigger if exists stops_flag_duplicate on public.stops;
drop trigger if exists terminals_flag_duplicate on public.terminals;
drop function if exists public.records_due_for_review(date);
drop function if exists public.find_similar_terminals(text, double precision, double precision, integer);
drop function if exists public.find_similar_stops(text, double precision, double precision, integer);
drop function if exists public.route_variant_stop_list(uuid);
drop function if exists public.nearby_stops(double precision, double precision, integer, text, integer);
drop function if exists public.nearby_terminals(double precision, double precision, integer, integer);
drop function if exists private.flag_possible_duplicate();
drop function if exists private.dup_thresholds(text);
