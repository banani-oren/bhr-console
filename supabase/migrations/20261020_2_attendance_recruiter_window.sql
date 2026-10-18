-- Repair 32 (D5) — a recruiter may add / correct / delete her OWN attendance rows only for dates in the
-- CURRENT calendar month (Asia/Jerusalem); earlier months are read-only for her. Enforced here (RLS), not
-- only in the UI. Admin and administration behaviour is unchanged (admin keeps attendance_admin_update/delete;
-- administration keeps own check-in/out). work_date is set by the BEFORE trigger, so WITH CHECK sees it.

create or replace function public.bhr_in_current_month_il(d date)
returns boolean
language sql stable set search_path = public as $$
  select d >= date_trunc('month', now() at time zone 'Asia/Jerusalem')::date
     and d <  (date_trunc('month', now() at time zone 'Asia/Jerusalem') + interval '1 month')::date;
$$;
revoke all on function public.bhr_in_current_month_il(date) from public, anon, authenticated, service_role;
grant execute on function public.bhr_in_current_month_il(date) to authenticated, service_role;

drop policy if exists attendance_insert_own on public.attendance_log;
create policy attendance_insert_own on public.attendance_log
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and (
      public.current_user_role() is distinct from 'recruiter'
      or (public.bhr_in_current_month_il(work_date) and logged_at <= now() + interval '5 minutes')
    )
  );

drop policy if exists attendance_recruiter_update on public.attendance_log;
create policy attendance_recruiter_update on public.attendance_log
  for update to authenticated
  using (profile_id = auth.uid() and public.current_user_role() = 'recruiter' and public.bhr_in_current_month_il(work_date))
  with check (profile_id = auth.uid() and public.current_user_role() = 'recruiter'
              and public.bhr_in_current_month_il(work_date) and logged_at <= now() + interval '5 minutes');

drop policy if exists attendance_recruiter_delete on public.attendance_log;
create policy attendance_recruiter_delete on public.attendance_log
  for delete to authenticated
  using (profile_id = auth.uid() and public.current_user_role() = 'recruiter' and public.bhr_in_current_month_il(work_date));
