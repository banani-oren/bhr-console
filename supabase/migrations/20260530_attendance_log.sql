-- Employee attendance log: each row = one check-in OR check-out action.
-- Multiple in/out pairs per day are supported. work_date is derived from
-- logged_at in the Asia/Jerusalem timezone by a BEFORE trigger.
--
-- RLS follows the established no-recursion convention: role checks go through
-- the SECURITY DEFINER helper public.current_user_role() (see
-- 20260418_1_rls_no_recursion.sql) rather than subquerying profiles inline.

begin;

create table if not exists attendance_log (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  action      text not null check (action in ('check_in', 'check_out')),
  logged_at   timestamptz not null default now(),
  work_date   date not null,  -- date in Asia/Jerusalem timezone, set by trigger
  notes       text,
  created_at  timestamptz not null default now()
);

-- Auto-set work_date from logged_at in Israel timezone.
create or replace function public.set_attendance_work_date()
returns trigger language plpgsql as $$
begin
  new.work_date := (new.logged_at at time zone 'Asia/Jerusalem')::date;
  return new;
end;
$$;

drop trigger if exists attendance_work_date_trigger on attendance_log;
create trigger attendance_work_date_trigger
  before insert or update on attendance_log
  for each row execute function public.set_attendance_work_date();

-- Indexes
create index if not exists idx_attendance_profile_date on attendance_log(profile_id, work_date);
create index if not exists idx_attendance_work_date on attendance_log(work_date);

-- RLS
alter table attendance_log enable row level security;

-- Employees can insert their own records.
drop policy if exists attendance_insert_own on attendance_log;
create policy attendance_insert_own on attendance_log
  for insert to authenticated
  with check ( profile_id = auth.uid() );

-- Employees read their own records; admin and administration read all.
drop policy if exists attendance_select on attendance_log;
create policy attendance_select on attendance_log
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.current_user_role() in ('admin', 'administration')
  );

-- Only admin can update or delete (for corrections).
drop policy if exists attendance_admin_update on attendance_log;
create policy attendance_admin_update on attendance_log
  for update to authenticated
  using ( public.current_user_role() = 'admin' );

drop policy if exists attendance_admin_delete on attendance_log;
create policy attendance_admin_delete on attendance_log
  for delete to authenticated
  using ( public.current_user_role() = 'admin' );

-- The attendance report (admin + administration) needs every employee's name,
-- but profiles RLS only lets a user read their own row (or admin reads all).
-- This SECURITY DEFINER helper returns the id/name/role list, gated to
-- admin/administration callers, so the report works for administration too
-- without loosening profiles RLS.
create or replace function public.list_profiles_for_attendance()
returns table (id uuid, full_name text, role text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.full_name, p.role
  from public.profiles p
  where public.current_user_role() in ('admin', 'administration')
  order by p.full_name
$$;

grant execute on function public.list_profiles_for_attendance() to authenticated;

commit;
