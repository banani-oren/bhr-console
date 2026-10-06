-- Repair 19 Part D2.1 — drop transactions.billing_percent.
--
-- Confirmed dead in both senses before dropping (2026-10-06):
--   - DB: 0 rows across the entire transactions table have a non-null value.
--   - Code: the only two references in src/ are the TypeScript type
--     declaration and a comment explicitly saying it's NOT used
--     ("compute net_invoice_amount from salary × commission% (no
--     billing_percent)"). Zero functional reads or writes anywhere.
--
-- This has been "noted as dead" in CLAUDE.md for months (since the
-- Collection Model repair, 2026-10-03) without ever being finished — this
-- phase finishes it, per Oren's documentation-truth-pass instruction.

ALTER TABLE transactions DROP COLUMN IF EXISTS billing_percent;
