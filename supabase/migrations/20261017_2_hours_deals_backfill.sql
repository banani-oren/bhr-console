-- Repair 25 Part C — retroactive hours-deals backfill. FILL-ONLY, idempotent,
-- touches public.transactions only (billing_events are never written).
--
-- Business rules (Oren, 2026-10-17):
--   * every hours deal is service "שירות משאבי אנוש" (kind = 'time_period')
--   * תאריך סגירה = last day of the month of period_end
--   * סכום חשבונית = hours_total × hourly_rate_used, else the sum of the deal's
--     non-cancelled billing events
--
-- Candidates: (a) every kind='time_period' deal; (b) deals whose service is
-- empty / 'שעות עבודה' AND that show an hours signal (period/hours/rate set, the
-- client is hourly, notes mention שעות, or hours_log links to it).
-- EXCLUDED: any candidate carrying a NON-ZERO salary / commission % or a candidate name
-- (recruitment signals — ambiguous), and any candidate that is a probable
-- DUPLICATE of an already-paid deal (same client, same covered month, same
-- amount) — duplicates are Oren's call, never silently legitimised here.

-- CTE-BEGIN
with hr as (
  select id as hr_id from public.service_types where name = 'שירות משאבי אנוש'
),
cand as (
  select t.id,
         c.hourly_rate as client_rate,
         (select min(h.visit_date) from public.hours_log h where h.billed_transaction_id = t.id) as hl_min,
         (select max(h.visit_date) from public.hours_log h where h.billed_transaction_id = t.id) as hl_max,
         (select count(*) from public.billing_events be where be.transaction_id = t.id and be.status <> 'cancelled') as ev_n,
         (select coalesce(sum(be.amount), 0) from public.billing_events be where be.transaction_id = t.id and be.status <> 'cancelled') as ev_sum,
         (coalesce(t.salary, 0) <> 0 or coalesce(t.commission_percent, 0) <> 0 or nullif(t.candidate_name, '') is not null) as recruit_signal,
         exists (
           select 1 from public.transactions o
           join public.billing_events pe on pe.transaction_id = o.id and pe.status = 'paid'
           where o.id <> t.id and o.client_id is not distinct from t.client_id
             and o.net_invoice_amount is not distinct from t.net_invoice_amount
             and date_trunc('month', coalesce(o.period_end, o.work_end_date, o.close_date))
               = date_trunc('month', coalesce(t.period_end, t.work_end_date, t.close_date))
             and t.net_invoice_amount is not null
             and not exists (select 1 from public.billing_events te where te.transaction_id = t.id and te.status = 'paid')
         ) as dup_of_paid
  from public.transactions t
  left join public.service_types st on st.id = t.service_type_id
  left join public.clients c on c.id = t.client_id
  where t.kind = 'time_period'
     or (
       coalesce(nullif(st.name, ''), nullif(t.service_type, ''), '') in ('', 'שעות עבודה')
       and (
         t.period_start is not null or t.hours_total is not null or t.hourly_rate_used is not null
         or coalesce(c.time_log_enabled, false) or c.hourly_rate is not null
         or t.notes like '%שעות%'
         or exists (select 1 from public.hours_log h where h.billed_transaction_id = t.id)
       )
     )
),
prop as (
  select t.id,
         hr.hr_id,
         coalesce(t.period_start, t.work_start_date, cd.hl_min) as period_start,
         coalesce(t.period_end,   t.work_end_date,   cd.hl_max) as period_end,
         coalesce(t.hourly_rate_used, cd.client_rate) as rate,
         t.hours_total as hours_in,
         t.net_invoice_amount as net_in,
         cd.ev_n, cd.ev_sum, t.close_date as close_in
  from cand cd
  join public.transactions t on t.id = cd.id
  cross join hr
  where not cd.recruit_signal and not cd.dup_of_paid
),
calc as (
  select p.*,
         coalesce(p.net_in,
                  case when p.hours_in is not null and p.rate is not null then round(p.hours_in * p.rate, 2)
                       when p.ev_n > 0 then p.ev_sum end) as net_new
  from prop p
),
final as (
  select c.*,
         coalesce(c.hours_in, case when c.net_new > 0 and c.rate > 0 then round(c.net_new / c.rate, 2) end) as hours_new,
         coalesce(c.close_in,
                  case when c.period_end is not null
                       then (date_trunc('month', c.period_end) + interval '1 month - 1 day')::date end) as close_new
  from calc c
)
-- CTE-END
update public.transactions t set
  service_type       = 'שירות משאבי אנוש',
  service_type_id    = f.hr_id,
  kind               = 'time_period',
  period_start       = f.period_start,
  period_end         = f.period_end,
  hourly_rate_used   = f.rate,
  net_invoice_amount = f.net_new,
  hours_total        = f.hours_new,
  close_date         = f.close_new
from final f
where f.id = t.id;

-- Every deal (any kind): closing month/year follow close_date where still NULL.
update public.transactions
set closing_month = extract(month from close_date)::int,
    closing_year  = extract(year  from close_date)::int
where close_date is not null and (closing_month is null or closing_year is null);
