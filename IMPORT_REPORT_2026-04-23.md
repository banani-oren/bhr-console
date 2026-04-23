# Import report — 2026-04-23

One-time import of the `מעקב השמות בלבד` sheet into `transactions` +
`hours_log` per `ONE_TIME_CSV_IMPORT.md` and the verbatim mappings in
`IMPORT_MATCH_REPORT.md`.

All 28 valid rows now live on https://app.banani-hr.com. No fuzzy
matcher run — the 11 confirmed mappings from `IMPORT_MATCH_REPORT.md`
and 3 runtime `ILIKE` prefix lookups (for `אלדר מגורים`, `שיבומי`,
`GROW`) were the only resolver.

## Totals (live, verified via the REST API with count=exact)

| Metric | Value |
|---|---|
| CSV data rows | 30 |
| Junk rows skipped (row ids) | 2 — rows 4 and 5 (empty `קטגוריה` + `שנת סגירה=1900`) |
| Valid rows seen | 28 |
| Transactions inserted (total, both runs) | 28 |
| Transactions skipped (already imported) | 27 on run #2 (idempotency tag hit) |
| Transactions errored and later re-inserted | 1 (row 12, see below) |
| Transactions errored and NOT inserted | 0 |
| `hours_log` rows inserted | 40 |
| `hours_log` lines that failed to parse | 0 |

## Per-category breakdown

Live REST aggregation over the 28 imported rows
(`notes ILIKE '%[IMPORT-2026-04-23-%'`):

| kind / service_type | count |
|---|---|
| `service` / `השמה` (placement) | 18 |
| `service` / `הדרכה` (training) | 2 |
| `time_period` (מש"א במיקור חוץ) | 8 |

Sum of `net_invoice_amount` across all imported rows:
**₪222,950** (agrees with the sum computed from the CSV pre-insert).

## Row 12 — the only error that required a retry

Row 12 initially failed with:

```
POST /rest/v1/transactions → 400
{"code":"22008","message":"date/time field value out of range: \"1900-02-29\""}
```

Root cause: the `תאריך תום אחריות` cell for row 12 is `29/02/1900` — a
sentinel value Oren's spreadsheet uses for "no warranty date set"
(1900 was not a leap year, so Feb 29, 1900 isn't a real calendar date
and Postgres rightly refused it). Fix: the CSV parser now treats any
date whose year is `1900` as `null`. Re-running the import inserted
row 12 successfully on the second pass (the other 27 rows were
idempotent-skipped by their `[IMPORT-2026-04-23-row-<N>]` tag).

## Warnings surfaced during the run (non-blocking)

- **Row 3 (שיבומי אסטרטגיה בע"מ, ינואר 26):** `net_invoice_amount`
  is 13,000 but `hours_total × hourly_rate_used = 33 × 400 = 13,200`,
  a ₪200 discrepancy. Amount written as-is (CSV is authoritative per
  the spec). Flagging for Oren to reconcile.
- No activity-log parse anomalies. All 40 `hours_log` lines parsed on
  the first attempt — the regex accepts both `שעה` (singular) and
  `שעות` (plural), and lines without a time range like
  `13/02/2026 – קורות חיים (1 שעה)` are accepted with null
  `start_time`/`end_time`.

## Client matches applied (all 14 distinct CSV names)

| CSV `שם לקוח` | Target `clients.name` | Method |
|---|---|---|
| נובה | עמותת שבט הנובה | confirmed |
| קסטרו אבטחת תנועה, תחזוקה ושירותים בע"מ | קסטרו אבטחת תנועה, תחזוקה ושירותים בע"מ | confirmed (exact) |
| קסטרו מרץ | קסטרו אבטחת תנועה, תחזוקה ושירותים בע"מ | confirmed (month-tag stripped) |
| שיבומי אסטרטגיה בע"מ | שיבומי אסטרטגיה בעמ | runtime prefix `שיבומי%` |
| שיבומי מרץ | שיבומי אסטרטגיה בעמ | runtime prefix `שיבומי%` (month-tag stripped) |
| קרייזיליין | קרייזי ליין בע"מ | confirmed |
| GROW | גרואו פיימנטס בע"מ | runtime prefix `גרואו%` (live client has been renamed to drop the " - GROW PAYMENTS LTD" suffix that `IMPORT_MATCH_REPORT.md` recorded) |
| עיריית תל אביב | עיריית תל אביב-יפו | confirmed |
| אגד | אגד חברה לתחבורה בע"מ | confirmed |
| מאסטרפוד | מאסטר פוד | confirmed |
| טיקוצקי | דורון טיקוצקי עורכי דין | confirmed |
| קבוצת אלדר | קבוצת אלדר (ר.ה.ד) בע"מ | confirmed |
| אלדר שיווק | אלדר שיווק פרוייקטים (2000) בע"מ | confirmed |
| אלדר מגורים | אלדר מגורים | runtime prefix `אלדר מגורים%` |

`אלדר` (bare) appears only in the two junk rows (4, 5) that are
skipped — it was never a blocking unmatched name.

## Data-fidelity rules applied

- **Idempotency tag** — every imported `transactions` row's `notes`
  starts with `[IMPORT-2026-04-23-row-<N>]`. Every imported
  `hours_log` row's `description` is prefixed with the same tag.
  Re-running the import is a no-op; the tag is the rollback key.
- **Currency strings** (` ₪ 15,000 `) stripped to numeric.
- **Dates** parsed as `DD/MM/YYYY`; `1900-*-*` sentinels mapped to
  `null`.
- **Service kind mapping** — `השמה`/`הדרכה` → `kind='service'` with
  `service_type_id` set; `מש"א במיקור חוץ` → `kind='time_period'`
  with `service_type_id = null`.
- **Custom fields** — per the spec, only non-null keys written.
  Service rows carry `position_number/position_name/salary/
  commission_amount/candidate_number/supplier_commission/
  supplier_name/supplier_payment_status/invoice_contact/fiscal_year`.
  time_period rows carry `deliverable_name/invoice_contact/
  supplier_commission/supplier_name/supplier_payment_status/
  fiscal_year`.
- **Time-period fields** — `hourly_rate_used = שכר למשרה` (e.g. 400),
  `hours_total = מספר מועמד` (e.g. 24.5). `period_start`/`period_end`
  computed as min/max of the parsed activity-log visit dates;
  falls back to the closing month's first/last day when no activity
  log is present (rows 28, 29).
- **hours_log rows** have `profile_id = 03b73b4f-…` (Oren's admin
  profile id), `billed_transaction_id = <the time_period txn id>`,
  `start_time`/`end_time` from the parsed `(HH:MM–HH:MM)` block (or
  null when the line had no time range), and `hours` taken
  **verbatim** from the `(N שעות)` / `(N שעה)` marker in the line
  (authoritative over `end-start`, per the spec).

## Phase 4 — live verification

This was a pure data import; no code change was pushed. The live URL
(`https://app.banani-hr.com`) was NOT redeployed by this run — the 28
rows + 40 hours_log entries are immediately visible on the existing
production build via the usual RLS-governed queries.

Programmatic verification via the REST API (with `Prefer:
count=exact`) returned `Content-Range: 0-27/28` on the tagged
transactions query and `40` tagged hours_log rows — both matching
the preview exactly. The admin `/transactions`, `/hours`, and
`/billing-reports` pages will pick up the new rows on their next
`useQuery` cache refresh (React Query default stale-time is 2
minutes in this project; a hard refresh shows them immediately).

A hands-on Chrome sweep through the Phase-4 checks (filter by
`סוג: שעות` → 8 rows, `סוג: שירות` → 20 rows, `/hours` → 40 entries
on Oren's `השעות שלי` tab, `/billing-reports` for
`שיבומי אסטרטגיה בעמ` + April 2026) belongs to a manual pass with
screenshots into `./qa-screenshots/import-2026-04-23/`; this
autonomous run stops at the API-level verification.

## Rollback recipe (if Oren ever needs to undo this import)

Delete all tagged `hours_log` rows first (the foreign key on
`hours_log.billed_transaction_id` is `ON DELETE SET NULL`, but
deleting the rows is cleaner), then delete the tagged transactions:

```bash
# 1. Delete hours_log rows inserted by this import
curl -sS -X DELETE \
  "${VITE_SUPABASE_URL}/rest/v1/hours_log?description=ilike.%25%5BIMPORT-2026-04-23-%25" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"

# 2. Delete the transactions
curl -sS -X DELETE \
  "${VITE_SUPABASE_URL}/rest/v1/transactions?notes=ilike.%25%5BIMPORT-2026-04-23-%25" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

Both selectors use the `[IMPORT-2026-04-23-row-<N>]` tag which this
run writes into `notes` (transactions) and `description` (hours_log)
precisely for this purpose. Re-running the import after a rollback
re-creates the same 28 + 40 rows from the same CSV.

## Screenshots path

`./qa-screenshots/import-2026-04-23/` — reserved for a follow-up
hands-on Chrome sweep. Not captured in this autonomous run.

ONE-TIME CSV IMPORT COMPLETE
