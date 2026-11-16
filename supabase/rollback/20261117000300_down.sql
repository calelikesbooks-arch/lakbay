-- Rollback of migration 3 (community submissions, saved items, RPCs).
-- Simple reports are copied back into the original community_reports
-- table (migration 0001 shape) so the app keeps working.
-- WARNING: saved_destinations, saved_trips and non-report submissions
-- (mapper proposals) are DELETED. Export them first if you need them.

create table if not exists public.community_reports (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  category      text not null
                check (category in ('route_changed', 'fare_changed', 'terminal_moved', 'new_route', 'other')),
  location_text text not null check (char_length(location_text) between 3 and 120),
  details       text not null check (char_length(details) between 10 and 1000),
  observed_on   date not null,
  status        text not null default 'pending'
                check (status in ('pending', 'accepted', 'rejected'))
);

insert into public.community_reports (id, created_at, category, location_text, details, observed_on, status)
select id, created_at, category, location_text, details, observed_on,
       case status when 'accepted' then 'accepted' when 'rejected' then 'rejected' else 'pending' end
from public.community_submissions
where submission_type = 'report'
  and category in ('route_changed', 'fare_changed', 'terminal_moved', 'new_route', 'other')
on conflict (id) do nothing;

alter table public.community_reports enable row level security;
grant insert on table public.community_reports to anon, authenticated;
drop policy if exists "Anyone can submit a pending report" on public.community_reports;
create policy "Anyone can submit a pending report" on public.community_reports
  for insert to anon, authenticated with check (status = 'pending');

drop function if exists public.set_user_role(uuid, public.app_role, boolean);
drop function if exists public.set_mapper_status(uuid, public.mapper_status);
drop function if exists public.apply_as_mapper(text, text);
drop function if exists public.review_submission(uuid, public.submission_status, text, uuid);
drop function if exists public.submit_mapper_proposal(public.submission_type, text, text, date, jsonb,
  double precision, double precision, text, uuid);
drop function if exists public.submit_community_report(text, text, text, date, double precision, double precision);

drop trigger if exists user_roles_audit on public.user_roles;
drop table if exists public.saved_trips;
drop table if exists public.saved_destinations;
drop table if exists public.community_submissions;
drop function if exists private.limit_saved_rows();
