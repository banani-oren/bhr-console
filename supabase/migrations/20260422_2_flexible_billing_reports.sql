-- Refinements Batch 4 Phase C — flexible billing_reports filters.
-- client_id + period_start/period_end continue to describe the actual scope
-- of the data included in each report. The new filter_* columns record
-- exactly what the admin ASKED for, so a report can be regenerated later.

alter table billing_reports
  add column if not exists filter_client_id uuid references clients(id),
  add column if not exists filter_period_start date,
  add column if not exists filter_period_end date,
  add column if not exists filter_payment_status text,
  add column if not exists filter_include_service boolean not null default true,
  add column if not exists filter_include_time_period boolean not null default true;

-- Relax the NOT NULL constraint on the legacy client_id / period columns so
-- multi-client / all-time reports can be recorded. Keep the columns for
-- back-compat with reports written in batch 3.
alter table billing_reports alter column client_id drop not null;
alter table billing_reports alter column period_start drop not null;
alter table billing_reports alter column period_end drop not null;
