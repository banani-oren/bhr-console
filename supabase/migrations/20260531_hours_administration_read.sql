-- Repair 7 — Unified hours view.
--
-- The redesigned /hours page lets admin AND administration see every
-- employee's hours (with an employee filter). The existing hours_log policy
-- (hours_self_access) only grants read-all to admin:
--
--   using ( profile_id = auth.uid() or public.current_user_role() = 'admin' )
--
-- This additive, SELECT-only policy lets administration read every hours_log
-- row, mirroring the attendance feature's "admin + administration read all"
-- pattern. Insert/update/delete are unchanged (still self + admin only), so
-- administration gains visibility without write access to other users' hours.
--
-- Role checks go through the SECURITY DEFINER helper public.current_user_role()
-- to avoid the profiles-RLS recursion (see 20260418_1_rls_no_recursion.sql).

begin;

drop policy if exists hours_administration_select on hours_log;
create policy hours_administration_select on hours_log
  for select to authenticated
  using ( public.current_user_role() = 'administration' );

commit;
