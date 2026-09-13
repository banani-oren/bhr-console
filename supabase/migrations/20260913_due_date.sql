-- Feature: Expected Payment Date (due_date) — persist, backfill, trigger-maintained.
--
-- Problem: billing_events.payment_date was overloaded — it meant both "expected
-- payment date" (written only as a side effect from the UI's on-the-fly
-- calculatedTaxDate) and "date money was actually received". This migration adds
-- a dedicated due_date column, maintained by a DB trigger so every write path
-- (UI, manual insert, raw SQL, future features) produces a correct value.
-- payment_date now means ONLY the actual receipt date. Idempotent — safe to re-run.

-- =============================================================================
-- a) Columns
-- =============================================================================

ALTER TABLE billing_events
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS due_date_is_manual BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS billing_events_due_date_idx ON billing_events (due_date);

-- =============================================================================
-- b) bhr_parse_payment_term_days — behaviour-identical port of
--    parsePaymentTermDays() in src/lib/billingEvents.ts
-- =============================================================================

CREATE OR REPLACE FUNCTION bhr_parse_payment_term_days(terms text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
  m text[];
BEGIN
  IF terms IS NULL OR btrim(terms) = '' THEN
    RETURN 30;
  END IF;
  s := regexp_replace(terms, '\s+', '', 'g');
  IF s ~ '^\d+$' THEN
    RETURN s::integer;
  END IF;
  IF s = 'שוטף' THEN
    RETURN 0;
  END IF;
  m := regexp_match(s, 'שוטף\+(\d+)');
  IF m IS NOT NULL THEN
    RETURN m[1]::integer;
  END IF;
  RETURN 30;
END;
$$;

-- =============================================================================
-- c) bhr_calc_due_date — behaviour-identical port of
--    calculateTaxInvoiceDate() in src/lib/billingEvents.ts
--    (last day of billing_date's month, plus N days). Uses plain `date`
--    arithmetic throughout — never casts through timestamptz — so there is no
--    timezone drift to worry about (unlike the TS version's UTC workaround).
--
--    Worked example: billing_date = 2026-05-11, terms = 'שוטף+30'
--      -> last day of May 2026 = 2026-05-31 -> +30 days = 2026-06-30
-- =============================================================================

CREATE OR REPLACE FUNCTION bhr_calc_due_date(p_billing_date date, p_terms text)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_billing_date IS NULL THEN NULL
    ELSE ((date_trunc('month', p_billing_date) + interval '1 month' - interval '1 day')::date)
         + bhr_parse_payment_term_days(p_terms)
  END;
$$;

-- =============================================================================
-- d) bhr_billing_event_payment_terms — resolves the client's payment_terms for
--    a given transaction (billing_events.transaction_id), falling back to a
--    client_name match when client_id is NULL. NULL payment_terms is fine —
--    bhr_parse_payment_term_days defaults to 30.
-- =============================================================================

CREATE OR REPLACE FUNCTION bhr_billing_event_payment_terms(p_transaction_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT c.payment_terms
  FROM transactions t
  LEFT JOIN clients c
    ON c.id = t.client_id
    OR (t.client_id IS NULL AND c.name = t.client_name)
  WHERE t.id = p_transaction_id
  LIMIT 1;
$$;

-- =============================================================================
-- e) Trigger on billing_events — BEFORE INSERT OR UPDATE.
--    A manual override (due_date_is_manual = true) is left exactly as supplied;
--    otherwise due_date is (re)computed from billing_date + the client's terms.
-- =============================================================================

CREATE OR REPLACE FUNCTION bhr_billing_events_set_due_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.due_date_is_manual IS TRUE THEN
    RETURN NEW;
  END IF;
  NEW.due_date := bhr_calc_due_date(NEW.billing_date, bhr_billing_event_payment_terms(NEW.transaction_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_billing_events_due_date ON billing_events;
CREATE TRIGGER trg_billing_events_due_date
BEFORE INSERT OR UPDATE ON billing_events
FOR EACH ROW
EXECUTE FUNCTION bhr_billing_events_set_due_date();

-- =============================================================================
-- f) Trigger on clients — AFTER UPDATE OF payment_terms.
--    Recomputes due_date for that client's still-open billing events only.
--    Deliberately EXCLUDES 'paid' and 'cancelled' events: since bonus month
--    attribution is now keyed off due_date (D5), silently recomputing a
--    settled event's due_date would retroactively move an already-paid bonus.
-- =============================================================================

CREATE OR REPLACE FUNCTION bhr_clients_recompute_due_dates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.payment_terms IS DISTINCT FROM OLD.payment_terms THEN
    UPDATE billing_events be
    SET due_date = bhr_calc_due_date(be.billing_date, NEW.payment_terms)
    FROM transactions t
    WHERE be.transaction_id = t.id
      AND (t.client_id = NEW.id OR (t.client_id IS NULL AND t.client_name = NEW.name))
      AND be.due_date_is_manual = false
      AND be.status IN ('pending', 'to_bill', 'billed');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clients_recompute_due_dates ON clients;
CREATE TRIGGER trg_clients_recompute_due_dates
AFTER UPDATE OF payment_terms ON clients
FOR EACH ROW
EXECUTE FUNCTION bhr_clients_recompute_due_dates();

-- =============================================================================
-- g) Backfill (retroactive, D4)
-- =============================================================================

-- Seed manual overrides: a non-paid event that already carries a payment_date
-- got it from a human typing into the "תאריך פירעון" field in TransactionDialog
-- (the field that, pre-migration, wrote its value onto payment_date). Preserve
-- it as an explicit manual due_date so today's admin corrections aren't lost.
UPDATE billing_events be
SET due_date = be.payment_date,
    due_date_is_manual = true
WHERE be.payment_date IS NOT NULL
  AND be.status <> 'paid'
  AND be.due_date IS NULL;

-- Everything else: compute from billing_date + client terms. This also fires
-- the BEFORE UPDATE trigger above, which computes the same value — harmless.
UPDATE billing_events be
SET due_date = bhr_calc_due_date(be.billing_date, bhr_billing_event_payment_terms(be.transaction_id))
WHERE be.due_date IS NULL
  AND be.due_date_is_manual = false;
