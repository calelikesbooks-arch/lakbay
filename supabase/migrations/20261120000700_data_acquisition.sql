-- =====================================================================
-- LAKBAY migration 7: data acquisition (source registry, import runs,
-- staging area, admin review queue) + stricter verification rule
-- =====================================================================
-- Imported data NEVER goes straight into the transport tables.
--   1. The pipeline writes candidates into public.staged_features.
--   2. A moderator reviews them in the admin review queue.
--   3. "Promote" creates a DRAFT record with the import cited as evidence.
--   4. Only a field survey, official document or operator source can then
--      make it 'verified' (rule enforced below). OpenStreetMap, GTFS hints
--      and community reports alone can never verify anything.

create type public.provider_status as enum ('approved', 'restricted', 'pending_review', 'rejected');
create type public.import_run_status as enum ('running', 'completed', 'failed');
create type public.staged_kind as enum ('terminal', 'stop', 'route');
create type public.staged_quality as enum ('ok', 'warning', 'blocked');
create type public.staged_review_status as enum ('pending', 'needs_info', 'promoted', 'linked', 'rejected');

-- ---------------------------------------------------------------------
-- 1. Data source registry
-- usage_status = 'approved' is required before the pipeline may import.
-- ---------------------------------------------------------------------
create table public.data_providers (
  code              text primary key check (code ~ '^[a-z][a-z0-9_]{2,40}$'),
  name              text not null check (char_length(name) between 3 and 160),
  provider_type     text not null check (provider_type in
                      ('community_map', 'government', 'operator', 'open_dataset', 'field_survey', 'commercial')),
  homepage_url      text check (homepage_url is null or homepage_url ~ '^https?://'),
  license_name      text not null check (char_length(license_name) between 2 and 160),
  license_url       text check (license_url is null or license_url ~ '^https?://'),
  attribution_text  text not null check (char_length(attribution_text) between 2 and 300),
  terms_url         text check (terms_url is null or terms_url ~ '^https?://'),
  access_method     text not null check (access_method in ('api', 'download', 'manual')),
  rate_limit_policy text check (rate_limit_policy is null or char_length(rate_limit_policy) <= 500),
  usage_status      public.provider_status not null default 'pending_review',
  usage_notes       text check (usage_notes is null or char_length(usage_notes) <= 2000),
  -- What a record from this provider may prove (see apply_verification).
  can_verify        boolean not null default false,
  last_reviewed_on  date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger data_providers_touch before update on public.data_providers
  for each row execute function private.touch_updated_at();
create trigger data_providers_audit after insert or update or delete on public.data_providers
  for each row execute function private.write_audit();

insert into public.data_providers
  (code, name, provider_type, homepage_url, license_name, license_url, attribution_text, terms_url,
   access_method, rate_limit_policy, usage_status, usage_notes, can_verify, last_reviewed_on)
values
  ('openstreetmap_overpass', 'OpenStreetMap (via Overpass API)', 'community_map',
   'https://www.openstreetmap.org', 'Open Database License (ODbL) 1.0', 'https://opendatacommons.org/licenses/odbl/1-0/',
   '© OpenStreetMap contributors', 'https://wiki.openstreetmap.org/wiki/Overpass_API',
   'api',
   'Public instance: about 10,000 queries and 1 GB per day for one-off use; divide by 100 for regular use; counted per application; identify with a custom User-Agent.',
   'approved',
   'Community-mapped. Route relations show where mappers recorded a service, not that it currently runs. ODbL share-alike applies to derivative databases: keep provenance so OSM-derived records can be exported.',
   false, '2026-11-20'),
  ('lakbay_field_survey', 'LAKBAY field surveys', 'field_survey',
   null, 'LAKBAY own data', null, 'LAKBAY field survey', null,
   'manual', null, 'approved',
   'Rides and walks recorded by LAKBAY researchers and trained mappers (docs/survey-protocol.md). Imported through the CSV importer with observer and date.',
   true, '2026-11-20'),
  ('ltfrb_issuances', 'LTFRB memorandum circulars and fare matrices', 'government',
   'https://ltfrb.gov.ph', 'Public government issuance (confirm reuse terms)', null,
   'Land Transportation Franchising and Regulatory Board', null,
   'manual', 'Do not scrape. Enter documents manually with circular number and date.', 'approved',
   'Official fares and franchise route descriptions.', true, '2026-11-20'),
  ('lgu_records', 'Municipal ordinances and route plans (Marilao, Meycauayan, Bocaue)', 'government',
   null, 'Public record (confirm reuse terms)', null, 'Municipal Government (named per document)', null,
   'manual', 'Request through FOI (foi.gov.ph) or the municipal hall.', 'approved',
   'Tricycle fare ordinances, Local Public Transport Route Plans (LPTRP), terminal designations.', true, '2026-11-20'),
  ('psa_psgc', 'PSA Philippine Standard Geographic Code', 'government',
   'https://psa.gov.ph/classification/psgc', 'Government open data (confirm terms)', null,
   'Philippine Statistics Authority', null,
   'download', null, 'approved',
   'Official names and codes of regions, provinces, cities, municipalities and barangays. Contains no coordinates.', false, '2026-11-20'),
  ('rail_operators', 'Rail operator publications (LRT-1, LRT-2, MRT-3, PNR)', 'operator',
   null, 'Operator publication (confirm reuse terms)', null, 'Named per document', null,
   'manual', 'Do not scrape. Record station lists and fare tables manually with the page URL and date.', 'approved',
   'Station names, operating hours and fare tables from official operator pages.', true, '2026-11-20'),
  ('dotc_ptis_gtfs', 'DOTC Philippine Transit Information Service GTFS (Metro Manila)', 'open_dataset',
   'https://github.com/sakayph/gtfs', 'Unclear: read the LICENSE file in the repository before use', null,
   'DOTC Philippine Transit App Challenge data', null,
   'download', 'One-time manual download.', 'pending_review',
   'Released for the Philippine Transit App Challenge. Metro Manila only, about a decade old. At most a hint for what to field-check. Approve only after the license is confirmed.',
   false, '2026-11-20'),
  ('sakay_ph', 'Sakay.ph', 'commercial', 'https://sakay.ph', 'Proprietary', null, 'Sakay.ph', null,
   'manual', null, 'rejected', 'Proprietary journey planner. Do not copy or scrape.', false, '2026-11-20'),
  ('google_maps', 'Google Maps', 'commercial', 'https://www.google.com/maps', 'Proprietary', null, 'Google', null,
   'manual', null, 'rejected', 'Terms prohibit extracting data. Do not copy coordinates or routes.', false, '2026-11-20');

-- ---------------------------------------------------------------------
-- 2. Import areas (where the pipeline has run). Boundaries come from
--    OpenStreetMap administrative relations at import time, never typed in.
-- ---------------------------------------------------------------------
create table public.import_areas (
  code                text primary key check (code ~ '^[a-z0-9][a-z0-9-]{2,60}$'),
  name                text not null,
  municipality        text not null,
  province            text not null,
  region              text,
  osm_admin_level     smallint,
  osm_parent_name     text,
  osm_parent_level    smallint,
  osm_relation_id     bigint,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger import_areas_touch before update on public.import_areas
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. Import runs (one per pipeline execution and area)
-- ---------------------------------------------------------------------
create table public.import_runs (
  id                 uuid primary key default gen_random_uuid(),
  provider_code      text not null references public.data_providers (code),
  area_code          text references public.import_areas (code),
  run_kind           text not null check (run_kind in ('osm_overpass', 'gtfs', 'csv')),
  status             public.import_run_status not null default 'running',
  params             jsonb not null default '{}'::jsonb,
  stats              jsonb not null default '{}'::jsonb,
  -- SHA-256 of the raw downloaded/loaded data, for reproducibility
  snapshot_sha256    text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  -- e.g. Overpass "timestamp_osm_base": how fresh the OSM data was
  upstream_timestamp timestamptz,
  error              text,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  created_by         uuid references public.profiles (id) on delete set null default auth.uid()
);
create index import_runs_provider_idx on public.import_runs (provider_code, started_at desc);

-- ---------------------------------------------------------------------
-- 4. Staging area: candidates waiting for review. NOT public, NOT used by
--    the app, routing or the map.
-- ---------------------------------------------------------------------
create table public.staged_features (
  id                     uuid primary key default gen_random_uuid(),
  provider_code          text not null references public.data_providers (code),
  -- Stable id in the provider, e.g. "osm:node/123", "gtfs:stop/ABC", "survey:MAR-T-001"
  external_id            text not null check (char_length(external_id) between 3 and 200),
  external_url           text check (external_url is null or external_url ~ '^https?://'),
  kind                   public.staged_kind not null,
  -- terminal: terminal_kind values; stop: stop_kind values; route: 'route'
  classification         text not null,
  name                   text,
  alt_names              text[] not null default '{}',
  ref                    text,
  operator_name          text,
  network                text,
  from_label             text,
  to_label               text,
  -- Possible transport_modes codes. Empty = unknown. Never a confirmed fact.
  mode_hints             text[] not null default '{}',
  mode_confidence        text not null default 'unknown' check (mode_confidence in ('tagged', 'inferred', 'unknown')),
  area_code              text references public.import_areas (code),
  municipality           text,
  province               text,
  location               extensions.geography(Point, 4326) check (location is null or private.in_philippines(location)),
  path                   extensions.geography(LineString, 4326),
  path_complete          boolean,
  raw_tags               jsonb not null default '{}'::jsonb,
  attributes             jsonb not null default '{}'::jsonb,
  issues                 jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  quality                public.staged_quality not null,
  upstream_version       text,
  upstream_timestamp     timestamptz,
  content_hash           text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  first_run_id           uuid not null references public.import_runs (id),
  last_run_id            uuid not null references public.import_runs (id),
  last_seen_at           timestamptz not null default now(),
  review_status          public.staged_review_status not null default 'pending',
  changed_since_review   boolean not null default false,
  batch_duplicate_of     uuid references public.staged_features (id) on delete set null,
  matched_table          text check (matched_table is null or matched_table in ('terminals', 'stops', 'routes')),
  matched_id             uuid,
  match_distance_m       numeric(9, 1),
  match_name_similarity  real,
  reviewed_by            uuid references public.profiles (id) on delete set null,
  reviewed_at            timestamptz,
  review_notes           text check (review_notes is null or char_length(review_notes) <= 2000),
  promoted_table         text check (promoted_table is null or promoted_table in ('terminals', 'stops', 'routes')),
  promoted_id            uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint staged_features_provider_external_uniq unique (provider_code, external_id),
  constraint staged_point_or_path check (
    (kind in ('terminal', 'stop') and path is null) or (kind = 'route' and location is null)
  )
);
create index staged_features_location_gix on public.staged_features using gist (location);
create index staged_features_queue_idx on public.staged_features (review_status, quality, kind);
create index staged_features_run_idx on public.staged_features (last_run_id);
create trigger staged_features_touch before update on public.staged_features
  for each row execute function private.touch_updated_at();

-- Ordered stop members of a staged route (as listed by the provider).
create table public.staged_route_members (
  route_id            uuid not null references public.staged_features (id) on delete cascade,
  member_seq          integer not null check (member_seq > 0),
  member_external_id  text not null,
  member_role         text,
  primary key (route_id, member_seq)
);

-- ---------------------------------------------------------------------
-- 5. Stricter verification: only field surveys, official documents and
--    operator sources can make a record 'verified'.
-- ---------------------------------------------------------------------
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
  v_has_primary boolean;
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

  if new.status_to = 'verified' then
    execute format(
      'select exists (select 1 from public.evidence e join public.sources s on s.id = e.source_id
                      where e.%I = $1 and s.source_type in (''field_survey'', ''official_document'', ''operator''))', v_fk)
      into v_has_primary using v_id;
    if not v_has_primary then
      raise exception 'Cannot verify % %: OpenStreetMap, datasets or community reports alone cannot verify. Attach a field survey, official document or operator source.',
        v_table, v_id using errcode = '23514';
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

-- ---------------------------------------------------------------------
-- 6. Pipeline RPCs (moderators/admins only; SECURITY DEFINER with checks)
-- ---------------------------------------------------------------------
create or replace function private.require_moderator()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_moderator() then
    raise exception 'Only moderators and admins can run imports or review staged data' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.upsert_import_area(
  p_code text, p_name text, p_municipality text, p_province text, p_region text,
  p_admin_level smallint, p_parent_name text, p_parent_level smallint, p_relation_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_moderator();
  insert into public.import_areas
    (code, name, municipality, province, region, osm_admin_level, osm_parent_name, osm_parent_level, osm_relation_id)
  values (p_code, p_name, p_municipality, p_province, p_region, p_admin_level, p_parent_name, p_parent_level, p_relation_id)
  on conflict (code) do update set
    name = excluded.name, municipality = excluded.municipality, province = excluded.province,
    region = excluded.region, osm_admin_level = excluded.osm_admin_level,
    osm_parent_name = excluded.osm_parent_name, osm_parent_level = excluded.osm_parent_level,
    osm_relation_id = coalesce(excluded.osm_relation_id, public.import_areas.osm_relation_id);
end;
$$;

create or replace function public.start_import_run(
  p_provider_code text, p_area_code text, p_run_kind text, p_params jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.provider_status;
  v_id uuid;
begin
  perform private.require_moderator();
  select usage_status into v_status from public.data_providers where code = p_provider_code;
  if not found then
    raise exception 'Unknown data provider %', p_provider_code using errcode = 'P0002';
  end if;
  if v_status <> 'approved' then
    raise exception 'Provider % is %, not approved for import. Review its license first.', p_provider_code, v_status
      using errcode = '42501';
  end if;
  insert into public.import_runs (provider_code, area_code, run_kind, params, created_by)
  values (p_provider_code, p_area_code, p_run_kind, coalesce(p_params, '{}'::jsonb), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.finish_import_run(
  p_run_id uuid, p_status public.import_run_status, p_stats jsonb,
  p_snapshot_sha256 text default null, p_upstream_timestamp timestamptz default null, p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.import_runs%rowtype;
begin
  perform private.require_moderator();
  update public.import_runs
  set status = p_status, stats = coalesce(p_stats, '{}'::jsonb), snapshot_sha256 = p_snapshot_sha256,
      upstream_timestamp = p_upstream_timestamp, error = left(p_error, 2000), finished_at = now()
  where id = p_run_id and status = 'running'
  returning * into v_run;
  if not found then
    raise exception 'Run % not found or already finished', p_run_id using errcode = 'P0002';
  end if;

  -- Candidates from earlier runs of the same provider and area(s) that this
  -- completed run no longer contains: flag them (deleted or retagged upstream).
  -- Areas = the run's area_code, or params.area_codes for multi-area runs.
  if p_status = 'completed' then
    update public.staged_features
    set attributes = attributes || jsonb_build_object('missing_in_latest_run', true),
        changed_since_review = case when review_status in ('promoted', 'linked') then true else changed_since_review end
    where provider_code = v_run.provider_code
      and area_code is not null
      and (area_code = v_run.area_code
           or area_code in (select jsonb_array_elements_text(coalesce(v_run.params -> 'area_codes', '[]'::jsonb))))
      and last_run_id <> v_run.id
      and coalesce((attributes ->> 'missing_in_latest_run')::boolean, false) = false;
  end if;
end;
$$;

-- Inserts or updates candidates by (provider, external_id). Keeps review
-- decisions; flags changes that happen after a review.
create or replace function public.upsert_staged_features(p_run_id uuid, p_features jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.import_runs%rowtype;
  f jsonb;
  v_existing record;
  v_id uuid;
  v_location extensions.geography;
  v_path extensions.geography;
  v_attributes jsonb;
  v_inserted int := 0;
  v_updated int := 0;
  v_unchanged int := 0;
  v_changed_after_review int := 0;
  m jsonb;
  v_seq int;
begin
  perform private.require_moderator();
  select * into v_run from public.import_runs where id = p_run_id;
  if not found or v_run.status <> 'running' then
    raise exception 'Run % is not running', p_run_id using errcode = '22023';
  end if;
  if jsonb_typeof(p_features) <> 'array' or jsonb_array_length(p_features) > 500 then
    raise exception 'Send features as a JSON array of at most 500 items' using errcode = '22023';
  end if;

  for f in select * from jsonb_array_elements(p_features)
  loop
    v_location := null;
    v_path := null;
    v_attributes := coalesce(f -> 'attributes', '{}'::jsonb);
    if f ? 'lon' and f ? 'lat' and f ->> 'lon' is not null and f ->> 'lat' is not null then
      v_location := extensions.st_setsrid(
        extensions.st_makepoint((f ->> 'lon')::double precision, (f ->> 'lat')::double precision), 4326)::extensions.geography;
      -- Impossible coordinates (e.g. swapped) are NOT stored as a location;
      -- they are kept only as a note for the reviewer (the pipeline marks
      -- such candidates as blocked).
      if not private.in_philippines(v_location) then
        v_attributes := v_attributes || jsonb_build_object('rejected_coordinates',
                          jsonb_build_array((f ->> 'lon')::double precision, (f ->> 'lat')::double precision));
        v_location := null;
      end if;
    end if;
    if f ? 'path' and jsonb_typeof(f -> 'path') = 'object' then
      v_path := extensions.st_setsrid(extensions.st_geomfromgeojson((f -> 'path')::text), 4326)::extensions.geography;
    end if;

    select id, content_hash, review_status into v_existing
    from public.staged_features
    where provider_code = v_run.provider_code and external_id = f ->> 'external_id'
    for update;

    if not found then
      insert into public.staged_features (
        provider_code, external_id, external_url, kind, classification, name, alt_names, ref, operator_name,
        network, from_label, to_label, mode_hints, mode_confidence, area_code, municipality, province,
        location, path, path_complete, raw_tags, attributes, issues, quality, upstream_version,
        upstream_timestamp, content_hash, first_run_id, last_run_id
      ) values (
        v_run.provider_code, f ->> 'external_id', f ->> 'external_url', (f ->> 'kind')::public.staged_kind,
        f ->> 'classification', f ->> 'name',
        coalesce(array(select jsonb_array_elements_text(f -> 'alt_names')), '{}'),
        f ->> 'ref', f ->> 'operator_name', f ->> 'network', f ->> 'from_label', f ->> 'to_label',
        coalesce(array(select jsonb_array_elements_text(f -> 'mode_hints')), '{}'),
        coalesce(f ->> 'mode_confidence', 'unknown'),
        f ->> 'area_code', f ->> 'municipality', f ->> 'province',
        v_location, v_path, (f ->> 'path_complete')::boolean,
        coalesce(f -> 'raw_tags', '{}'::jsonb), v_attributes,
        coalesce(f -> 'issues', '[]'::jsonb), (f ->> 'quality')::public.staged_quality,
        f ->> 'upstream_version', (f ->> 'upstream_timestamp')::timestamptz,
        f ->> 'content_hash', v_run.id, v_run.id
      ) returning id into v_id;
      v_inserted := v_inserted + 1;
    elsif v_existing.content_hash = f ->> 'content_hash' then
      update public.staged_features
      set last_run_id = v_run.id, last_seen_at = now(),
          attributes = attributes - 'missing_in_latest_run'
      where id = v_existing.id;
      v_id := v_existing.id;
      v_unchanged := v_unchanged + 1;
    else
      update public.staged_features set
        external_url = f ->> 'external_url', classification = f ->> 'classification', name = f ->> 'name',
        alt_names = coalesce(array(select jsonb_array_elements_text(f -> 'alt_names')), '{}'),
        ref = f ->> 'ref', operator_name = f ->> 'operator_name', network = f ->> 'network',
        from_label = f ->> 'from_label', to_label = f ->> 'to_label',
        mode_hints = coalesce(array(select jsonb_array_elements_text(f -> 'mode_hints')), '{}'),
        mode_confidence = coalesce(f ->> 'mode_confidence', 'unknown'),
        area_code = coalesce(f ->> 'area_code', area_code),
        municipality = coalesce(f ->> 'municipality', municipality), province = coalesce(f ->> 'province', province),
        location = v_location, path = v_path, path_complete = (f ->> 'path_complete')::boolean,
        raw_tags = coalesce(f -> 'raw_tags', '{}'::jsonb), attributes = v_attributes,
        issues = coalesce(f -> 'issues', '[]'::jsonb), quality = (f ->> 'quality')::public.staged_quality,
        upstream_version = f ->> 'upstream_version', upstream_timestamp = (f ->> 'upstream_timestamp')::timestamptz,
        content_hash = f ->> 'content_hash', last_run_id = v_run.id, last_seen_at = now(),
        changed_since_review = changed_since_review or review_status in ('promoted', 'linked', 'rejected')
      where id = v_existing.id;
      v_id := v_existing.id;
      v_updated := v_updated + 1;
      if v_existing.review_status in ('promoted', 'linked', 'rejected') then
        v_changed_after_review := v_changed_after_review + 1;
      end if;
    end if;

    if f ->> 'kind' = 'route' then
      delete from public.staged_route_members where route_id = v_id;
      v_seq := 0;
      for m in select * from jsonb_array_elements(coalesce(f -> 'members', '[]'::jsonb))
      loop
        v_seq := v_seq + 1;
        insert into public.staged_route_members (route_id, member_seq, member_external_id, member_role)
        values (v_id, v_seq, m ->> 'external_id', m ->> 'role');
      end loop;
    end if;
  end loop;

  -- Resolve "duplicate within this batch" pointers sent by the pipeline.
  update public.staged_features s
  set batch_duplicate_of = d.id
  from jsonb_array_elements(p_features) f2
  join public.staged_features d
    on d.provider_code = v_run.provider_code and d.external_id = f2 ->> 'batch_duplicate_of'
  where f2 ->> 'batch_duplicate_of' is not null
    and s.provider_code = v_run.provider_code
    and s.external_id = f2 ->> 'external_id';

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged,
                            'changed_after_review', v_changed_after_review);
end;
$$;

-- Duplicate detection against records ALREADY in LAKBAY.
create or replace function public.match_staged_run(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  perform private.require_moderator();

  with candidates as (
    select s.id as staged_id, m.table_name, m.id as match_id, m.distance_m, m.sim
    from public.staged_features s
    cross join lateral (
      select x.table_name, x.id, x.distance_m, x.sim
      from (
        select 'terminals'::text as table_name, t.id,
               extensions.st_distance(t.location, s.location) as distance_m,
               extensions.similarity(private.normalize_name(t.name), private.normalize_name(coalesce(s.name, ''))) as sim
        from public.terminals t
        where s.kind = 'terminal' and t.status <> 'retired'
          and extensions.st_dwithin(t.location, s.location, 150)
        union all
        select 'stops', st.id,
               extensions.st_distance(st.location, s.location),
               extensions.similarity(private.normalize_name(st.name), private.normalize_name(coalesce(s.name, '')))
        from public.stops st
        where s.kind = 'stop' and st.status <> 'retired'
          and extensions.st_dwithin(st.location, s.location, 60)
      ) x
      where x.distance_m <= 15 or x.sim >= 0.35
      order by x.sim desc, x.distance_m
      limit 1
    ) m
    where s.last_run_id = p_run_id and s.location is not null and s.review_status in ('pending', 'needs_info')
  )
  update public.staged_features s
  set matched_table = c.table_name, matched_id = c.match_id,
      match_distance_m = round(c.distance_m::numeric, 1), match_name_similarity = c.sim
  from candidates c
  where s.id = c.staged_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Creates or reuses a source row that cites the staged record.
create or replace function private.source_for_staged(p_staged public.staged_features)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.data_providers%rowtype;
  v_run public.import_runs%rowtype;
  v_type public.source_type;
  v_id uuid;
  v_title text;
  v_observed date;
  v_published date;
begin
  select * into v_provider from public.data_providers where code = p_staged.provider_code;
  select * into v_run from public.import_runs where id = p_staged.last_run_id;

  v_type := case v_provider.provider_type
    when 'community_map' then 'openstreetmap'
    when 'field_survey' then 'field_survey'
    when 'government' then 'official_document'
    when 'operator' then 'operator'
    else 'other'
  end::public.source_type;

  -- CSV rows carry their own source details (field survey or document).
  if p_staged.attributes ? 'source' then
    v_type := coalesce(nullif(p_staged.attributes -> 'source' ->> 'type', ''), v_type::text)::public.source_type;
    v_title := left(p_staged.attributes -> 'source' ->> 'title', 300);
    v_observed := (p_staged.attributes -> 'source' ->> 'observed_on')::date;
    v_published := (p_staged.attributes -> 'source' ->> 'published_on')::date;
  end if;

  v_title := coalesce(v_title, left(format('%s: %s (%s)', v_provider.name, coalesce(p_staged.name, p_staged.ref, 'unnamed'),
                                           p_staged.external_id), 300));
  v_published := coalesce(v_published, p_staged.upstream_timestamp::date);
  if v_published is null and v_observed is null then
    v_published := coalesce(v_run.upstream_timestamp::date, v_run.started_at::date);
  end if;

  if p_staged.external_url is not null then
    select id into v_id from public.sources where lower(url) = lower(p_staged.external_url);
    if found then
      return v_id;
    end if;
  end if;

  insert into public.sources
    (source_type, title, url, publisher, document_number, published_on, observed_on, retrieved_at, notes)
  values (
    v_type, v_title, p_staged.external_url, left(v_provider.attribution_text, 160),
    left(p_staged.attributes -> 'source' ->> 'document_number', 120),
    v_published, v_observed, coalesce(v_run.finished_at, v_run.started_at),
    left(format('License: %s. Attribution: %s. Imported by the LAKBAY pipeline (run %s, %s).',
                v_provider.license_name, v_provider.attribution_text, v_run.id, p_staged.external_id), 2000)
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Promote a terminal/stop candidate to a DRAFT record.
create or replace function public.promote_staged_feature(
  p_staged_id uuid,
  p_municipality text default null,
  p_province text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.staged_features%rowtype;
  v_new uuid;
  v_source uuid;
  v_municipality text;
  v_province text;
  v_note text;
begin
  perform private.require_moderator();
  select * into s from public.staged_features where id = p_staged_id for update;
  if not found then
    raise exception 'Staged feature not found' using errcode = 'P0002';
  end if;
  if s.kind = 'route' then
    raise exception 'Use promote_staged_route for routes' using errcode = '22023';
  end if;
  if s.review_status not in ('pending', 'needs_info') then
    raise exception 'Already reviewed (%)', s.review_status using errcode = '22023';
  end if;
  if s.quality = 'blocked' then
    raise exception 'This candidate has blocking issues and cannot be promoted' using errcode = '22023';
  end if;
  if s.location is null or coalesce(btrim(s.name), '') = '' then
    raise exception 'A candidate needs real coordinates and a name before promotion' using errcode = '22023';
  end if;

  v_municipality := coalesce(nullif(btrim(p_municipality), ''), s.municipality);
  v_province := coalesce(nullif(btrim(p_province), ''), s.province);
  if v_municipality is null or v_province is null then
    raise exception 'Municipality and province are unknown for this candidate. Enter them (from your own knowledge or PSGC) to promote.'
      using errcode = '22023';
  end if;

  if s.kind = 'terminal' then
    insert into public.terminals (name, alt_names, terminal_kind, location, municipality, province, status, notes)
    values (btrim(s.name), s.alt_names, s.classification::public.terminal_kind, s.location, v_municipality, v_province, 'draft',
            left(concat_ws(' ', 'Imported candidate', s.external_id || '.', p_notes), 2000))
    returning id into v_new;
  else
    insert into public.stops (name, alt_names, stop_kind, location, municipality, province, status, notes)
    values (btrim(s.name), s.alt_names, s.classification::public.stop_kind, s.location, v_municipality, v_province, 'draft',
            left(concat_ws(' ', 'Imported candidate', s.external_id || '.', p_notes), 2000))
    returning id into v_new;
  end if;

  v_source := private.source_for_staged(s);
  v_note := format('Imported from %s (%s). Not verified: confirm on the ground.', s.provider_code, s.external_id);
  if s.kind = 'terminal' then
    insert into public.evidence (source_id, claim, terminal_id, note) values
      (v_source, 'existence', v_new, v_note), (v_source, 'location', v_new, v_note);
  else
    insert into public.evidence (source_id, claim, stop_id, note) values
      (v_source, 'existence', v_new, v_note), (v_source, 'location', v_new, v_note);
  end if;

  update public.staged_features
  set review_status = 'promoted', promoted_table = case s.kind when 'terminal' then 'terminals' else 'stops' end,
      promoted_id = v_new, reviewed_by = (select auth.uid()), reviewed_at = now(),
      review_notes = p_notes, changed_since_review = false
  where id = s.id;
  return v_new;
end;
$$;

-- Promote a route candidate to a DRAFT route + variant (+ geometry and
-- stops when they are available). The reviewer MUST choose the mode.
create or replace function public.promote_staged_route(
  p_staged_id uuid,
  p_mode_code text,
  p_direction public.route_direction default 'outbound',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.staged_features%rowtype;
  v_route uuid;
  v_variant uuid;
  v_source uuid;
  v_geometry uuid;
  v_seq int := 0;
  v_linked int := 0;
  v_skipped int := 0;
  v_last_stop uuid;
  v_stop uuid;
  mem record;
  v_name text;
  v_note text;
begin
  perform private.require_moderator();
  select * into s from public.staged_features where id = p_staged_id for update;
  if not found or s.kind <> 'route' then
    raise exception 'Route candidate not found' using errcode = 'P0002';
  end if;
  if s.review_status not in ('pending', 'needs_info') then
    raise exception 'Already reviewed (%)', s.review_status using errcode = '22023';
  end if;
  if s.quality = 'blocked' then
    raise exception 'This route candidate has blocking issues and cannot be promoted' using errcode = '22023';
  end if;
  if not exists (select 1 from public.transport_modes where code = p_mode_code and is_active) then
    raise exception 'Choose a valid transport mode' using errcode = '22023';
  end if;

  v_name := left(coalesce(nullif(btrim(s.name), ''), nullif(btrim(s.ref), '')), 160);
  if v_name is null or char_length(v_name) < 3 then
    raise exception 'The route candidate has no usable name' using errcode = '22023';
  end if;

  begin
    insert into public.routes (mode_code, name, description, status)
    values (p_mode_code, v_name,
            left(concat_ws(' ', 'Imported candidate', s.external_id || '.',
                           case when s.from_label is not null or s.to_label is not null
                                then format('Mapped from "%s" to "%s".', coalesce(s.from_label, '?'), coalesce(s.to_label, '?')) end,
                           p_notes), 2000),
            'draft')
    returning id into v_route;
  exception when unique_violation then
    raise exception 'A route with this mode and name already exists. Link to it or rename first.' using errcode = '23505';
  end;

  insert into public.route_variants (route_id, direction, variant_name, is_primary, status)
  values (v_route, p_direction,
          left(coalesce(nullif(concat_ws(' → ', s.from_label, s.to_label), ''), 'Main'), 80), true, 'draft')
  returning id into v_variant;

  if s.path is not null and coalesce(s.path_complete, false) then
    insert into public.route_geometries (variant_id, geom, capture_method, status)
    values (v_variant, s.path, case when s.provider_code like '%gtfs%' then 'imported' else 'osm' end, 'draft')
    returning id into v_geometry;
  end if;

  -- Ordered stops: only members already promoted or linked to real records.
  for mem in
    select m.member_seq, f.promoted_table, f.promoted_id, f.matched_table, f.matched_id, f.review_status
    from public.staged_route_members m
    left join public.staged_features f
      on f.provider_code = s.provider_code and f.external_id = m.member_external_id
    where m.route_id = s.id
    order by m.member_seq
  loop
    v_stop := case
      when mem.review_status = 'promoted' and mem.promoted_table = 'stops' then mem.promoted_id
      when mem.review_status = 'linked' and mem.matched_table = 'stops' then mem.matched_id
    end;
    if v_stop is null then
      v_skipped := v_skipped + 1;
    elsif v_stop is distinct from v_last_stop then
      v_seq := v_seq + 1;
      insert into public.route_variant_stops (variant_id, stop_sequence, stop_id) values (v_variant, v_seq, v_stop);
      v_last_stop := v_stop;
      v_linked := v_linked + 1;
    end if;
  end loop;

  v_source := private.source_for_staged(s);
  v_note := format('Imported from %s (%s). A mapped route is not proof that the service runs today.', s.provider_code, s.external_id);
  insert into public.evidence (source_id, claim, route_id, note) values (v_source, 'existence', v_route, v_note);
  insert into public.evidence (source_id, claim, route_variant_id, note) values (v_source, 'stops', v_variant, v_note);
  if v_geometry is not null then
    insert into public.evidence (source_id, claim, route_geometry_id, note) values (v_source, 'path', v_geometry, v_note);
  end if;

  update public.staged_features
  set review_status = 'promoted', promoted_table = 'routes', promoted_id = v_route,
      reviewed_by = (select auth.uid()), reviewed_at = now(), review_notes = p_notes, changed_since_review = false
  where id = s.id;

  return jsonb_build_object('route_id', v_route, 'variant_id', v_variant, 'geometry_added', v_geometry is not null,
                            'stops_linked', v_linked, 'stops_skipped', v_skipped);
end;
$$;

-- The candidate is the same as an existing LAKBAY record: cite it there.
create or replace function public.link_staged_feature(p_staged_id uuid, p_target_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.staged_features%rowtype;
  v_table text;
  v_source uuid;
  v_note text;
  v_exists boolean;
begin
  perform private.require_moderator();
  select * into s from public.staged_features where id = p_staged_id for update;
  if not found then
    raise exception 'Staged feature not found' using errcode = 'P0002';
  end if;
  if s.review_status not in ('pending', 'needs_info') and not s.changed_since_review then
    raise exception 'Already reviewed (%)', s.review_status using errcode = '22023';
  end if;
  v_table := case s.kind when 'terminal' then 'terminals' when 'stop' then 'stops' else 'routes' end;
  -- (EXECUTE does not set FOUND, so ask for a boolean explicitly.)
  execute format('select exists (select 1 from public.%I where id = $1)', v_table) into v_exists using p_target_id;
  if not v_exists then
    raise exception 'No % record with that id', v_table using errcode = 'P0002';
  end if;

  v_source := private.source_for_staged(s);
  v_note := format('Matched import %s (%s). Not verified by itself.', s.external_id, s.provider_code);
  if v_table = 'terminals' then
    insert into public.evidence (source_id, claim, terminal_id, note) values (v_source, 'location', p_target_id, v_note);
  elsif v_table = 'stops' then
    insert into public.evidence (source_id, claim, stop_id, note) values (v_source, 'location', p_target_id, v_note);
  else
    insert into public.evidence (source_id, claim, route_id, note) values (v_source, 'existence', p_target_id, v_note);
  end if;

  update public.staged_features
  set review_status = 'linked', matched_table = v_table, matched_id = p_target_id,
      reviewed_by = (select auth.uid()), reviewed_at = now(), review_notes = p_notes, changed_since_review = false
  where id = s.id;
end;
$$;

create or replace function public.reject_staged_feature(p_staged_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_moderator();
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for rejecting' using errcode = '22023';
  end if;
  update public.staged_features
  set review_status = 'rejected', review_notes = left(p_reason, 2000),
      reviewed_by = (select auth.uid()), reviewed_at = now(), changed_since_review = false
  where id = p_staged_id and review_status in ('pending', 'needs_info', 'rejected');
  if not found then
    raise exception 'Staged feature not found or already promoted/linked' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.mark_staged_needs_info(p_staged_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_moderator();
  update public.staged_features
  set review_status = 'needs_info', review_notes = left(p_note, 2000),
      reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = p_staged_id and review_status in ('pending', 'needs_info');
  if not found then
    raise exception 'Staged feature not found or already decided' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Admin review queue (moderators see it through RLS on staged_features)
-- ---------------------------------------------------------------------
create view public.admin_review_queue with (security_invoker = true) as
select
  s.id, s.kind, s.classification, s.name, s.alt_names, s.ref, s.from_label, s.to_label,
  s.mode_hints, s.mode_confidence, s.quality, s.issues, jsonb_array_length(s.issues) as issue_count,
  s.review_status, s.changed_since_review,
  coalesce((s.attributes ->> 'missing_in_latest_run')::boolean, false) as missing_upstream,
  s.provider_code, p.name as provider_name, p.attribution_text, s.external_id, s.external_url,
  s.area_code, s.municipality, s.province,
  extensions.st_x(s.location::extensions.geometry) as lon,
  extensions.st_y(s.location::extensions.geometry) as lat,
  s.path is not null as has_path, s.path_complete,
  (select count(*) from public.staged_route_members m where m.route_id = s.id) as member_count,
  s.batch_duplicate_of, s.matched_table, s.matched_id, s.match_distance_m, s.match_name_similarity,
  coalesce(t.name, st.name) as matched_name,
  s.raw_tags, s.upstream_timestamp, s.last_seen_at, s.review_notes
from public.staged_features s
join public.data_providers p on p.code = s.provider_code
left join public.terminals t on s.matched_table = 'terminals' and t.id = s.matched_id
left join public.stops st on s.matched_table = 'stops' and st.id = s.matched_id
where s.review_status in ('pending', 'needs_info') or s.changed_since_review;

-- ---------------------------------------------------------------------
-- 8. Privileges and RLS
-- ---------------------------------------------------------------------
alter table public.data_providers enable row level security;
alter table public.import_areas enable row level security;
alter table public.import_runs enable row level security;
alter table public.staged_features enable row level security;
alter table public.staged_route_members enable row level security;

revoke all on public.data_providers, public.import_areas, public.import_runs,
  public.staged_features, public.staged_route_members, public.admin_review_queue from anon, authenticated;

-- The registry is public on purpose (transparency about sources).
grant select on public.data_providers, public.import_areas to anon, authenticated;
grant insert, update on public.data_providers to authenticated;          -- admins only (policy)
grant select on public.import_runs, public.staged_features, public.staged_route_members,
  public.admin_review_queue to authenticated;                               -- moderators only (policy)

create policy "anyone reads the source registry" on public.data_providers for select to anon, authenticated using (true);
create policy "admins add providers" on public.data_providers for insert to authenticated with check (private.has_role('admin'));
create policy "admins edit providers" on public.data_providers for update to authenticated
  using (private.has_role('admin')) with check (private.has_role('admin'));
create policy "anyone reads import areas" on public.import_areas for select to anon, authenticated using (true);
create policy "moderators read runs" on public.import_runs for select to authenticated using (private.is_moderator());
create policy "moderators read staged" on public.staged_features for select to authenticated using (private.is_moderator());
create policy "moderators read staged members" on public.staged_route_members for select to authenticated using (private.is_moderator());

revoke execute on function
  public.upsert_import_area(text, text, text, text, text, smallint, text, smallint, bigint),
  public.start_import_run(text, text, text, jsonb),
  public.finish_import_run(uuid, public.import_run_status, jsonb, text, timestamptz, text),
  public.upsert_staged_features(uuid, jsonb),
  public.match_staged_run(uuid),
  public.promote_staged_feature(uuid, text, text, text),
  public.promote_staged_route(uuid, text, public.route_direction, text),
  public.link_staged_feature(uuid, uuid, text),
  public.reject_staged_feature(uuid, text),
  public.mark_staged_needs_info(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.upsert_import_area(text, text, text, text, text, smallint, text, smallint, bigint),
  public.start_import_run(text, text, text, jsonb),
  public.finish_import_run(uuid, public.import_run_status, jsonb, text, timestamptz, text),
  public.upsert_staged_features(uuid, jsonb),
  public.match_staged_run(uuid),
  public.promote_staged_feature(uuid, text, text, text),
  public.promote_staged_route(uuid, text, public.route_direction, text),
  public.link_staged_feature(uuid, uuid, text),
  public.reject_staged_feature(uuid, text),
  public.mark_staged_needs_info(uuid, text)
to authenticated;

revoke all on function private.require_moderator(), private.source_for_staged(public.staged_features) from public;
grant execute on function private.require_moderator() to authenticated;
