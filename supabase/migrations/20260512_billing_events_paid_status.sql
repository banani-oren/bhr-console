-- Add 'paid' to billing_events status enum
-- Postgres CHECK constraints must be dropped and re-added

ALTER TABLE billing_events
  DROP CONSTRAINT IF EXISTS billing_events_status_check;

ALTER TABLE billing_events
  ADD CONSTRAINT billing_events_status_check
  CHECK (status IN ('pending', 'to_bill', 'billed', 'paid', 'cancelled'));

-- Backfill: any event that has receipt_number set but status='billed' → mark as paid
UPDATE billing_events
SET status = 'paid'
WHERE status = 'billed'
  AND receipt_number IS NOT NULL
  AND receipt_number != '';
