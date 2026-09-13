-- Fix (same-day follow-up to 20260913_due_date.sql, caught during QA):
-- trg_billing_events_due_date recomputed due_date on EVERY update to a
-- billing_events row, including an update to a completely unrelated field
-- (payment_date, receipt_number, amount) on an already-'paid'/'cancelled'
-- row. The clients-side trigger already excludes paid/cancelled events from
-- its bulk recompute (to protect D5's due-date-based bonus attribution from
-- being silently moved), but that protection was missing here — any save on
-- a paid row's own fields (e.g. TransactionDialog's new "תאריך תשלום בפועל"
-- input) still let this trigger silently recompute due_date from whatever
-- the client's CURRENT payment_terms happen to be. Reproduced live via QA:
-- a no-op `amount = amount` update on a paid row moved its due_date to match
-- the client's terms as of that moment. Idempotent — safe to re-run.

CREATE OR REPLACE FUNCTION bhr_billing_events_set_due_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.due_date_is_manual IS TRUE THEN
    RETURN NEW;
  END IF;
  -- Once an event is paid or cancelled its due_date is settled — freeze it
  -- against ANY further automatic recompute (not just the clients-side
  -- payment_terms trigger), the same way a manual override is frozen. A
  -- direct manual edit still works: it always sets due_date_is_manual = true
  -- in the same UPDATE, which the check above already lets through first.
  IF TG_OP = 'UPDATE' AND OLD.status IN ('paid', 'cancelled') AND NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  NEW.due_date := bhr_calc_due_date(NEW.billing_date, bhr_billing_event_payment_terms(NEW.transaction_id));
  RETURN NEW;
END;
$$;
