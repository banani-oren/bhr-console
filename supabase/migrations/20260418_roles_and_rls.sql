-- Migration: three-role model + role-aware RLS + invite-link bypass fix
-- Date: 2026-04-18
-- Ref: SECURITY_FIX_AND_ROLES.md
--
-- Changes:
--   1. profiles.role: {admin, employee} -> {admin, recruiter, administration}
--      - existing employees with hours_category_enabled=true => administration
--      - other existing employees => recruiter
--   2. profiles.password_set boolean default false
--      - existing admin backfilled to true (will be done per-id in a service-role step)
--      - handle_new_user trigger default changed to 'recruiter' with password_set=false
--   3. RLS: admin sees all; administration sees clients + all transactions + own hours;
--      recruiter sees own transactions (service_lead=my full_name) + own hours only
--   4. Drop all anon policies — the employee portal is being removed.

begin;

-- ---------------------------------------------------------------------------
-- 1. profiles.role enum expansion
-- ---------------------------------------------------------------------------

alter table profiles drop constraint if exists profiles_role_check;

update profiles set role = 'administration'
  where role = 'employee' and coalesce(hours_category_enabled, false) = true;

update profiles set role = 'recruiter'
  where role = 'employee';

alter table profiles
  add constraint profiles_role_check
  check (role in ('admin', 'recruiter', 'administration'));

-- ---------------------------------------------------------------------------
-- 2. password_set flag (forced password-creation flow)
-- ---------------------------------------------------------------------------

alter table profiles
  add column if not exists password_set boolean not null default false;

-- Re-install handle_new_user with the new role default and password_set=false.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $func$
begin
  insert into public.profiles (id, full_name, email, role, password_set)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'recruiter'),
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$func$;

-- ---------------------------------------------------------------------------
-- 3. RLS policies — wipe legacy, install role-aware versions
-- ---------------------------------------------------------------------------

-- profiles
drop policy if exists "auth_full_profiles" on profiles;
drop policy if exists "anon_read_profiles" on profiles;
drop policy if exists "service_role_profiles" on profiles;
drop policy if exists "profiles_self_read" on profiles;
drop policy if exists "profiles_self_update" on profiles;
drop policy if exists "profiles_admin_insert" on profiles;
drop policy if exists "profiles_admin_delete" on profiles;

create policy "profiles_self_read" on profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (select role from profiles where id = auth.uid()) = 'admin'
  );

create policy "profiles_self_update" on profiles
  for update to authenticated
  using (
    id = auth.uid()
    or (select role from profiles where id = auth.uid()) = 'admin'
  );

create policy "profiles_admin_insert" on profiles
  for insert to authenticated
  with check (
    (select role from profiles where id = auth.uid()) = 'admin'
  );

create policy "profiles_admin_delete" on profiles
  for delete to authenticated
  using (
    (select role from profiles where id = auth.uid()) = 'admin'
  );

-- clients
drop policy if exists "Authenticated full access" on clients;
drop policy if exists "clients_admin_admin_full" on clients;

create policy "clients_admin_admin_full" on clients
  for all to authenticated
  using (
    (select role from profiles where id = auth.uid()) in ('admin','administration')
  )
  with check (
    (select role from profiles where id = auth.uid()) in ('admin','administration')
  );

-- transactions
drop policy if exists "Authenticated full access" on transactions;
drop policy if exists "transactions_full_access" on transactions;

create policy "transactions_full_access" on transactions
  for all to authenticated
  using (
    (select role from profiles where id = auth.uid()) in ('admin','administration')
    or service_lead = (select full_name from profiles where id = auth.uid())
  )
  with check (
    (select role from profiles where id = auth.uid()) in ('admin','administration')
    or service_lead = (select full_name from profiles where id = auth.uid())
  );

-- hours_log
drop policy if exists "auth_full_hours" on hours_log;
drop policy if exists "anon_read_hours" on hours_log;
drop policy if exists "anon_insert_hours" on hours_log;
drop policy if exists "hours_self_access" on hours_log;

create policy "hours_self_access" on hours_log
  for all to authenticated
  using (
    profile_id = auth.uid()
    or (select role from profiles where id = auth.uid()) = 'admin'
  )
  with check (
    profile_id = auth.uid()
    or (select role from profiles where id = auth.uid()) = 'admin'
  );

-- agreements (deprecated table, kept for reference) — tighten same as clients
drop policy if exists "Authenticated full access" on agreements;
drop policy if exists "agreements_admin_admin_full" on agreements;

create policy "agreements_admin_admin_full" on agreements
  for all to authenticated
  using (
    (select role from profiles where id = auth.uid()) in ('admin','administration')
  )
  with check (
    (select role from profiles where id = auth.uid()) in ('admin','administration')
  );

commit;
