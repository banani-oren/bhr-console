-- Fix: RLS on profiles was recursive because policies subqueried profiles.
-- Introduce SECURITY DEFINER helpers that bypass RLS, and rewrite policies
-- to call them.

begin;

create or replace function public.current_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $func$
  select role from public.profiles where id = auth.uid()
$func$;

create or replace function public.current_user_full_name()
returns text
language sql
security definer
stable
set search_path = public
as $func$
  select full_name from public.profiles where id = auth.uid()
$func$;

-- profiles
drop policy if exists profiles_self_read on profiles;
drop policy if exists profiles_self_update on profiles;
drop policy if exists profiles_admin_insert on profiles;
drop policy if exists profiles_admin_delete on profiles;

create policy profiles_self_read on profiles
  for select to authenticated
  using ( id = auth.uid() or public.current_user_role() = 'admin' );

create policy profiles_self_update on profiles
  for update to authenticated
  using ( id = auth.uid() or public.current_user_role() = 'admin' );

create policy profiles_admin_insert on profiles
  for insert to authenticated
  with check ( public.current_user_role() = 'admin' );

create policy profiles_admin_delete on profiles
  for delete to authenticated
  using ( public.current_user_role() = 'admin' );

-- clients
drop policy if exists clients_admin_admin_full on clients;
create policy clients_admin_admin_full on clients
  for all to authenticated
  using ( public.current_user_role() in ('admin','administration') )
  with check ( public.current_user_role() in ('admin','administration') );

-- transactions
drop policy if exists transactions_full_access on transactions;
create policy transactions_full_access on transactions
  for all to authenticated
  using (
    public.current_user_role() in ('admin','administration')
    or service_lead = public.current_user_full_name()
  )
  with check (
    public.current_user_role() in ('admin','administration')
    or service_lead = public.current_user_full_name()
  );

-- hours_log
drop policy if exists hours_self_access on hours_log;
create policy hours_self_access on hours_log
  for all to authenticated
  using ( profile_id = auth.uid() or public.current_user_role() = 'admin' )
  with check ( profile_id = auth.uid() or public.current_user_role() = 'admin' );

-- agreements
drop policy if exists agreements_admin_admin_full on agreements;
create policy agreements_admin_admin_full on agreements
  for all to authenticated
  using ( public.current_user_role() in ('admin','administration') )
  with check ( public.current_user_role() in ('admin','administration') );

commit;
