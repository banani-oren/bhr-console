-- Migration: Suppliers table + transaction supplier fields
-- Date: 2026-04-26

-- 1. Create suppliers table
CREATE TABLE IF NOT EXISTS suppliers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name  text NOT NULL,
  last_name   text NOT NULL,
  email       text,
  mobile      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS: admin can manage, all authenticated can read (for picker in transaction dialog)
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suppliers_select" ON suppliers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "suppliers_insert" ON suppliers
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "suppliers_update" ON suppliers
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "suppliers_delete" ON suppliers
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 2. Add supplier columns to transactions
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS supplier_id      uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_percent numeric(5, 2);
