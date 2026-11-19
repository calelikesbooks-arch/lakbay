-- Rollback of 20261121000800_field_verification.sql
-- Removes the field-check log and functions. Verifications, sources and
-- evidence created by field checks STAY (they are the research record).
drop function if exists public.submit_field_check(text, uuid, public.field_outcome, timestamptz, double precision,
  double precision, double precision, text, numeric, uuid, uuid, boolean, text);
drop function if exists public.field_check_routes(text, integer);
drop function if exists public.field_check_nearby(double precision, double precision, integer, integer);
drop function if exists private.field_verify(text, uuid, public.record_status, date, int, text);
drop function if exists private.field_evidence(uuid, public.evidence_claim, text, uuid, text);
drop function if exists private.field_rules();
drop table if exists public.field_checks;
drop type if exists public.field_outcome;
