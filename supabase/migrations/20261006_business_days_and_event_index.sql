-- Repair 19 Part A + C: מיידי payment terms (5 business days, Sun-Thu) and
-- the event_index integrity constraint.
--
-- Part A — Oren, 2026-10-06: "לתשלום מיידי אומר שהתשלום יתקבל בתוך 5 ימי
-- עסקים." bhr_calc_due_date only ever knew one date shape (end-of-month + N
-- calendar days — the שוטף shape). That shape cannot express מיידי at any
-- value of N, so Repair 18's strict parser correctly treated מיידי as
-- unrecognised (shape NULL) rather than guessing — but the right fix is a
-- second shape, not a new vocabulary entry on the old shape. This migration
-- introduces 'eom' (unchanged שוטף/שוטף+N/bare-integer behaviour) and
-- 'business' (new: reference date + N business days, Sun-Thu — Israeli
-- public holidays are NOT handled, a known limitation, recorded in
-- App Dev\CLAUDE.md) as explicit, mutually exclusive shapes.
--
-- bhr_payment_term_spec(text) -> (shape, days) replaces
-- bhr_payment_term_days_strict as the authoritative parser;
-- bhr_payment_term_days_strict is kept as a derived, days-only convenience
-- wrapper (ad-hoc audits keep working unchanged: IS NULL still means
-- "unrecognised", regardless of shape) but bhr_calc_due_date now calls
-- bhr_payment_term_spec directly since it needs the shape.
--
-- Matched pair with src/lib/billingEvents.ts's parsePaymentTermSpec() /
-- calculateTaxInvoiceDate() / addBusinessDays() — change both together.
--
-- Part C — the 2026-10-04 full-database sweep found exactly one
-- (transaction_id, event_index) collision: d141e376-0a03-40b0-af69-5c56cc49ff0b
-- (אלדר השקעות), a legitimate 30/70 split whose second event was never
-- incremented to event_index=2. Both rows are paid; nothing about amount,
-- status, dates, invoice_number or receipt_number changes — only the index.
-- A unique constraint is added afterwards so this cannot recur.

begin;

-- ============================================================================
-- A1/A2/A3 — bhr_add_business_days + the two-shape term parser
-- ============================================================================

CREATE OR REPLACE FUNCTION bhr_add_business_days(d date, n integer)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result date := d;
  remaining integer := n;
BEGIN
  IF d IS NULL THEN RETURN NULL; END IF;
  WHILE remaining > 0 LOOP
    result := result + 1;
    -- extract(dow from date): 0=Sunday .. 6=Saturday. Israeli work week is
    -- Sunday-Thursday, so Friday(5)/Saturday(6) don't count.
    IF extract(dow from result) NOT IN (5, 6) THEN
      remaining := remaining - 1;
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

COMMENT ON FUNCTION bhr_add_business_days(date, integer) IS
  'N business days (Sun-Thu) after d. Israeli public holidays are NOT '
  'handled (a holiday inside the window still counts as a business day) — '
  'a known, dated limitation (Repair 19, 2026-10-06). Matched pair with '
  'src/lib/billingEvents.ts''s addBusinessDays().';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bhr_term_spec') THEN
    CREATE TYPE bhr_term_spec AS (shape text, days integer);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION bhr_payment_term_spec(terms text)
RETURNS bhr_term_spec
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
  m text[];
  result bhr_term_spec;
BEGIN
  IF terms IS NULL OR btrim(terms) = '' THEN
    RETURN NULL;
  END IF;
  s := regexp_replace(terms, '\s+', '', 'g');

  -- מיידי shape: reference date + 5 business days (Oren, 2026-10-06).
  IF s IN ('מיידי', 'מידי', 'לתשלוםמיידי', 'תשלוםמיידי') THEN
    result.shape := 'business';
    result.days := 5;
    RETURN result;
  END IF;

  -- שוטף shape: end of reference month + N calendar days.
  IF s = 'שוטף' THEN
    result.shape := 'eom';
    result.days := 0;
    RETURN result;
  END IF;
  m := regexp_match(s, '^שוטף\+?(\d+)(?:יום)?$');
  IF m IS NOT NULL THEN
    result.shape := 'eom';
    result.days := m[1]::integer;
    RETURN result;
  END IF;
  m := regexp_match(s, '^(\d+)(?:יום)?$');
  IF m IS NOT NULL THEN
    result.shape := 'eom';
    result.days := m[1]::integer;
    RETURN result;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION bhr_payment_term_spec(text) IS
  'Authoritative payment-terms parser (Repair 19, 2026-10-06) — returns '
  '(shape, days); NULL means "no usable terms", never guesses. shape = '
  '''eom'' (שוטף / שוטף+N / bare integer) or ''business'' (מיידי = 5 '
  'business days, Sun-Thu). Matched pair with '
  'src/lib/billingEvents.ts''s parsePaymentTermSpec(): change both together.';

-- Derived, days-only convenience wrapper — existing ad-hoc audits that call
-- this directly (IS NULL = unrecognised terms) keep working unchanged.
CREATE OR REPLACE FUNCTION bhr_payment_term_days_strict(terms text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (bhr_payment_term_spec(terms)).days;
$$;

COMMENT ON FUNCTION bhr_payment_term_days_strict(text) IS
  'Days-only view of bhr_payment_term_spec() — drops the shape, so do not '
  'use this for actual date math once a ''business''-shape term matters '
  '(it would be silently treated as calendar days). Still correct for '
  'IS NULL audits ("terms unrecognised") and historical compatibility. '
  'bhr_calc_due_date calls bhr_payment_term_spec directly.';

-- ============================================================================
-- A2 — bhr_calc_due_date branches on shape. Also Part B3.1 (Oren, 2026-10-06):
-- the reference date is now ONLY ever the real invoice date — the caller no
-- longer feeds a billing_date fallback (see the two trigger updates below).
-- A due date before a חשבון עסקה exists is not a real commitment; it's a
-- planning guess, and Repair 18 already established that BHR Console does
-- not guess.
-- ============================================================================

-- Parameter kept as p_billing_date (CREATE OR REPLACE cannot rename an
-- existing parameter without DROP FUNCTION first) — despite the name, every
-- caller now feeds it the real invoice_date only, never billing_date; see
-- the COMMENT below and the two trigger updates further down.
CREATE OR REPLACE FUNCTION bhr_calc_due_date(p_billing_date date, p_terms text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  spec bhr_term_spec;
BEGIN
  IF p_billing_date IS NULL THEN
    RETURN NULL;
  END IF;
  spec := bhr_payment_term_spec(p_terms);
  IF spec IS NULL THEN
    RETURN NULL;
  END IF;
  IF spec.shape = 'eom' THEN
    RETURN ((date_trunc('month', p_billing_date) + interval '1 month' - interval '1 day')::date)
           + spec.days;
  ELSIF spec.shape = 'business' THEN
    RETURN bhr_add_business_days(p_billing_date, spec.days);
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION bhr_calc_due_date(date, text) IS
  'Repair 19 (2026-10-06): branches on bhr_payment_term_spec''s shape '
  '(''eom'' vs ''business''). Despite the p_billing_date parameter name '
  '(kept to avoid a DROP FUNCTION), every caller now feeds it the real '
  'invoice_date ONLY (Part B3.1) — never a billing_date fallback; a '
  'not-yet-invoiced event has no expected payment date, period.';

-- ============================================================================
-- B3.1/B6 — the due_date triggers now use invoice_date ONLY, no billing_date
-- fallback. Before a חשבון עסקה exists, the money is טרם חויב and has no
-- expected payment date (it stays visible via billing_date in the
-- not-yet-invoiced worklists — that column still exists, just internal).
-- ============================================================================

CREATE OR REPLACE FUNCTION bhr_billing_events_set_due_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  if new.due_date_is_manual is true then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status in ('paid', 'cancelled') and new.status = old.status then
    return new;
  end if;
  new.due_date := bhr_calc_due_date(
    new.invoice_date,
    bhr_billing_event_payment_terms(new.transaction_id)
  );
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION bhr_clients_recompute_due_dates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  if new.payment_terms is distinct from old.payment_terms then
    update billing_events be
    set due_date = bhr_calc_due_date(be.invoice_date, new.payment_terms)
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
-- C2/C3 — event_index integrity (re-verified live immediately before this
-- migration was applied — see the accompanying verification script; abort
-- was the documented behaviour if the re-check had disagreed).
-- ============================================================================

-- Renumber the second row of the known 30/70 split — metadata only, nothing
-- else about the row changes. A unique constraint right after makes a repeat
-- impossible to insert.
UPDATE billing_events
SET event_index = 2
WHERE id = '6464babb-f9a9-4c0c-ad65-1130f3d63bd9'
  AND transaction_id = 'd141e376-0a03-40b0-af69-5c56cc49ff0b'
  AND event_index = 1;

ALTER TABLE billing_events
  ADD CONSTRAINT billing_events_transaction_event_index_unique
  UNIQUE (transaction_id, event_index);

commit;

-- ============================================================================
-- A4 — retroactive recompute pass (outside the main transaction — triggers
-- must see the new function bodies committed first). Scoped by the
-- surrounding verification script, which resolves both clients by exact
-- name, prints before-state, aborts on anything but exactly one row each,
-- sets קסטרו's payment_terms, snapshots paid/cancelled due_dates, forces a
-- recompute, and proves the freeze (0 paid/cancelled rows moved).
-- ============================================================================
