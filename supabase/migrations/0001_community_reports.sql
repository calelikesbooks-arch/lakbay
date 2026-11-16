-- LAKBAY: community reports (moderation queue)
-- SUPERSEDED by 20261117000300_community_and_user_data.sql, which moves these
-- rows into public.community_submissions and drops this table.
-- Kept so migration history stays complete. Safe to run (or skip) on a new project.
-- Run this in Supabase: Dashboard -> SQL Editor -> paste -> Run.
--
-- Security model:
--   * Anyone (anon) may INSERT a report, but only with status 'pending'.
--   * Nobody using the public key can SELECT, UPDATE or DELETE reports.
--     Moderators review them in the Supabase dashboard.
--   * No personal data is collected (no names, emails or phone numbers).

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

alter table public.community_reports enable row level security;

-- Make the permission explicit (newer Supabase projects may not grant it by default).
grant insert on table public.community_reports to anon, authenticated;

drop policy if exists "Anyone can submit a pending report" on public.community_reports;
create policy "Anyone can submit a pending report"
  on public.community_reports
  for insert
  to anon, authenticated
  with check (status = 'pending');
