-- Phase 2: Billing Events, Transaction Approval, Hours Fix

-- ─── 1. New columns on transactions ───────────────────────────────────────────

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS work_end_date      date,
  ADD COLUMN IF NOT EXISTS created_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at        timestamptz,
  ADD COLUMN IF NOT EXISTS needs_approval     boolean DEFAULT false;

-- ─── 2. New table: billing_events ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  event_index      integer NOT NULL DEFAULT 1,
  amount           numeric NOT NULL DEFAULT 0,
  description      text,
  billing_date     date,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'to_bill', 'billed', 'cancelled')),
  invoice_number   text,
  payment_date     date,
  receipt_number   text,
  advance_applied  numeric DEFAULT 0,
  supplier_amount  numeric DEFAULT 0,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_transaction
  ON billing_events(transaction_id);

CREATE INDEX IF NOT EXISTS idx_billing_events_billing_date
  ON billing_events(billing_date);

CREATE INDEX IF NOT EXISTS idx_billing_events_status
  ON billing_events(status);

CREATE OR REPLACE FUNCTION update_billing_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS billing_events_updated_at ON billing_events;
CREATE TRIGGER billing_events_updated_at
  BEFORE UPDATE ON billing_events
  FOR EACH ROW EXECUTE FUNCTION update_billing_events_updated_at();

-- ─── 3. RLS on billing_events ─────────────────────────────────────────────────

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_billing_events_all" ON billing_events;
CREATE POLICY "admin_billing_events_all" ON billing_events
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "administration_billing_events_all" ON billing_events;
CREATE POLICY "administration_billing_events_all" ON billing_events
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'administration')
  );

DROP POLICY IF EXISTS "recruiter_billing_events_read" ON billing_events;
CREATE POLICY "recruiter_billing_events_read" ON billing_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM transactions t
      JOIN profiles p ON p.full_name = t.service_lead
      WHERE t.id = billing_events.transaction_id
        AND p.id = auth.uid()
        AND p.role = 'recruiter'
    )
  );

-- ─── 4. Historical data correction: fix ריטיינר transactions ─────────────────
-- These have net_invoice_amount = raw hours (not ₪). Multiply by client hourly_rate.

UPDATE transactions t
SET net_invoice_amount = t.net_invoice_amount * c.hourly_rate
FROM clients c
WHERE t.service_type = 'ריטיינר'
  AND t.kind = 'service'
  AND c.name = t.client_name
  AND c.hourly_rate IS NOT NULL
  AND c.hourly_rate > 0
  AND t.net_invoice_amount IS NOT NULL
  AND t.net_invoice_amount < 1000;
