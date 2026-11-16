-- =====================================================================
-- LAKBAY migration 2/5: transport network, fares, sources, evidence,
-- verification records
-- =====================================================================
-- Every transport table shares these columns:
--   status            record_status (draft -> pending_review -> verified ...)
--   last_verified_on  date of the latest verification
--   next_review_on    when it must be checked again
--   created_by/at, updated_by/at (stamped by trigger, cannot be faked)
-- Records become 'verified' ONLY by inserting a verification_records row,
-- and only if at least one piece of evidence is attached.
-- Coordinates use PostGIS geography (WGS 84 / EPSG:4326, meters for distance).

-- Rough Philippines bounding box, to catch swapped latitude/longitude.
create or replace function private.in_philippines(p extensions.geography)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select extensions.st_x(p::extensions.geometry) between 114 and 127
     and extensions.st_y(p::extensions.geometry) between 4 and 22;
$$;
grant execute on function private.in_philippines(extensions.geography) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Operators (cooperatives, companies, rail operators)
-- ---------------------------------------------------------------------
create table public.operators (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(name) between 2 and 160),
  operator_type       public.operator_type not null default 'unknown',
  franchise_reference text check (franchise_reference is null or char_length(franchise_reference) <= 120),
  website_url         text check (website_url is null or website_url ~ '^https?://'),
  status              public.record_status not null default 'draft',
  last_verified_on    date,
  next_review_on      date,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles (id) on delete set null,
  updated_at          timestamptz not null default now()
);
create unique index operators_name_uniq on public.operators (private.normalize_name(name)) where status <> 'retired';

-- ---------------------------------------------------------------------
-- Research sources (citations). Sources are reusable across records.
-- ---------------------------------------------------------------------
create table public.sources (
  id              uuid primary key default gen_random_uuid(),
  source_type     public.source_type not null,
  title           text not null check (char_length(title) between 3 and 300),
  url             text check (url is null or url ~ '^https?://'),
  publisher       text check (publisher is null or char_length(publisher) <= 160),
  -- e.g. LTFRB Memorandum Circular number
  document_number text check (document_number is null or char_length(document_number) <= 120),
  -- When the document was issued (official documents, news)
  published_on    date,
  -- When the information was seen in the field / confirmed
  observed_on     date,
  -- When LAKBAY retrieved or downloaded it
  retrieved_at    timestamptz,
  observer_id     uuid references public.profiles (id) on delete set null,
  -- Path in Supabase Storage for photos / PDFs (later)
  storage_path    text check (storage_path is null or char_length(storage_path) <= 300),
  -- SHA-256 of the file, to detect the same document uploaded twice
  content_sha256  text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  notes           text check (notes is null or char_length(notes) <= 2000),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id) on delete set null,
  updated_at      timestamptz not null default now(),
  constraint sources_has_date check (published_on is not null or observed_on is not null),
  constraint sources_dates_not_future check (
    coalesce(published_on, observed_on) <= (now() at time zone 'Asia/Manila')::date + 1
    and coalesce(observed_on, published_on) <= (now() at time zone 'Asia/Manila')::date + 1
  )
);
-- Duplicate detection for sources: same file or same URL is rejected.
create unique index sources_sha256_uniq on public.sources (content_sha256) where content_sha256 is not null;
create unique index sources_url_uniq on public.sources (lower(url)) where url is not null;

-- ---------------------------------------------------------------------
-- Terminals
-- ---------------------------------------------------------------------
create table public.terminals (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (char_length(name) between 2 and 160),
  alt_names              text[] not null default '{}',
  terminal_kind          public.terminal_kind not null default 'terminal',
  location               extensions.geography(Point, 4326) not null check (private.in_philippines(location)),
  municipality           text not null check (char_length(municipality) between 2 and 80),
  province               text not null check (char_length(province) between 2 and 80),
  address_text           text check (address_text is null or char_length(address_text) <= 300),
  landmark_text          text check (landmark_text is null or char_length(landmark_text) <= 300),
  operating_hours        text check (operating_hours is null or char_length(operating_hours) <= 200),
  notes                  text check (notes is null or char_length(notes) <= 2000),
  -- Set automatically when a similar terminal exists nearby (see migration 5)
  possible_duplicate_of  uuid references public.terminals (id) on delete set null,
  status                 public.record_status not null default 'draft',
  last_verified_on       date,
  next_review_on         date,
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_by             uuid references public.profiles (id) on delete set null,
  updated_at             timestamptz not null default now()
);
create index terminals_location_gix on public.terminals using gist (location);
create index terminals_name_trgm on public.terminals using gin (private.normalize_name(name) extensions.gin_trgm_ops);
create index terminals_status_idx on public.terminals (status);
create unique index terminals_name_town_uniq
  on public.terminals (private.normalize_name(name), private.normalize_name(municipality)) where status <> 'retired';

-- ---------------------------------------------------------------------
-- Stops (designated stops, loading areas, rail stations, terminal bays)
-- ---------------------------------------------------------------------
create table public.stops (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (char_length(name) between 2 and 160),
  alt_names              text[] not null default '{}',
  stop_kind              public.stop_kind not null default 'designated_stop',
  terminal_id            uuid references public.terminals (id) on delete set null,
  location               extensions.geography(Point, 4326) not null check (private.in_philippines(location)),
  municipality           text not null check (char_length(municipality) between 2 and 80),
  province               text not null check (char_length(province) between 2 and 80),
  landmark_text          text check (landmark_text is null or char_length(landmark_text) <= 300),
  notes                  text check (notes is null or char_length(notes) <= 2000),
  possible_duplicate_of  uuid references public.stops (id) on delete set null,
  status                 public.record_status not null default 'draft',
  last_verified_on       date,
  next_review_on         date,
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_by             uuid references public.profiles (id) on delete set null,
  updated_at             timestamptz not null default now()
);
create index stops_location_gix on public.stops using gist (location);
create index stops_name_trgm on public.stops using gin (private.normalize_name(name) extensions.gin_trgm_ops);
create index stops_terminal_idx on public.stops (terminal_id);
create index stops_status_idx on public.stops (status);

-- ---------------------------------------------------------------------
-- Routes -> variants (direction / branch) -> ordered stops + geometry
-- ---------------------------------------------------------------------
create table public.routes (
  id                uuid primary key default gen_random_uuid(),
  mode_code         text not null references public.transport_modes (code) on update cascade,
  operator_id       uuid references public.operators (id) on delete set null,
  -- Official route code (e.g. from an LTFRB franchise), if known
  route_code        text check (route_code is null or char_length(route_code) <= 60),
  name              text not null check (char_length(name) between 3 and 160),
  common_signboard  text check (common_signboard is null or char_length(common_signboard) <= 120),
  description       text check (description is null or char_length(description) <= 2000),
  status            public.record_status not null default 'draft',
  last_verified_on  date,
  next_review_on    date,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id) on delete set null,
  updated_at        timestamptz not null default now()
);
create index routes_mode_idx on public.routes (mode_code);
create index routes_operator_idx on public.routes (operator_id);
create index routes_status_idx on public.routes (status);
-- Same mode + same name + same operator = duplicate.
create unique index routes_identity_uniq on public.routes (
  mode_code,
  private.normalize_name(name),
  coalesce(operator_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where status <> 'retired';

create table public.route_variants (
  id                  uuid primary key default gen_random_uuid(),
  route_id            uuid not null references public.routes (id) on delete cascade,
  direction           public.route_direction not null,
  variant_name        text not null default 'Main' check (char_length(variant_name) between 1 and 80),
  signboard_text      text check (signboard_text is null or char_length(signboard_text) <= 120),
  origin_stop_id      uuid references public.stops (id) on delete set null,
  destination_stop_id uuid references public.stops (id) on delete set null,
  is_primary          boolean not null default false,
  service_hours       text check (service_hours is null or char_length(service_hours) <= 200),
  frequency_note      text check (frequency_note is null or char_length(frequency_note) <= 200),
  status              public.record_status not null default 'draft',
  last_verified_on    date,
  next_review_on      date,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles (id) on delete set null,
  updated_at          timestamptz not null default now(),
  constraint route_variants_name_uniq unique (route_id, direction, variant_name)
);
create index route_variants_route_idx on public.route_variants (route_id);
create index route_variants_status_idx on public.route_variants (status);
-- At most one primary variant per route and direction.
create unique index route_variants_one_primary on public.route_variants (route_id, direction) where is_primary;

-- Ordered stops of a variant. Sequence starts at 1.
-- The key is DEFERRABLE so stops can be re-ordered inside one transaction.
create table public.route_variant_stops (
  variant_id            uuid not null references public.route_variants (id) on delete cascade,
  stop_sequence         smallint not null check (stop_sequence > 0),
  stop_id               uuid not null references public.stops (id) on delete restrict,
  distance_from_start_m numeric(9, 1) check (distance_from_start_m is null or distance_from_start_m >= 0),
  boarding_allowed      boolean not null default true,
  alighting_allowed     boolean not null default true,
  constraint route_variant_stops_pkey primary key (variant_id, stop_sequence) deferrable initially immediate
);
create index route_variant_stops_stop_idx on public.route_variant_stops (stop_id);

-- Path of a variant. Old versions are kept; one is "current".
create table public.route_geometries (
  id                uuid primary key default gen_random_uuid(),
  variant_id        uuid not null references public.route_variants (id) on delete cascade,
  geom              extensions.geography(LineString, 4326) not null,
  length_m          numeric(10, 1),
  -- 'gps_trace', 'drawn', 'osm', 'imported'
  capture_method    text not null default 'gps_trace'
                    check (capture_method in ('gps_trace', 'drawn', 'osm', 'imported')),
  is_current        boolean not null default true,
  status            public.record_status not null default 'draft',
  last_verified_on  date,
  next_review_on    date,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id) on delete set null,
  updated_at        timestamptz not null default now()
);
create index route_geometries_geom_gix on public.route_geometries using gist (geom);
create unique index route_geometries_one_current on public.route_geometries (variant_id) where is_current;

create or replace function private.set_geometry_length()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if extensions.st_npoints(new.geom::extensions.geometry) < 2 then
    raise exception 'A route line needs at least 2 points' using errcode = '22023';
  end if;
  new.length_m := round(extensions.st_length(new.geom)::numeric, 1);
  return new;
end;
$$;
create trigger route_geometries_length before insert or update of geom on public.route_geometries
  for each row execute function private.set_geometry_length();

-- ---------------------------------------------------------------------
-- Fares
-- fare_rules         : formula fares (minimum fare for first N km + per km)
-- fare_matrices      : stop-to-stop fare tables (UV Express, provincial bus)
-- fare_matrix_entries: one row per origin/destination stop pair
-- ---------------------------------------------------------------------
create table public.fare_rules (
  id                      uuid primary key default gen_random_uuid(),
  mode_code               text not null references public.transport_modes (code) on update cascade,
  -- Where the rule applies, e.g. 'NCR', 'Region III', 'Marilao, Bulacan'
  area_scope              text not null check (char_length(area_scope) between 2 and 120),
  minimum_fare            numeric(8, 2) not null check (minimum_fare >= 0),
  minimum_distance_km     numeric(6, 2) not null default 0 check (minimum_distance_km >= 0),
  succeeding_km_rate      numeric(8, 2) not null default 0 check (succeeding_km_rate >= 0),
  -- Published discounted amounts (students, seniors, PWDs). NULL = unknown.
  discounted_minimum_fare numeric(8, 2) check (discounted_minimum_fare is null or discounted_minimum_fare >= 0),
  discounted_km_rate      numeric(8, 2) check (discounted_km_rate is null or discounted_km_rate >= 0),
  -- Rounding step in pesos if the issuing document states one. NULL = not stated.
  rounding_step           numeric(4, 2) check (rounding_step is null or rounding_step > 0),
  legal_basis             text not null check (char_length(legal_basis) between 3 and 200),
  effective_from          date not null,
  effective_to            date,
  status                  public.record_status not null default 'draft',
  last_verified_on        date,
  next_review_on          date,
  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_by              uuid references public.profiles (id) on delete set null,
  updated_at              timestamptz not null default now(),
  constraint fare_rules_period check (effective_to is null or effective_to > effective_from),
  -- Two VERIFIED rules for the same mode and area may not overlap in time.
  constraint fare_rules_no_overlap exclude using gist (
    mode_code with =,
    area_scope with =,
    daterange(effective_from, effective_to, '[)') with &&
  ) where (status in ('verified', 'needs_recheck'))
);
create index fare_rules_mode_idx on public.fare_rules (mode_code, area_scope);

create table public.fare_matrices (
  id               uuid primary key default gen_random_uuid(),
  route_variant_id uuid not null references public.route_variants (id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 120),
  legal_basis      text check (legal_basis is null or char_length(legal_basis) <= 200),
  effective_from   date not null,
  effective_to     date,
  status           public.record_status not null default 'draft',
  last_verified_on date,
  next_review_on   date,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null,
  updated_at       timestamptz not null default now(),
  constraint fare_matrices_period check (effective_to is null or effective_to > effective_from)
);
create index fare_matrices_variant_idx on public.fare_matrices (route_variant_id);

create table public.fare_matrix_entries (
  matrix_id       uuid not null references public.fare_matrices (id) on delete cascade,
  from_stop_id    uuid not null references public.stops (id) on delete restrict,
  to_stop_id      uuid not null references public.stops (id) on delete restrict,
  regular_fare    numeric(8, 2) not null check (regular_fare >= 0),
  discounted_fare numeric(8, 2) check (discounted_fare is null or discounted_fare >= 0),
  primary key (matrix_id, from_stop_id, to_stop_id),
  constraint fare_matrix_entries_distinct check (from_stop_id <> to_stop_id)
);

-- ---------------------------------------------------------------------
-- Evidence: links a source to exactly ONE record, saying what it proves.
-- Uses one nullable foreign key per target table (real FKs, no guessing).
-- ---------------------------------------------------------------------
create table public.evidence (
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid not null references public.sources (id) on delete restrict,
  claim             public.evidence_claim not null,
  note              text check (note is null or char_length(note) <= 1000),
  operator_id       uuid references public.operators (id) on delete cascade,
  terminal_id       uuid references public.terminals (id) on delete cascade,
  stop_id           uuid references public.stops (id) on delete cascade,
  route_id          uuid references public.routes (id) on delete cascade,
  route_variant_id  uuid references public.route_variants (id) on delete cascade,
  route_geometry_id uuid references public.route_geometries (id) on delete cascade,
  fare_rule_id      uuid references public.fare_rules (id) on delete cascade,
  fare_matrix_id    uuid references public.fare_matrices (id) on delete cascade,
  created_by        uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  constraint evidence_one_target check (
    num_nonnulls(operator_id, terminal_id, stop_id, route_id, route_variant_id,
                 route_geometry_id, fare_rule_id, fare_matrix_id) = 1
  )
);
create index evidence_source_idx on public.evidence (source_id);
create index evidence_terminal_idx on public.evidence (terminal_id) where terminal_id is not null;
create index evidence_stop_idx on public.evidence (stop_id) where stop_id is not null;
create index evidence_route_idx on public.evidence (route_id) where route_id is not null;
create index evidence_variant_idx on public.evidence (route_variant_id) where route_variant_id is not null;
create index evidence_geometry_idx on public.evidence (route_geometry_id) where route_geometry_id is not null;
create index evidence_fare_rule_idx on public.evidence (fare_rule_id) where fare_rule_id is not null;
create index evidence_fare_matrix_idx on public.evidence (fare_matrix_id) where fare_matrix_id is not null;
create index evidence_operator_idx on public.evidence (operator_id) where operator_id is not null;

-- ---------------------------------------------------------------------
-- Verification records: append-only history of review decisions.
-- Inserting one is the ONLY way to change a record's status to
-- verified / needs_recheck / retired (enforced by triggers below).
-- ---------------------------------------------------------------------
create table public.verification_records (
  id                uuid primary key default gen_random_uuid(),
  status_to         public.record_status not null check (status_to in ('verified', 'needs_recheck', 'retired', 'draft')),
  method            public.verification_method not null,
  observed_on       date not null,
  next_review_on    date,
  notes             text check (notes is null or char_length(notes) <= 2000),
  verified_by       uuid not null references public.profiles (id) on delete restrict default auth.uid(),
  verified_at       timestamptz not null default now(),
  operator_id       uuid references public.operators (id) on delete cascade,
  terminal_id       uuid references public.terminals (id) on delete cascade,
  stop_id           uuid references public.stops (id) on delete cascade,
  route_id          uuid references public.routes (id) on delete cascade,
  route_variant_id  uuid references public.route_variants (id) on delete cascade,
  route_geometry_id uuid references public.route_geometries (id) on delete cascade,
  fare_rule_id      uuid references public.fare_rules (id) on delete cascade,
  fare_matrix_id    uuid references public.fare_matrices (id) on delete cascade,
  constraint verification_one_target check (
    num_nonnulls(operator_id, terminal_id, stop_id, route_id, route_variant_id,
                 route_geometry_id, fare_rule_id, fare_matrix_id) = 1
  ),
  constraint verification_review_after_observation check (next_review_on is null or next_review_on > observed_on)
);
create index verification_terminal_idx on public.verification_records (terminal_id, verified_at desc) where terminal_id is not null;
create index verification_stop_idx on public.verification_records (stop_id, verified_at desc) where stop_id is not null;
create index verification_route_idx on public.verification_records (route_id, verified_at desc) where route_id is not null;
create index verification_variant_idx on public.verification_records (route_variant_id, verified_at desc) where route_variant_id is not null;
create index verification_geometry_idx on public.verification_records (route_geometry_id) where route_geometry_id is not null;
create index verification_fare_rule_idx on public.verification_records (fare_rule_id) where fare_rule_id is not null;
create index verification_fare_matrix_idx on public.verification_records (fare_matrix_id) where fare_matrix_id is not null;
create index verification_operator_idx on public.verification_records (operator_id) where operator_id is not null;

-- ---------------------------------------------------------------------
-- Status guard: blocks direct status changes to verified / needs_recheck /
-- retired. Only private.apply_verification (below) may make them; it runs
-- as the table owner and sets a transaction flag first. API users
-- (anon / authenticated) can never pass this check, even if they could
-- set the flag, because they are never the current_user inside it.
-- ---------------------------------------------------------------------
create or replace function private.guard_record_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_trusted boolean :=
    coalesce(current_setting('lakbay.via_verification', true), '') = 'on'
    and current_user not in ('anon', 'authenticated');
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'pending_review') and not v_trusted then
      raise exception 'New % records must start as draft or pending_review', tg_table_name
        using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status then
    if (new.status not in ('draft', 'pending_review') or old.status not in ('draft', 'pending_review'))
       and not v_trusted then
      raise exception 'Changing % status from % to % requires a verification record', tg_table_name, old.status, new.status
        using errcode = '42501',
              hint = 'Insert a row into public.verification_records instead.';
    end if;
  end if;
  if not v_trusted then
    -- Verification dates are owned by verification_records too.
    if tg_op = 'INSERT' then
      new.last_verified_on := null;
      new.next_review_on := null;
    else
      new.last_verified_on := old.last_verified_on;
      new.next_review_on := old.next_review_on;
    end if;
  end if;
  return new;
end;
$$;

-- Applies a verification record to its target and enforces "no evidence,
-- no verification".
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

create trigger verification_records_apply
  after insert on public.verification_records
  for each row execute function private.apply_verification();

-- Attach stamp, status guard and audit triggers to every status-bearing table.
do $$
declare
  t text;
begin
  foreach t in array array['operators', 'terminals', 'stops', 'routes', 'route_variants',
                           'route_geometries', 'fare_rules', 'fare_matrices', 'sources']
  loop
    execute format('create trigger %I before insert or update on public.%I
                    for each row execute function private.stamp_row()', t || '_stamp', t);
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function private.write_audit()', t || '_audit', t);
    if t <> 'sources' then
      execute format('create trigger %I before insert or update on public.%I
                      for each row execute function private.guard_record_status()', t || '_guard_status', t);
    end if;
  end loop;
end;
$$;

-- Child tables and evidence are audited too.
create trigger route_variant_stops_audit after insert or update or delete on public.route_variant_stops
  for each row execute function private.write_audit();
create trigger fare_matrix_entries_audit after insert or update or delete on public.fare_matrix_entries
  for each row execute function private.write_audit();
create trigger evidence_audit after insert or update or delete on public.evidence
  for each row execute function private.write_audit();
create trigger verification_records_audit after insert on public.verification_records
  for each row execute function private.write_audit();
