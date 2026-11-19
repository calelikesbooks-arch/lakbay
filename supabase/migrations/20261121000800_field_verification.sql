-- =====================================================================
-- LAKBAY migration 8: field verification
--
-- A moderator standing at a terminal/stop (or riding a route) records what
-- they saw. One call to submit_field_check() then:
--   1. checks the phone's GPS position and accuracy against the record,
--   2. stores the observation privately in field_checks,
--   3. creates a field_survey source + evidence (public once the record is),
--   4. inserts the verification record that changes the status.
--
-- Rules:
--   * "Confirmed" needs a GPS fix close to the record. Coordinates are never
--     typed by hand. If the place moved, "moved" replaces the location with
--     the measured GPS point.
--   * "Not found" on a draft only logs the visit (one visit is not enough to
--     delete anything). On a public record it sets needs_recheck.
--   * A fare paid is stored as an observation (evidence), never as an
--     official fare rule.
--   * Exact GPS positions and free notes stay private (moderators only).
-- Depends on migrations 1 to 7.
-- =====================================================================

create type public.field_outcome as enum ('confirmed', 'moved', 'not_found', 'closed', 'unsure');

create table public.field_checks (
  id                uuid primary key default gen_random_uuid(),
  terminal_id       uuid references public.terminals (id) on delete cascade,
  stop_id           uuid references public.stops (id) on delete cascade,
  route_variant_id  uuid references public.route_variants (id) on delete cascade,
  outcome           public.field_outcome not null,
  observed_at       timestamptz not null,
  position          extensions.geography(Point, 4326),
  gps_accuracy_m    numeric(7, 1) check (gps_accuracy_m is null or gps_accuracy_m > 0),
  distance_m        numeric(9, 1),
  previous_location extensions.geography(Point, 4326),
  signboard_text    text check (signboard_text is null or char_length(signboard_text) <= 120),
  fare_paid         numeric(7, 2) check (fare_paid is null or (fare_paid > 0 and fare_paid < 2000)),
  boarded_stop_id   uuid references public.stops (id) on delete set null,
  alighted_stop_id  uuid references public.stops (id) on delete set null,
  line_matches      boolean,
  notes             text check (notes is null or char_length(notes) <= 2000),
  status_before     public.record_status not null,
  status_after      public.record_status not null,
  source_id         uuid references public.sources (id) on delete set null,
  checked_by        uuid not null references public.profiles (id) on delete restrict default auth.uid(),
  created_at        timestamptz not null default now(),
  constraint field_checks_one_target check (num_nonnulls(terminal_id, stop_id, route_variant_id) = 1)
);
create index field_checks_terminal_idx on public.field_checks (terminal_id, created_at desc) where terminal_id is not null;
create index field_checks_stop_idx on public.field_checks (stop_id, created_at desc) where stop_id is not null;
create index field_checks_variant_idx on public.field_checks (route_variant_id, created_at desc) where route_variant_id is not null;
comment on table public.field_checks is 'Private log of on-site checks by moderators (GPS, notes). Public users only see the resulting source/verification.';

-- ---------------------------------------------------------------------
-- Settings (one place to change them)
-- ---------------------------------------------------------------------
create or replace function private.field_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'max_accuracy_stop_m', 35,      -- GPS must be at least this good at a stop
    'max_accuracy_terminal_m', 60,
    'tolerance_stop_m', 30,         -- allowed distance = accuracy + tolerance
    'tolerance_terminal_m', 120,    -- terminals are big
    'max_move_m', 500,              -- farther than this: it is a different place
    'max_age_days', 14,             -- checks must be entered within 14 days
    'review_days_place', 180,
    'review_days_route', 90
  );
$$;

-- ---------------------------------------------------------------------
-- Records to check near the moderator (drafts first, then overdue)
-- ---------------------------------------------------------------------
create or replace function public.field_check_nearby(
  p_lon double precision,
  p_lat double precision,
  p_radius_m integer default 2000,
  p_limit integer default 60
)
returns table (
  kind text, id uuid, name text, subtype text, municipality text,
  status public.record_status, last_verified_on date, next_review_on date,
  lon double precision, lat double precision, distance_m double precision, due boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_here extensions.geography;
  v_today date := private.today_ph();
begin
  perform private.require_moderator();
  if p_radius_m is null or p_radius_m < 50 or p_radius_m > 20000 then
    raise exception 'Radius must be between 50 m and 20 km' using errcode = '22023';
  end if;
  v_here := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography;

  return query
  select x.kind, x.id, x.name, x.subtype, x.municipality, x.status, x.last_verified_on, x.next_review_on,
         extensions.st_x(x.location::extensions.geometry), extensions.st_y(x.location::extensions.geometry),
         extensions.st_distance(x.location, v_here)::double precision,
         (x.status <> 'verified' or x.next_review_on is null or x.next_review_on <= v_today)
  from (
    select 'terminal'::text as kind, t.id, t.name, t.terminal_kind::text as subtype, t.municipality, t.status,
           t.last_verified_on, t.next_review_on, t.location
    from public.terminals t where t.status <> 'retired'
    union all
    select 'stop', s.id, s.name, s.stop_kind::text, s.municipality, s.status, s.last_verified_on, s.next_review_on, s.location
    from public.stops s where s.status <> 'retired'
  ) x
  where extensions.st_dwithin(x.location, v_here, p_radius_m)
  order by (x.status <> 'verified' or x.next_review_on is null or x.next_review_on <= v_today) desc,
           extensions.st_distance(x.location, v_here)
  limit least(greatest(coalesce(p_limit, 60), 1), 200);
end;
$$;

-- ---------------------------------------------------------------------
-- Route variants to ride (with their stops in order)
-- ---------------------------------------------------------------------
create or replace function public.field_check_routes(p_search text default null, p_limit integer default 50)
returns table (
  variant_id uuid, route_id uuid, route_name text, mode_code text, direction public.route_direction,
  variant_name text, signboard_text text, variant_status public.record_status, route_status public.record_status,
  last_verified_on date, next_review_on date, has_geometry boolean, stops jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_moderator();
  return query
  select v.id, r.id, r.name, r.mode_code, v.direction, v.variant_name,
         coalesce(v.signboard_text, r.common_signboard), v.status, r.status, v.last_verified_on, v.next_review_on,
         exists (select 1 from public.route_geometries g where g.variant_id = v.id and g.is_current),
         coalesce((
           select jsonb_agg(jsonb_build_object('seq', rvs.stop_sequence, 'id', s.id, 'name', s.name, 'status', s.status)
                            order by rvs.stop_sequence)
           from public.route_variant_stops rvs join public.stops s on s.id = rvs.stop_id
           where rvs.variant_id = v.id), '[]'::jsonb)
  from public.route_variants v
  join public.routes r on r.id = v.route_id
  where v.status <> 'retired' and r.status <> 'retired'
    and (p_search is null or btrim(p_search) = ''
         or r.name ilike '%' || btrim(p_search) || '%'
         or coalesce(v.signboard_text, r.common_signboard, '') ilike '%' || btrim(p_search) || '%')
  order by (v.status <> 'verified') desc, r.name, v.direction
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- ---------------------------------------------------------------------
-- Helper: one field-survey source per check, with evidence on a target
-- ---------------------------------------------------------------------
create or replace function private.field_evidence(p_source uuid, p_claim public.evidence_claim, p_fk text, p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  execute format('insert into public.evidence (source_id, claim, note, %I) values ($1, $2, $3, $4)', p_fk)
    using p_source, p_claim, left(p_note, 1000), p_id;
end;
$$;

create or replace function private.field_verify(p_fk text, p_id uuid, p_status public.record_status,
                                                p_observed date, p_review_days int, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  execute format(
    'insert into public.verification_records (status_to, method, observed_on, next_review_on, notes, %I)
     values ($1, ''field_survey'', $2, $3, $4, $5)', p_fk)
    using p_status, p_observed,
          case when p_status in ('verified', 'needs_recheck') then p_observed + p_review_days end,
          p_note, p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- The one entry point used by the app
-- ---------------------------------------------------------------------
create or replace function public.submit_field_check(
  p_target_kind text,                 -- 'terminal' | 'stop' | 'route_variant'
  p_target_id uuid,
  p_outcome public.field_outcome,
  p_observed_at timestamptz,
  p_lon double precision default null,
  p_lat double precision default null,
  p_accuracy_m double precision default null,
  p_signboard_text text default null,
  p_fare_paid numeric default null,
  p_boarded_stop_id uuid default null,
  p_alighted_stop_id uuid default null,
  p_line_matches boolean default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb := private.field_rules();
  v_table text;
  v_fk text;
  v_name text;
  v_status public.record_status;
  v_new_status public.record_status;
  v_location extensions.geography;
  v_position extensions.geography;
  v_distance double precision;
  v_max_acc double precision;
  v_allowed double precision;
  v_observed date;
  v_source uuid;
  v_check uuid;
  v_route uuid;
  v_route_status public.record_status;
  v_direction public.route_direction;
  v_seq_on smallint;
  v_seq_off smallint;
  v_on_name text;
  v_off_name text;
  v_geometry uuid;
  v_unverified_stops int := 0;
  v_messages text[] := '{}';
begin
  perform private.require_moderator();

  -- ---- when ----
  if p_observed_at is null or p_observed_at > now() + interval '5 minutes' then
    raise exception 'The check time cannot be in the future' using errcode = '22007';
  end if;
  if p_observed_at < now() - make_interval(days => (r ->> 'max_age_days')::int) then
    raise exception 'Checks must be entered within % days of the visit', r ->> 'max_age_days' using errcode = '22007';
  end if;
  v_observed := (p_observed_at at time zone 'Asia/Manila')::date;

  if p_notes is not null and char_length(p_notes) > 2000 then
    raise exception 'Notes are too long (max 2000 characters)' using errcode = '22001';
  end if;

  -- ---- where ----
  if (p_lon is null) <> (p_lat is null) then
    raise exception 'Give both longitude and latitude, or neither' using errcode = '22023';
  end if;
  if p_lon is not null then
    if p_accuracy_m is null or p_accuracy_m <= 0 then
      raise exception 'A GPS position needs its accuracy (from the phone)' using errcode = '22023';
    end if;
    v_position := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography;
    if not private.in_philippines(v_position) then
      raise exception 'The GPS position is outside the Philippines' using errcode = '22023';
    end if;
  end if;

  -- ---- what ----
  v_table := case p_target_kind when 'terminal' then 'terminals' when 'stop' then 'stops'
                                when 'route_variant' then 'route_variants' end;
  if v_table is null then
    raise exception 'Unknown target kind %', p_target_kind using errcode = '22023';
  end if;
  v_fk := case p_target_kind when 'terminal' then 'terminal_id' when 'stop' then 'stop_id' else 'route_variant_id' end;

  if p_target_kind in ('terminal', 'stop') then
    execute format('select name, status, location from public.%I where id = $1 for update', v_table)
      into v_name, v_status, v_location using p_target_id;
    if v_name is null then
      raise exception '% not found', p_target_kind using errcode = 'P0002';
    end if;

    if p_outcome in ('confirmed', 'moved', 'not_found') then
      if v_position is null then
        raise exception 'This outcome needs your GPS position: be at the place and allow location' using errcode = '22023';
      end if;
      v_max_acc := (r ->> case when p_target_kind = 'stop' then 'max_accuracy_stop_m' else 'max_accuracy_terminal_m' end)::double precision;
      if p_accuracy_m > v_max_acc then
        raise exception 'GPS accuracy is % m; it must be % m or better. Wait outside, away from tall buildings, and try again.',
          round(p_accuracy_m::numeric), v_max_acc using errcode = '22023';
      end if;
      v_distance := extensions.st_distance(v_location, v_position);
      v_allowed := p_accuracy_m + (r ->> case when p_target_kind = 'stop' then 'tolerance_stop_m' else 'tolerance_terminal_m' end)::double precision;
      if p_outcome in ('confirmed', 'not_found') and v_distance > v_allowed then
        raise exception 'You are % m from the recorded spot (allowed: % m). Go closer, or choose "moved" if it is really here.',
          round(v_distance::numeric), round(v_allowed::numeric) using errcode = '22023';
      end if;
      if p_outcome = 'moved' then
        if v_distance > (r ->> 'max_move_m')::double precision then
          raise exception 'That is % m away: treat it as a different place, not a move', round(v_distance::numeric) using errcode = '22023';
        end if;
        if v_distance <= p_accuracy_m then
          raise exception 'You are within GPS accuracy of the recorded spot: choose "confirmed" instead' using errcode = '22023';
        end if;
      end if;
    end if;
    if p_fare_paid is not null or p_boarded_stop_id is not null or p_alighted_stop_id is not null or p_line_matches is not null then
      raise exception 'Fare, boarding/alighting and line answers only apply to routes' using errcode = '22023';
    end if;
  else
    select coalesce(v.variant_name, 'Main'), v.status, v.route_id, v.direction, r2.status,
           r2.name || ' (' || v.direction || ')'
      into v_name, v_status, v_route, v_direction, v_route_status, v_name
    from public.route_variants v join public.routes r2 on r2.id = v.route_id
    where v.id = p_target_id
    for update of v;
    if v_route is null then
      raise exception 'Route variant not found' using errcode = 'P0002';
    end if;

    if p_outcome = 'confirmed' then
      if p_boarded_stop_id is null or p_alighted_stop_id is null or p_boarded_stop_id = p_alighted_stop_id then
        raise exception 'Choose the stop where you boarded and the stop where you got off' using errcode = '22023';
      end if;
      select min(stop_sequence), max(s.name) into v_seq_on, v_on_name
        from public.route_variant_stops rvs join public.stops s on s.id = rvs.stop_id
        where rvs.variant_id = p_target_id and rvs.stop_id = p_boarded_stop_id;
      select max(stop_sequence), max(s.name) into v_seq_off, v_off_name
        from public.route_variant_stops rvs join public.stops s on s.id = rvs.stop_id
        where rvs.variant_id = p_target_id and rvs.stop_id = p_alighted_stop_id;
      if v_seq_on is null or v_seq_off is null then
        raise exception 'Both stops must be stops of this route' using errcode = '22023';
      end if;
      if v_direction in ('outbound', 'inbound') and v_seq_on >= v_seq_off then
        raise exception 'The boarding stop must come before the alighting stop on this route' using errcode = '22023';
      end if;
    elsif p_fare_paid is not null then
      raise exception 'A fare can only be recorded when you rode the route' using errcode = '22023';
    end if;
    if v_position is not null then
      v_distance := null; -- position is kept as context only for rides
    end if;
  end if;

  -- ---- decide the new status ----
  v_new_status := case
    when p_outcome in ('confirmed', 'moved') then 'verified'
    when p_outcome = 'closed' then 'retired'
    when p_outcome = 'not_found' and v_status in ('verified', 'needs_recheck') then 'needs_recheck'
    else v_status   -- unsure, or not found on a draft: only logged
  end::public.record_status;

  -- ---- source (public once the record is public: keep it free of personal notes) ----
  if v_new_status is distinct from v_status or p_outcome in ('confirmed', 'moved') then
    insert into public.sources (source_type, title, publisher, observed_on, observer_id, notes)
    values ('field_survey', left('LAKBAY field check: ' || v_name || ' (' || v_observed || ')', 300),
            'LAKBAY field team', v_observed, auth.uid(),
            'On-site check, outcome: ' || p_outcome::text || '.')
    returning id into v_source;
  end if;

  -- ---- apply ----
  if p_target_kind in ('terminal', 'stop') then
    if p_outcome = 'moved' then
      execute format('update public.%I set location = $1 where id = $2', v_table) using v_position, p_target_id;
      v_messages := v_messages || ('Location updated by ' || round(v_distance::numeric) || ' m.');
    end if;
    if v_source is not null then
      perform private.field_evidence(v_source, 'existence', v_fk, p_target_id,
        case p_outcome when 'not_found' then 'Not found on site.' when 'closed' then 'Closed / no longer used.' else 'Seen on site.' end);
      if p_outcome in ('confirmed', 'moved') then
        perform private.field_evidence(v_source, 'location', v_fk, p_target_id,
          'Location checked with phone GPS (accuracy ' || round(p_accuracy_m::numeric) || ' m).');
      end if;
      if p_signboard_text is not null and btrim(p_signboard_text) <> '' then
        perform private.field_evidence(v_source, 'signboard', v_fk, p_target_id, 'Sign reads: ' || btrim(p_signboard_text));
      end if;
    end if;
    if v_new_status is distinct from v_status or p_outcome in ('confirmed', 'moved') then
      perform private.field_verify(v_fk, p_target_id, v_new_status, v_observed, (r ->> 'review_days_place')::int,
                                   'Field check: ' || p_outcome::text);
    end if;
  else
    if v_source is not null then
      perform private.field_evidence(v_source, 'existence', v_fk, p_target_id,
        case p_outcome when 'confirmed' then 'Rode from ' || v_on_name || ' to ' || v_off_name || '.'
                       when 'not_found' then 'Not found on site.' else 'Reported closed.' end);
      if p_outcome = 'confirmed' then
        perform private.field_evidence(v_source, 'stops', v_fk, p_target_id,
          'Boarded at ' || v_on_name || ', got off at ' || v_off_name || '.');
      end if;
      if p_signboard_text is not null and btrim(p_signboard_text) <> '' then
        perform private.field_evidence(v_source, 'signboard', v_fk, p_target_id, 'Signboard reads: ' || btrim(p_signboard_text));
        update public.route_variants set signboard_text = left(btrim(p_signboard_text), 120)
        where id = p_target_id and signboard_text is null;
      end if;
      if p_fare_paid is not null then
        perform private.field_evidence(v_source, 'fare', v_fk, p_target_id,
          'Observed fare paid: PHP ' || p_fare_paid || ' from ' || v_on_name || ' to ' || v_off_name
          || ' on ' || v_observed || '. One observation, not an official fare.');
      end if;
    end if;
    if v_new_status is distinct from v_status or p_outcome = 'confirmed' then
      perform private.field_verify(v_fk, p_target_id, v_new_status, v_observed, (r ->> 'review_days_route')::int,
                                   'Field check: ' || p_outcome::text);
    end if;

    if p_outcome = 'confirmed' then
      -- The parent route exists too.
      if v_route_status <> 'verified' then
        perform private.field_evidence(v_source, 'existence', 'route_id', v_route, 'A variant was ridden on ' || v_observed || '.');
        perform private.field_verify('route_id', v_route, 'verified', v_observed, (r ->> 'review_days_route')::int,
                                     'Field check of a variant');
      end if;
      -- The line on the map: only when the rider says it matches.
      select g.id into v_geometry from public.route_geometries g where g.variant_id = p_target_id and g.is_current;
      if v_geometry is not null and p_line_matches is true then
        perform private.field_evidence(v_source, 'path', 'route_geometry_id', v_geometry, 'Rider confirmed the line matches the ride.');
        perform private.field_verify('route_geometry_id', v_geometry, 'verified', v_observed, (r ->> 'review_days_route')::int,
                                     'Line confirmed during ride');
      elsif v_geometry is not null and p_line_matches is false then
        v_messages := v_messages || 'The line was NOT verified (you said it does not match).'::text;
      end if;
      select count(*) into v_unverified_stops
      from public.route_variant_stops rvs join public.stops s on s.id = rvs.stop_id
      where rvs.variant_id = p_target_id and s.status <> 'verified';
      if v_unverified_stops > 0 then
        v_messages := v_messages || (v_unverified_stops || ' stops of this route are not verified yet; check them too.');
      end if;
    elsif p_outcome = 'closed' then
      v_messages := v_messages || 'Only this variant was retired; the route itself was not changed.'::text;
    end if;
  end if;

  if p_outcome = 'not_found' and v_new_status = v_status then
    v_messages := v_messages || 'Logged only: one visit is not enough to remove a draft. Mark it closed if you are sure.'::text;
  end if;

  insert into public.field_checks (
    terminal_id, stop_id, route_variant_id, outcome, observed_at, position, gps_accuracy_m, distance_m,
    previous_location, signboard_text, fare_paid, boarded_stop_id, alighted_stop_id, line_matches, notes,
    status_before, status_after, source_id
  ) values (
    case when p_target_kind = 'terminal' then p_target_id end,
    case when p_target_kind = 'stop' then p_target_id end,
    case when p_target_kind = 'route_variant' then p_target_id end,
    p_outcome, p_observed_at, v_position, p_accuracy_m, v_distance,
    case when p_outcome = 'moved' then v_location end,
    nullif(btrim(coalesce(p_signboard_text, '')), ''), p_fare_paid, p_boarded_stop_id, p_alighted_stop_id, p_line_matches,
    nullif(btrim(coalesce(p_notes, '')), ''), v_status, v_new_status, v_source
  ) returning id into v_check;

  return jsonb_build_object(
    'check_id', v_check, 'status_before', v_status, 'status_after', v_new_status,
    'distance_m', round(v_distance::numeric, 1), 'messages', to_jsonb(v_messages)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------
alter table public.field_checks enable row level security;
revoke all on public.field_checks from anon, authenticated;
grant select on public.field_checks to authenticated;
create policy "moderators read field checks" on public.field_checks for select to authenticated using (private.is_moderator());

revoke execute on function
  public.field_check_nearby(double precision, double precision, integer, integer),
  public.field_check_routes(text, integer),
  public.submit_field_check(text, uuid, public.field_outcome, timestamptz, double precision, double precision,
                            double precision, text, numeric, uuid, uuid, boolean, text)
from public, anon, authenticated;
grant execute on function
  public.field_check_nearby(double precision, double precision, integer, integer),
  public.field_check_routes(text, integer),
  public.submit_field_check(text, uuid, public.field_outcome, timestamptz, double precision, double precision,
                            double precision, text, numeric, uuid, uuid, boolean, text)
to authenticated;

revoke all on function private.field_rules(), private.field_evidence(uuid, public.evidence_claim, text, uuid, text),
  private.field_verify(text, uuid, public.record_status, date, int, text) from public;
