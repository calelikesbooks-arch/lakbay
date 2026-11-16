-- =====================================================================
-- LAKBAY migration 3/5: community submissions, saved destinations,
-- saved trips, and the functions (RPCs) that control them
-- =====================================================================
-- Public users NEVER write transport tables. They send submissions, which
-- always start as 'pending' and are reviewed by a moderator. Moderators
-- then create or update records through the draft -> verification flow.

create table public.community_submissions (
  id                    uuid primary key default gen_random_uuid(),
  submission_type       public.submission_type not null,
  -- For 'report': route_changed, fare_changed, terminal_moved, new_route, other
  category              text check (category is null or category ~ '^[a-z_]{2,40}$'),
  submitted_by          uuid references public.profiles (id) on delete set null,
  location_text         text not null check (char_length(location_text) between 3 and 120),
  location              extensions.geography(Point, 4326) check (location is null or private.in_philippines(location)),
  details               text not null check (char_length(details) between 10 and 1000),
  -- Structured proposal from mappers (e.g. stop name, signboard, fare paid)
  payload               jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 16384),
  observed_on           date not null,
  -- Optional pointer to an existing record the submission is about
  target_table          text check (target_table is null or target_table in
                          ('terminals', 'stops', 'routes', 'route_variants', 'fare_rules', 'fare_matrices', 'operators')),
  target_id             uuid,
  status                public.submission_status not null default 'pending',
  -- Filled automatically when a similar pending submission exists
  possible_duplicate_of uuid references public.community_submissions (id) on delete set null,
  -- Filled by the moderator when status = 'duplicate'
  duplicate_of          uuid references public.community_submissions (id) on delete set null,
  reviewed_by           uuid references public.profiles (id) on delete set null,
  reviewed_at           timestamptz,
  review_notes          text check (review_notes is null or char_length(review_notes) <= 2000),
  created_at            timestamptz not null default now(),
  constraint submissions_target_pair check ((target_table is null) = (target_id is null)),
  constraint submissions_duplicate_needs_ref check (status <> 'duplicate' or duplicate_of is not null)
);
create index community_submissions_status_idx on public.community_submissions (status, created_at desc);
create index community_submissions_user_idx on public.community_submissions (submitted_by, created_at desc);
create index community_submissions_location_gix on public.community_submissions using gist (location);
create index community_submissions_text_trgm on public.community_submissions
  using gin (private.normalize_name(location_text) extensions.gin_trgm_ops);

create trigger community_submissions_audit after insert or update or delete on public.community_submissions
  for each row execute function private.write_audit();

-- Move reports made with migration 0001 (if that table exists), then drop it.
do $$
begin
  if to_regclass('public.community_reports') is not null then
    insert into public.community_submissions
      (id, submission_type, category, location_text, details, observed_on, status, created_at)
    select id, 'report', category, location_text, details, observed_on,
           case status when 'accepted' then 'accepted'::public.submission_status
                       when 'rejected' then 'rejected'::public.submission_status
                       else 'pending'::public.submission_status end,
           created_at
    from public.community_reports;
    drop table public.community_reports;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Saved destinations and trips (signed-in users, for syncing later).
-- The app currently keeps these on the device; these tables are ready
-- for when accounts are switched on.
-- ---------------------------------------------------------------------
create table public.saved_destinations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  label       text not null check (char_length(label) between 1 and 80),
  stop_id     uuid references public.stops (id) on delete set null,
  terminal_id uuid references public.terminals (id) on delete set null,
  location    extensions.geography(Point, 4326) check (location is null or private.in_philippines(location)),
  created_at  timestamptz not null default now(),
  constraint saved_destinations_has_place check (num_nonnulls(stop_id, terminal_id, location) >= 1),
  constraint saved_destinations_label_uniq unique (user_id, label)
);
create index saved_destinations_user_idx on public.saved_destinations (user_id);

create table public.saved_trips (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  label                    text check (label is null or char_length(label) <= 80),
  origin_label             text not null check (char_length(origin_label) between 1 and 120),
  origin_stop_id           uuid references public.stops (id) on delete set null,
  origin_terminal_id       uuid references public.terminals (id) on delete set null,
  origin_location          extensions.geography(Point, 4326),
  destination_label        text not null check (char_length(destination_label) between 1 and 120),
  destination_stop_id      uuid references public.stops (id) on delete set null,
  destination_terminal_id  uuid references public.terminals (id) on delete set null,
  destination_location     extensions.geography(Point, 4326),
  created_at               timestamptz not null default now()
);
create index saved_trips_user_idx on public.saved_trips (user_id, created_at desc);
-- The same trip cannot be saved twice by the same user.
create unique index saved_trips_uniq on public.saved_trips (
  user_id, private.normalize_name(origin_label), private.normalize_name(destination_label)
);

-- Cap per user, so one account cannot fill the free database.
create or replace function private.limit_saved_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name) into v_count using new.user_id;
  if v_count >= 200 then
    raise exception 'Limit of 200 saved items reached' using errcode = '54000';
  end if;
  return new;
end;
$$;
create trigger saved_destinations_limit before insert on public.saved_destinations
  for each row execute function private.limit_saved_rows();
create trigger saved_trips_limit before insert on public.saved_trips
  for each row execute function private.limit_saved_rows();

-- ---------------------------------------------------------------------
-- RPC: submit a community report (anyone, signed in or not)
-- Called from the app with supabase.rpc('submit_community_report', {...}).
-- SECURITY DEFINER: the function decides every sensitive column itself
-- (status is always 'pending'; submitted_by is the real caller).
-- ---------------------------------------------------------------------
create or replace function public.submit_community_report(
  p_category      text,
  p_location_text text,
  p_details       text,
  p_observed_on   date,
  p_lon           double precision default null,
  p_lat           double precision default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_location extensions.geography;
  v_location_text text := btrim(coalesce(p_location_text, ''));
  v_details text := btrim(coalesce(p_details, ''));
  v_dup uuid;
  v_id uuid;
begin
  if p_category is null or p_category not in ('route_changed', 'fare_changed', 'terminal_moved', 'new_route', 'other') then
    raise exception 'Unknown report category' using errcode = '22023';
  end if;
  if p_observed_on is null or p_observed_on > private.today_ph() then
    raise exception 'observed_on must be today or earlier' using errcode = '22007';
  end if;
  if (p_lon is null) <> (p_lat is null) then
    raise exception 'Give both longitude and latitude, or neither' using errcode = '22023';
  end if;
  if p_lon is not null then
    v_location := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography;
  end if;

  -- Basic flood protection.
  if v_uid is not null and (
       select count(*) from public.community_submissions
       where submitted_by = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many reports in the last hour. Please try again later.' using errcode = '54000';
  end if;
  if v_uid is null and (
       select count(*) from public.community_submissions
       where submitted_by is null and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'Reporting is busy right now. Please try again in a few minutes.' using errcode = '54000';
  end if;

  -- Duplicate hint: a similar open report from the last 30 days.
  select s.id into v_dup
  from public.community_submissions s
  where s.status in ('pending', 'in_review')
    and s.created_at > now() - interval '30 days'
    and coalesce(s.category, '') = p_category
    and (
      (v_location is not null and s.location is not null
         and extensions.st_dwithin(s.location, v_location, 150))
      or extensions.similarity(private.normalize_name(s.location_text), private.normalize_name(v_location_text)) >= 0.6
    )
  order by s.created_at desc
  limit 1;

  insert into public.community_submissions
    (submission_type, category, submitted_by, location_text, location, details, observed_on, status, possible_duplicate_of)
  values
    ('report', p_category, v_uid, v_location_text, v_location, v_details, p_observed_on, 'pending', v_dup)
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: structured proposal from an active mapper (new stop, terminal...)
-- ---------------------------------------------------------------------
create or replace function public.submit_mapper_proposal(
  p_type          public.submission_type,
  p_location_text text,
  p_details       text,
  p_observed_on   date,
  p_payload       jsonb default '{}'::jsonb,
  p_lon           double precision default null,
  p_lat           double precision default null,
  p_target_table  text default null,
  p_target_id     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_location extensions.geography;
begin
  if not private.is_contributor() then
    raise exception 'Only active community mappers can send proposals' using errcode = '42501';
  end if;
  if p_type = 'report' then
    raise exception 'Use submit_community_report for simple reports' using errcode = '22023';
  end if;
  if p_observed_on is null or p_observed_on > private.today_ph() then
    raise exception 'observed_on must be today or earlier' using errcode = '22007';
  end if;
  if (p_lon is null) <> (p_lat is null) then
    raise exception 'Give both longitude and latitude, or neither' using errcode = '22023';
  end if;
  if p_lon is not null then
    v_location := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography;
  end if;

  insert into public.community_submissions
    (submission_type, submitted_by, location_text, location, details, payload, observed_on, target_table, target_id, status)
  values
    (p_type, (select auth.uid()), btrim(p_location_text), v_location, btrim(p_details), coalesce(p_payload, '{}'::jsonb),
     p_observed_on, p_target_table, p_target_id, 'pending')
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: moderator decision on a submission
-- ---------------------------------------------------------------------
create or replace function public.review_submission(
  p_submission_id uuid,
  p_decision      public.submission_status,
  p_notes         text default null,
  p_duplicate_of  uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.submission_status;
begin
  if not private.is_moderator() then
    raise exception 'Only moderators can review submissions' using errcode = '42501';
  end if;
  if p_decision = 'pending' then
    raise exception 'A review cannot set a submission back to pending' using errcode = '22023';
  end if;
  if p_decision = 'duplicate' and (p_duplicate_of is null or p_duplicate_of = p_submission_id) then
    raise exception 'Name the original submission in p_duplicate_of' using errcode = '22023';
  end if;

  select status into v_current from public.community_submissions where id = p_submission_id for update;
  if not found then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;
  if v_current in ('accepted', 'rejected', 'duplicate') then
    raise exception 'Submission was already decided (%)', v_current using errcode = '22023';
  end if;

  update public.community_submissions
  set status = p_decision,
      review_notes = p_notes,
      duplicate_of = case when p_decision = 'duplicate' then p_duplicate_of end,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = p_submission_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RPCs: mapper applications and approvals
-- ---------------------------------------------------------------------
create or replace function public.apply_as_mapper(p_home_area text, p_bio text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  insert into public.mapper_profiles (user_id, home_area, bio, status)
  values ((select auth.uid()), btrim(p_home_area), nullif(btrim(coalesce(p_bio, '')), ''), 'applied')
  on conflict (user_id) do update
    set home_area = excluded.home_area, bio = excluded.bio;
end;
$$;

-- Admin approves / suspends a mapper. Keeps user_roles in sync.
create or replace function public.set_mapper_status(p_user_id uuid, p_status public.mapper_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role('admin') then
    raise exception 'Only admins can change mapper status' using errcode = '42501';
  end if;
  update public.mapper_profiles
  set status = p_status,
      approved_by = case when p_status = 'active' then (select auth.uid()) else approved_by end,
      approved_at = case when p_status = 'active' then now() else approved_at end
  where user_id = p_user_id;
  if not found then
    raise exception 'That user has not applied as a mapper' using errcode = 'P0002';
  end if;

  if p_status = 'active' then
    insert into public.user_roles (user_id, role, granted_by)
    values (p_user_id, 'mapper', (select auth.uid()))
    on conflict (user_id, role) do nothing;
  else
    delete from public.user_roles where user_id = p_user_id and role = 'mapper';
  end if;
end;
$$;

-- Admin grants or removes moderator/admin roles. Admins cannot remove
-- their own admin role (prevents locking everyone out by accident).
create or replace function public.set_user_role(p_user_id uuid, p_role public.app_role, p_grant boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role('admin') then
    raise exception 'Only admins can change roles' using errcode = '42501';
  end if;
  if p_role = 'mapper' then
    raise exception 'Use set_mapper_status for mappers' using errcode = '22023';
  end if;
  if p_grant then
    insert into public.user_roles (user_id, role, granted_by)
    values (p_user_id, p_role, (select auth.uid()))
    on conflict (user_id, role) do nothing;
  else
    if p_user_id = (select auth.uid()) and p_role = 'admin' then
      raise exception 'You cannot remove your own admin role' using errcode = '22023';
    end if;
    delete from public.user_roles where user_id = p_user_id and role = p_role;
  end if;
end;
$$;

create trigger user_roles_audit after insert or update or delete on public.user_roles
  for each row execute function private.write_audit();
