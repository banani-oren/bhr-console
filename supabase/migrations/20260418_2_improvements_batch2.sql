-- Improvements Batch 2 migrations

-- Phase A — reconciliation of noa@banani-hr.com (applied via service role;
-- recorded here for auditability).
-- The auth user existed (930b6a93-...) but the profiles row was missing.
-- Likely: prior delete of the profile row without deleting the auth user.
-- Fix was an insert against public.profiles with role='recruiter' +
-- password_set=false + the tiered bonus model. Repeatable as:
--   insert into public.profiles (id, full_name, email, role, password_set)
--   values ('930b6a93-c0a8-4038-986d-36e643dd171c','נועה פולק','noa@banani-hr.com','recruiter',false)
--   on conflict (id) do nothing;

-- Phase B — hourly rate on clients.
alter table clients add column if not exists hourly_rate numeric;

-- Phase C — service types (configurable per-service field schemas).
create table if not exists service_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_order integer not null default 0,
  fields jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table service_types enable row level security;

drop policy if exists "service_types_auth_read" on service_types;
create policy "service_types_auth_read" on service_types for select to authenticated
  using (true);

drop policy if exists "service_types_admin_write" on service_types;
create policy "service_types_admin_write" on service_types for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- Seed השמה with the existing Transaction dialog's custom fields.
insert into service_types (name, display_order, fields)
values (
  'השמה',
  1,
  '[
    {"key":"position_name","label":"משרה","type":"text","required":true,"width":"half"},
    {"key":"candidate_name","label":"מועמד","type":"text","required":true,"width":"half"},
    {"key":"commission_percent","label":"עמלה %","type":"percent","required":true,"width":"half"},
    {"key":"salary","label":"שכר","type":"currency","required":true,"width":"half"},
    {"key":"net_invoice_amount","label":"סכום נטו","type":"currency","required":true,"width":"half"},
    {"key":"commission_amount","label":"עמלת ספק","type":"currency","required":false,"width":"half"},
    {"key":"service_lead","label":"ליד שירות","type":"employee","required":true,"width":"full"}
  ]'::jsonb
)
on conflict (name) do nothing;

-- Phase D — transactions: service_type_id + custom_fields.
alter table transactions add column if not exists service_type_id uuid references service_types(id);
alter table transactions add column if not exists custom_fields jsonb not null default '{}'::jsonb;

update transactions set service_type_id = (select id from service_types where name = 'השמה')
  where service_type_id is null;

-- Phase E — hourly time-log.
alter table clients add column if not exists time_log_enabled boolean not null default false;

create table if not exists client_time_log_permissions (
  client_id uuid not null references clients(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, profile_id)
);

alter table client_time_log_permissions enable row level security;

drop policy if exists "ctlp_admin_write" on client_time_log_permissions;
create policy "ctlp_admin_write" on client_time_log_permissions for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists "ctlp_self_read" on client_time_log_permissions;
create policy "ctlp_self_read" on client_time_log_permissions for select to authenticated
  using (profile_id = auth.uid() or public.current_user_role() in ('admin','administration'));

alter table hours_log add column if not exists client_id uuid references clients(id);
alter table hours_log add column if not exists start_time time;
alter table hours_log add column if not exists end_time time;

update hours_log hl set client_id = c.id
  from clients c
  where hl.client_id is null and lower(btrim(hl.client_name)) = lower(btrim(c.name));

-- Seed 'דיווח שעות' service type for the time-log → transaction path.
insert into service_types (name, display_order, fields)
values (
  'דיווח שעות',
  5,
  '[
    {"key":"period_start","label":"תחילת תקופה","type":"date","required":true,"width":"half"},
    {"key":"period_end","label":"סוף תקופה","type":"date","required":true,"width":"half"},
    {"key":"hours_total","label":"סה\"כ שעות","type":"number","required":true,"width":"half"},
    {"key":"hourly_rate","label":"תעריף שעה","type":"currency","required":true,"width":"half"}
  ]'::jsonb
)
on conflict (name) do nothing;

-- Phase F — PDF agreement file path.
alter table clients add column if not exists agreement_storage_path text;
