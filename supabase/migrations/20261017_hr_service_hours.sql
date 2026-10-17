-- Repair 25 — seed the hours-billing service type.
-- Oren (2026-10-17): hourly billing happens ONLY for שירות משאבי אנוש. time_period
-- deals don't use dynamic fields, so the row carries none. No old 'שעות עבודה'
-- service_types row exists (verified 2026-10-17); nothing is renamed or deleted.
insert into public.service_types (name, display_order, fields)
select 'שירות משאבי אנוש',
       coalesce((select max(display_order) from public.service_types), 0) + 1,
       '[]'::jsonb
where not exists (select 1 from public.service_types where name = 'שירות משאבי אנוש');
