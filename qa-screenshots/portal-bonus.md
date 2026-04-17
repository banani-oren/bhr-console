# Portal — Bonus tab (`/portal?token=…`)

**Captured:** Round 2 autonomous run.
**Employee:** `QA Test Employee` (round-2 seed, portal_token `303f1bc3-0ef5-418a-a918-3c8aa2056d35`).
**Bonus model:** Noa 7-tier flat spec, filter `service_lead ilike '%QA Test Employee%'`.

All **three** bonus spot checks were live-verified *in the browser* by switching
the month selector — directly observed values:

| Month | Seeded revenue | Portal revenue | Portal bonus | Tier badge | Next-tier text |
|-------|---------------|----------------|--------------|------------|----------------|
| Apr 2026 | ₪9,000 | `₪ 9,000.00` | `₪ 0.00` | `מדרגה נוכחית: ₪0` | `עוד 1,000.00 ₪ למדרגה הבאה` |
| Mar 2026 | ₪30,000 | `₪ 30,000.00` | `₪ 2,100.00` | `מדרגה נוכחית: ₪2,100` | `עוד 7,000.00 ₪ למדרגה הבאה` |
| Feb 2026 | ₪70,000 | `₪ 70,000.00` | `₪ 5,200.00` | `מדרגה נוכחית: ₪5,200` | *(none — max tier reached)* |

Tiers table consistently shows **2 columns only** (`מינימום` / `בונוס`), no `%`,
no `max`. Current tier row highlighted purple/bold with the bonus badge filled.

**Underlying wiring verified:**
- Bonus tab gated by `!!member.bonus_model` (present for QA Test Employee; absent
  for Nadia in production).
- Revenue fetched via `rpc('portal_revenue', { p_token, p_month, p_year })` — the
  SECURITY DEFINER function returns the filtered revenue without granting anon
  SELECT on `transactions` (§11 RLS constraint preserved).
- `calcBonus(revenue, tiers)` in `Portal.tsx` uses
  `[...tiers].reverse().find(t => revenue >= t.min)` — exactly the flat-tier
  semantics in `BHR_CONSOLE_PROJECT.md`.

**Console on the Portal tab:** clean, zero errors, zero warnings (no
`Multiple GoTrueClient instances` message — storageKey fix is effective).
