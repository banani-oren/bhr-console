-- Refinements Batch 3 — schema changes.
-- Idempotent. Covers Phases A (purge), C (transactions.kind + billing columns),
-- D (canonical service seeds), E (billed_transaction_id, time_sheet_pdf_path),
-- and F (billing_reports table + RLS).

-- ============================================================================
-- Phase C — transaction kind + universal billing columns + time_period columns
-- ============================================================================

alter table transactions
  add column if not exists kind text not null default 'service';

-- Only add the check constraint once.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_kind_check'
  ) then
    alter table transactions
      add constraint transactions_kind_check
      check (kind in ('service','time_period'));
  end if;
end $$;

alter table transactions
  add column if not exists invoice_number_transaction text,
  add column if not exists invoice_number_receipt text,
  add column if not exists work_start_date date,
  add column if not exists warranty_end_date date,
  add column if not exists invoice_sent_date date,
  add column if not exists payment_due_date date,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists hours_total numeric,
  add column if not exists hourly_rate_used numeric,
  add column if not exists time_sheet_pdf_path text;

-- Backfill legacy invoice_number into the new dedicated column for service rows.
update transactions
   set invoice_number_transaction = invoice_number
 where invoice_number_transaction is null
   and invoice_number is not null;

-- ============================================================================
-- Phase A — purge non-service service_types
-- ============================================================================

-- Reassign any transactions pointing to a soon-to-be-deleted service_type.
update transactions
   set service_type_id = null,
       kind = 'time_period',
       period_start = coalesce(
         period_start,
         nullif(custom_fields->>'period_start','')::date,
         make_date(billing_year, billing_month, 1)
       ),
       period_end = coalesce(
         period_end,
         nullif(custom_fields->>'period_end','')::date,
         close_date
       ),
       hours_total = coalesce(
         hours_total,
         nullif(custom_fields->>'hours_total','')::numeric
       ),
       hourly_rate_used = coalesce(
         hourly_rate_used,
         nullif(custom_fields->>'hourly_rate','')::numeric,
         nullif(custom_fields->>'hourly_rate_used','')::numeric
       )
 where service_type_id in (
   select id from service_types where name in ('דיווח שעות','מש"א במיקור חוץ')
 );

delete from service_types where name in ('דיווח שעות','מש"א במיקור חוץ');

-- ============================================================================
-- Phase D — canonical service_types seeds.
-- Update existing rows to the new field set; insert missing ones.
-- ============================================================================

-- Upsert השמה (placement)
insert into service_types (name, display_order, fields)
values (
  'השמה',
  1,
  '[
    {"key":"position_number","label":"מספר משרה","type":"text","required":false,"width":"half"},
    {"key":"position_name","label":"שם משרה","type":"text","required":true,"width":"half"},
    {"key":"candidate_name","label":"מועמד","type":"text","required":true,"width":"half"},
    {"key":"salary","label":"שכר למשרה","type":"currency","required":true,"width":"half"},
    {"key":"commission_percent","label":"אחוז עמלה","type":"percent","required":true,"width":"half"},
    {"key":"commission_amount","label":"סכום עמלה","type":"currency","required":true,"width":"half","derived":"salary * commission_percent / 100"},
    {"key":"supplier_commission","label":"עמלה לספק","type":"currency","required":false,"width":"half"},
    {"key":"supplier_name","label":"שם ספק משנה","type":"text","required":false,"width":"half"},
    {"key":"work_start_date","label":"תאריך תחילת עבודה","type":"date","required":false,"width":"half"},
    {"key":"warranty_end_date","label":"תאריך תום אחריות","type":"date","required":false,"width":"half","derived":"work_start_date + client.warranty_days"}
  ]'::jsonb
)
on conflict (name) do update
  set display_order = excluded.display_order,
      fields = excluded.fields,
      updated_at = now();

-- Upsert הד האנטינג (head-hunting)
insert into service_types (name, display_order, fields)
values (
  'הד האנטינג',
  2,
  '[
    {"key":"position_name","label":"שם משרה","type":"text","required":true,"width":"half"},
    {"key":"candidate_name","label":"מועמד","type":"text","required":true,"width":"half"},
    {"key":"retainer_amount","label":"מקדמה","type":"currency","required":false,"width":"half"},
    {"key":"success_fee","label":"דמי הצלחה","type":"currency","required":true,"width":"half"},
    {"key":"work_start_date","label":"תאריך תחילת עבודה","type":"date","required":false,"width":"half"},
    {"key":"warranty_end_date","label":"תאריך תום אחריות","type":"date","required":false,"width":"half","derived":"work_start_date + client.warranty_days"}
  ]'::jsonb
)
on conflict (name) do update
  set display_order = excluded.display_order,
      fields = excluded.fields,
      updated_at = now();

-- Upsert הדרכה (training)
insert into service_types (name, display_order, fields)
values (
  'הדרכה',
  3,
  '[
    {"key":"workshop_name","label":"שם ההדרכה","type":"text","required":true,"width":"full"},
    {"key":"training_date","label":"תאריך ביצוע","type":"date","required":true,"width":"half"},
    {"key":"duration_hours","label":"משך (שעות)","type":"number","required":true,"width":"half"},
    {"key":"trainer","label":"מדריך/ה","type":"text","required":false,"width":"half"},
    {"key":"participants","label":"מספר משתתפים","type":"number","required":false,"width":"half"},
    {"key":"price","label":"מחיר","type":"currency","required":true,"width":"half"}
  ]'::jsonb
)
on conflict (name) do update
  set display_order = excluded.display_order,
      fields = excluded.fields,
      updated_at = now();

-- Upsert גיוס מסה (mass recruiting)
insert into service_types (name, display_order, fields)
values (
  'גיוס מסה',
  4,
  '[
    {"key":"campaign_name","label":"שם הקמפיין","type":"text","required":true,"width":"full"},
    {"key":"candidate_count","label":"כמות מועמדים","type":"number","required":true,"width":"half"},
    {"key":"fee_per_candidate","label":"מחיר למועמד","type":"currency","required":true,"width":"half"},
    {"key":"total_fee","label":"סכום כולל","type":"currency","required":true,"width":"half","derived":"candidate_count * fee_per_candidate"}
  ]'::jsonb
)
on conflict (name) do update
  set display_order = excluded.display_order,
      fields = excluded.fields,
      updated_at = now();

-- ============================================================================
-- Phase E — hours_log.billed_transaction_id
-- ============================================================================

alter table hours_log
  add column if not exists billed_transaction_id uuid references transactions(id);

-- ============================================================================
-- Phase F — billing_reports
-- ============================================================================

create table if not exists billing_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  period_start date not null,
  period_end date not null,
  issued_at timestamptz not null default now(),
  issued_by uuid references profiles(id),
  transaction_ids uuid[] not null default '{}',
  total_amount numeric not null default 0,
  pdf_storage_path text,
  notes text
);

alter table billing_reports enable row level security;

drop policy if exists "billing_reports_admin_admin_full" on billing_reports;
create policy "billing_reports_admin_admin_full" on billing_reports
  for all to authenticated
  using (public.current_user_role() in ('admin','administration'))
  with check (public.current_user_role() in ('admin','administration'));
