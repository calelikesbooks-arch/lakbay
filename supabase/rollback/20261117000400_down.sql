-- Rollback of migration 4 (RLS policies).
-- SAFE-BY-DEFAULT: this removes the policies but keeps RLS switched ON and
-- keeps the narrow grants. With no policies, the API can read and write
-- NOTHING (only the dashboard / service role can). It never opens data up.
-- Run migration 3's rollback next if you are undoing everything.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'user_roles', 'mapper_profiles', 'transport_modes', 'audit_log',
                        'operators', 'sources', 'terminals', 'stops', 'routes', 'route_variants',
                        'route_variant_stops', 'route_geometries', 'fare_rules', 'fare_matrices',
                        'fare_matrix_entries', 'evidence', 'verification_records',
                        'community_submissions', 'saved_destinations', 'saved_trips')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end;
$$;

drop function if exists private.source_is_public(uuid);
drop function if exists private.evidence_is_public(uuid);
drop function if exists private.can_edit_matrix(uuid);
drop function if exists private.can_edit_variant(uuid);
