-- Repair 17: Collection model — separate the system's PLANNED billing date
-- from the REAL חשבון עסקה invoice date, derive תאריך פירעון from whichever
-- of the two actually exists, and clean up the payment_date overloading
-- the due_date migration (20260913_due_date.sql) backfilled from but never
-- cleared. See prompts/repair17-collection-model.md for the full diagnosis.
--
-- Column vocabulary after this migration (record here so the next reader
-- isn't misled by the column name — see also App Dev/CLAUDE.md):
--   billing_date       = תאריך חיוב מתוכנן  (system-generated plan — unchanged meaning)
--   invoice_date  (NEW) = תאריך חיוב          (the real חשבון עסקה date, user-entered)
--   due_date            = תאריך פירעון        (derived from COALESCE(invoice_date, billing_date) + terms)
--   payment_date        = תאריך תשלום בפועל   (the real חשבונית מס קבלה date, user-entered)

begin;

-- ============================================================================
-- a) New column — do NOT repurpose billing_date, every generator already
--    writes it as the planned date.
-- ============================================================================

alter table billing_events
  add column if not exists invoice_date date;

create index if not exists billing_events_invoice_date_idx on billing_events (invoice_date);

-- ============================================================================
-- b) due_date now derives from COALESCE(invoice_date, billing_date). Both
--    trigger functions are CREATE OR REPLACE'd with everything else kept
--    identical — in particular the due_date_is_manual short-circuit and the
--    20260913_2 freeze (no recompute once a row is paid/cancelled), which
--    protects bonus-forecast reproducibility (the forecast buckets open
--    events by due_date).
-- ============================================================================

create or replace function bhr_billing_events_set_due_date()
returns trigger
language plpgsql
as $$
begin
  if new.due_date_is_manual is true then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status in ('paid', 'cancelled') and new.status = old.status then
    return new;
  end if;
  new.due_date := bhr_calc_due_date(
    coalesce(new.invoice_date, new.billing_date),
    bhr_billing_event_payment_terms(new.transaction_id)
  );
  return new;
end;
$$;

create or replace function bhr_clients_recompute_due_dates()
returns trigger
language plpgsql
as $$
begin
  if new.payment_terms is distinct from old.payment_terms then
    update billing_events be
    set due_date = bhr_calc_due_date(coalesce(be.invoice_date, be.billing_date), new.payment_terms)
    from transactions t
    where be.transaction_id = t.id
      and (t.client_id = new.id or (t.client_id is null and t.client_name = new.name))
      and be.due_date_is_manual = false
      and be.status in ('pending', 'to_bill', 'billed');
  end if;
  return new;
end;
$$;

-- ============================================================================
-- c) Backfill (D3, Oren's words): rows that carry a חשבון עסקה number had
--    their invoice sent on billing_date — that IS the real invoice date.
--    Rows with no invoice number keep a planned date only.
-- ============================================================================

update billing_events
set invoice_date = billing_date
where invoice_number is not null
  and trim(invoice_number) <> ''
  and invoice_date is null
  and billing_date is not null;

-- Force a due_date recompute for every non-manual, non-settled row so the
-- new COALESCE takes effect immediately rather than waiting for the next
-- unrelated update to fire the trigger.
update billing_events
set billing_date = billing_date
where status not in ('paid', 'cancelled')
  and due_date_is_manual = false;

-- ============================================================================
-- d) Clear the contradictory payment dates (issue 6) — a payment_date on a
--    row that was never actually paid is a leftover from the pre-due_date
--    overloading; the due_date migration backfilled due_date from these but
--    never cleared the source.
-- ============================================================================

update billing_events
set payment_date = null
where status <> 'paid'
  and payment_date is not null;

-- ============================================================================
-- e) Drop the dead transactions columns (issue 9) — zero references in src/
--    confirmed by grep 2026-10-03 (the only other hits are the historical
--    20260422 migration that created them, never touched).
-- ============================================================================

alter table transactions
  drop column if exists invoice_sent_date,
  drop column if exists payment_due_date,
  drop column if exists invoice_number_transaction,
  drop column if exists invoice_number_receipt;

commit;
