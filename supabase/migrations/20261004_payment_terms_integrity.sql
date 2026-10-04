-- Repair 18: Payment terms integrity — stop inventing a תאריך פירעון.
--
-- Two independent bugs made due_date wrong whenever a client's payment_terms
-- couldn't be read, and both agreed on a confident-looking but invented
-- "שוטף+30" instead of admitting the gap:
--
--   Cause A (RLS leak): bhr_billing_event_payment_terms is STABLE but not
--   SECURITY DEFINER, so its LEFT JOIN clients runs with the caller's RLS —
--   an invisible client row silently resolves to payment_terms = NULL
--   instead of erroring. A direct pg connection (bypassing RLS) and the
--   deployed app (RLS-filtered) could compute two different due_dates for
--   the identical row.
--
--   Cause B (the one that actually matters): bhr_parse_payment_term_days(NULL)
--   returns 30 — so "no terms configured", "terms I can't see" (Cause A), and
--   "a terms string I can't parse" are all indistinguishable, and all three
--   produce an identical invented due_date nobody decided on.
--
-- Fix (Oren, 2026-10-03): a תאריך פירעון is only ever produced from
-- RECOGNISED payment terms. NULL, empty, and unparseable all mean no due
-- date — due_date stays NULL, and the UI says so explicitly instead of
-- guessing. See prompts/repair18-payment-terms-integrity.md for the full
-- diagnosis.

begin;

-- ============================================================================
-- a) Strict terms parser — a new function, not a changed contract. Returns
--    NULL for anything unrecognised; never guesses 30.
-- ============================================================================

CREATE OR REPLACE FUNCTION bhr_payment_term_days_strict(terms text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
  m text[];
BEGIN
  IF terms IS NULL OR btrim(terms) = '' THEN
    RETURN NULL;
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
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION bhr_payment_term_days_strict(text) IS
  'Strict payment-terms parser — NULL means "no usable terms", never guesses. '
  'Matched pair with src/lib/billingEvents.ts''s parsePaymentTermDays(): '
  'change both together or they will silently disagree.';

-- bhr_parse_payment_term_days is now a thin, deprecated wrapper so any
-- caller this phase missed keeps behaving exactly as it did before (30-day
-- default) rather than changing silently. New code must call
-- bhr_payment_term_days_strict directly and handle NULL explicitly.
CREATE OR REPLACE FUNCTION bhr_parse_payment_term_days(terms text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(bhr_payment_term_days_strict(terms), 30);
$$;

COMMENT ON FUNCTION bhr_parse_payment_term_days(text) IS
  'DEPRECATED (Repair 18, 2026-10-04) — silently defaults unusable terms to '
  '30 days, which is exactly the bug this phase removed from due_date. Kept '
  'only so pre-existing callers keep their old behaviour. New code must use '
  'bhr_payment_term_days_strict() and handle NULL ("no usable terms") '
  'explicitly — never re-introduce a `?? 30` / `COALESCE(..., 30)` fallback.';

-- ============================================================================
-- b) bhr_calc_due_date returns NULL when terms are not usable, instead of
--    silently assuming 30 days. Plain `date` arithmetic throughout, as before.
-- ============================================================================

CREATE OR REPLACE FUNCTION bhr_calc_due_date(p_billing_date date, p_terms text)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_billing_date IS NULL THEN NULL
    WHEN bhr_payment_term_days_strict(p_terms) IS NULL THEN NULL
    ELSE ((date_trunc('month', p_billing_date) + interval '1 month' - interval '1 day')::date)
         + bhr_payment_term_days_strict(p_terms)
  END;
$$;

-- ============================================================================
-- c) D1 — close the RLS leak. A narrow, specific elevation: this function
--    reads one low-sensitivity column (payment_terms) for one transaction id
--    the caller is already authorised to write (the trigger only ever fires
--    on a billing_events row save), same reasoning save_transaction_with_events
--    already uses. Locked down explicitly rather than left at the Postgres
--    default (EXECUTE granted to PUBLIC on every new function).
-- ============================================================================

CREATE OR REPLACE FUNCTION bhr_billing_event_payment_terms(p_transaction_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.payment_terms
  FROM transactions t
  LEFT JOIN clients c
    ON c.id = t.client_id
    OR (t.client_id IS NULL AND c.name = t.client_name)
  WHERE t.id = p_transaction_id
  LIMIT 1;
$$;

-- REVOKE FROM PUBLIC alone is not enough: this function already existed
-- (20260913_due_date.sql) and picked up a DIRECT grant to `anon` from
-- Supabase's schema-level default privileges at creation time, which
-- CREATE OR REPLACE preserves and REVOKE ... FROM PUBLIC does not touch.
-- Revoke every role explicitly, then grant back only what's needed.
REVOKE ALL ON FUNCTION bhr_billing_event_payment_terms(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bhr_billing_event_payment_terms(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION bhr_billing_event_payment_terms(uuid) IS
  'SECURITY DEFINER (Repair 18, 2026-10-04) — was a plain STABLE function, so '
  'its LEFT JOIN clients ran under the CALLER''s RLS inside the due_date '
  'trigger, silently resolving an invisible client row to NULL instead of '
  'erroring. General trap: any trigger function that reads a second table '
  'must be SECURITY DEFINER or it will silently see less than the data owner does.';

commit;

-- ============================================================================
-- d) Recompute (outside the main transaction — triggers must see the new
--    function bodies committed first) + freeze proof.
-- ============================================================================

begin;

-- Snapshot paid/cancelled due_dates before recompute, so the freeze can be
-- proven rather than assumed.
CREATE TEMP TABLE repair18_due_date_snapshot AS
SELECT id, due_date FROM billing_events WHERE status IN ('paid', 'cancelled');

UPDATE billing_events
SET billing_date = billing_date
WHERE status NOT IN ('paid', 'cancelled')
  AND due_date_is_manual = false;

commit;
