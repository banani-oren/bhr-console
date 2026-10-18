-- Repair 32 Part A — the Israeli working-day calendar (single source, D1).
-- A workday = Sunday–Thursday AND not in il_non_working_days. Eve days and Chol HaMoed are workdays.
-- Supersedes the "holidays are NOT handled" limitation of Repair 19 (20261006_business_days_and_event_index.sql).
-- Matched pair with src/lib/ilCalendar.ts (IL_NON_WORKING_DAYS) — scripts/test-il-calendar.mjs fails on any drift.
-- Dry run (2026-10-19): 0 open, non-manual billing events belong to a 'business'-shape (מיידי) client,
-- so no due_date changes; paid/cancelled/manual events are frozen by the existing trigger anyway.
-- Apply with a UTF-8-safe runner (node fetch), never a bash variable (see 20261020_repair32_hebrew_literals_fix.sql).

create table if not exists public.il_non_working_days (
  day  date primary key,
  name text not null,
  kind text not null default 'holiday'
);
alter table public.il_non_working_days enable row level security;
drop policy if exists il_non_working_days_read on public.il_non_working_days;
create policy il_non_working_days_read on public.il_non_working_days for select to authenticated using (true);
-- no insert/update/delete policy: writes only through migrations

insert into public.il_non_working_days (day, name) values
  ('2026-04-02', 'פסח — יום ראשון'),
  ('2026-04-08', 'שביעי של פסח'),
  ('2026-04-22', 'יום העצמאות'),
  ('2026-05-22', 'שבועות'),
  ('2026-09-12', 'ראש השנה — יום א׳'),
  ('2026-09-13', 'ראש השנה — יום ב׳'),
  ('2026-09-21', 'יום כיפור'),
  ('2026-09-26', 'סוכות — יום ראשון'),
  ('2026-10-03', 'שמיני עצרת ושמחת תורה'),
  ('2027-04-22', 'פסח — יום ראשון'),
  ('2027-04-28', 'שביעי של פסח'),
  ('2027-05-12', 'יום העצמאות'),
  ('2027-06-11', 'שבועות'),
  ('2027-10-02', 'ראש השנה — יום א׳'),
  ('2027-10-03', 'ראש השנה — יום ב׳'),
  ('2027-10-11', 'יום כיפור'),
  ('2027-10-16', 'סוכות — יום ראשון'),
  ('2027-10-23', 'שמיני עצרת ושמחת תורה')
on conflict (day) do update set name = excluded.name, kind = 'holiday';

create or replace function public.bhr_is_workday(d date)
returns boolean
language sql stable security definer set search_path = public as $$
  select d is not null
     and extract(dow from d) not in (5, 6)
     and not exists (select 1 from public.il_non_working_days h where h.day = d);
$$;
revoke all on function public.bhr_is_workday(date) from public, anon, authenticated, service_role;
grant execute on function public.bhr_is_workday(date) to authenticated, service_role;

create or replace function public.bhr_add_business_days(d date, n integer)
returns date
language plpgsql stable security definer set search_path = public as $$
declare
  result date := d;
  remaining integer := n;
begin
  if d is null then return null; end if;
  while remaining > 0 loop
    result := result + 1;
    if public.bhr_is_workday(result) then remaining := remaining - 1; end if;
  end loop;
  return result;
end;
$$;
revoke all on function public.bhr_add_business_days(date, integer) from public, anon, authenticated, service_role;
grant execute on function public.bhr_add_business_days(date, integer) to authenticated, service_role;
comment on function public.bhr_add_business_days(date, integer) is
  'N workdays (Sun-Thu, excluding il_non_working_days) after d. Matched pair with src/lib/ilCalendar.ts addBusinessDays(). Repair 32.';

-- bhr_calc_due_date calls a table-reading function, so it can no longer be IMMUTABLE.
alter function public.bhr_calc_due_date(date, text) stable;
