-- Repair 32 follow-up (Oren, 2026-10-19): Knesset election day 2026-10-27 (Tue) is a company non-working day.
-- Dry run: 0 open, non-manual billing events belong to a 'business'-shape client, so no due_date changes.
insert into public.il_non_working_days (day, name) values ('2026-10-27', 'יום הבחירות לכנסת')
on conflict (day) do update set name = excluded.name, kind = 'holiday';
