-- Rollback of migration 7 (data acquisition).
-- WARNING: deletes the source registry, import runs and ALL staged candidates
-- (records already promoted into terminals/stops/routes are NOT deleted).
-- It also restores the earlier, weaker verification rule.

drop view if exists public.admin_review_queue;

drop function if exists public.mark_staged_needs_info(uuid, text);
drop function if exists public.reject_staged_feature(uuid, text);
drop function if exists public.link_staged_feature(uuid, uuid, text);
drop function if exists public.promote_staged_route(uuid, text, public.route_direction, text);
drop function if exists public.promote_staged_feature(uuid, text, text, text);
drop function if exists private.source_for_staged(public.staged_features);
drop function if exists public.match_staged_run(uuid);
drop function if exists public.upsert_staged_features(uuid, jsonb);
drop function if exists public.finish_import_run(uuid, public.import_run_status, jsonb, text, timestamptz, text);
drop function if exists public.start_import_run(text, text, text, jsonb);
drop function if exists public.upsert_import_area(text, text, text, text, text, smallint, text, smallint, bigint);
drop function if exists private.require_moderator();

drop table if exists public.staged_route_members;
drop table if exists public.staged_features;
drop table if exists public.import_runs;
drop table if exists public.import_areas;
drop table if exists public.data_providers;

drop type if exists public.staged_review_status;
drop type if exists public.staged_quality;
drop type if exists public.staged_kind;
drop type if exists public.import_run_status;
drop type if exists public.provider_status;

-- Restore migration 2's verification function (any evidence may verify).
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
