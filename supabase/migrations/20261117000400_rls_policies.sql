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
