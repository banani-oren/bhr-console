-- Phase 1: Clients & Contracts structural fix

-- 1a. Add client_id FK to transactions (nullable — not all old rows will match)
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL;

-- 1b. Backfill client_id from client_name match (best-effort, case-sensitive)
UPDATE transactions t
SET client_id = c.id
FROM clients c
WHERE c.name = t.client_name
  AND t.client_id IS NULL;

-- 1c. Add index for the new FK
CREATE INDEX IF NOT EXISTS idx_transactions_client_id ON transactions(client_id);

-- 1d. Add structured payment split column (array of {percent, days})
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS payment_split_json jsonb DEFAULT '[]'::jsonb;

-- 1e. Add structured advance columns
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS advance_type text CHECK (advance_type IN ('fixed', 'percent')),
  ADD COLUMN IF NOT EXISTS advance_amount numeric;

-- NOTE: agreement_type, salary_basis, exclusivity, agreement_file, agreement_storage_path
-- columns are NOT dropped (to preserve any existing data) but will no longer be written
-- or displayed by the UI after this release.
-- The `agreements` table remains for legacy read access but will no longer be written to.
