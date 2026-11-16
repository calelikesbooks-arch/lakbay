-- Rollback of migration 1 (core setup).
-- WARNING: deletes profiles, roles, mapper profiles and the audit log.
-- Auth users themselves (Supabase Authentication) are NOT deleted.
drop trigger if exists on_auth_user_created on auth.users;

drop table if exists public.audit_log;
drop table if exists public.transport_modes;
drop table if exists public.mapper_profiles;
drop table if exists public.user_roles;
drop table if exists public.profiles;

drop function if exists private.write_audit();
drop function if exists private.touch_updated_at();
drop function if exists private.stamp_row();
drop function if exists private.is_contributor();
drop function if exists private.is_moderator();
drop function if exists private.has_role(public.app_role);
drop function if exists private.handle_new_user();
drop function if exists private.today_ph();
drop function if exists private.normalize_name(text);

drop type if exists public.mode_category;
drop type if exists public.operator_type;
drop type if exists public.terminal_kind;
drop type if exists public.stop_kind;
drop type if exists public.route_direction;
drop type if exists public.evidence_claim;
drop type if exists public.verification_method;
drop type if exists public.source_type;
drop type if exists public.mapper_status;
drop type if exists public.submission_type;
drop type if exists public.submission_status;
drop type if exists public.record_status;
drop type if exists public.app_role;

drop schema if exists private;

-- Extensions are left installed (harmless, and other features may use them).
-- To remove them too, uncomment:
-- drop extension if exists btree_gist;
-- drop extension if exists pg_trgm;
-- drop extension if exists postgis;
