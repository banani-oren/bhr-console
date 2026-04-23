# One-time import: `מעקב השמות בלבד` CSV → transactions + hours_log

Execute end-to-end. Four phases: match, preview, import, verify. Do not
stop, do not ask, do not summarize mid-run. **Phase 2 gates Phase 3**: if
any row fails to match a client, write the unmatched list to
`IMPORT_UNMATCHED.md` and stop after Phase 2 so Oren can resolve before
re-running. Report in `IMPORT_REPORT_2026-04-23.md`.

## Read first

1. `BHR_CONSOLE_PROJECT.md`.
2. `REFINEMENTS_BATCH_3.md` — defines the `kind='service' | 'time_period'`
   model, service_types seeds, and the custom_fields JSONB shape used below.
3. `test-fixtures/import-2026-04-23.csv` — the source data (30 real rows +
   2 junk rows).
4. This file.

## Hard rules

- English only for commit messages.
- Never print secrets. Load `SUPABASE_SERVICE_ROLE_KEY`,
  `VITE_SUPABASE_URL`, `SUPABASE_ACCESS_TOKEN` from `.env.local`.
- Every inserted row is tagged `[IMPORT-2026-04-23-row-<N>]` in its `notes`
  so the import is **idempotent and reversible** — before inserting any
  row, first check if one with the same tag exists and skip if so.
- Live-verify per the Vercel `state=READY` rule in
  `CLAUDE_CODE_AUTONOMOUS.md` (no code change is being pushed here, but
  the live site must still render the new rows correctly).
- This is a DATA import, no schema change, no `git push`.

## Source-data dialect

CSV structure:

- Row 0: per-column annotations (ignore).
- Row 1: headers.
- Rows 2+: data. Empty rows and rows with empty `קטגוריה` + `שנת סגירה=1900`
  are scratch/junk — skip them. The CSV currently has 2 such junk rows.

The 34 columns have already been mapped in the schema; key categories:

| קטגוריה                 | kind              | service_type    |
|-------------------------|-------------------|-----------------|
| `השמה`                  | `service`         | `השמה`           |
| `הדרכה`                 | `service`         | `הדרכה`          |
| `מש"א במיקור חוץ`        | `time_period`     | (none; null)    |

Currency strings (` ₪ 15,000 `) need to be stripped to `15000` (numeric).
Percentages are already numeric. Dates are `DD/MM/YYYY`.

### Per-row column → DB column mapping

All rows:

| CSV column | DB field |
|---|---|
| `שם לקוח` | `client_id` (via client-match) |
| `מוביל שירות` | `service_lead` (verbatim; also look up `profile_id` for reference) |
| `תאריך תחילת עבודה + תאריך הפקת חשבונית` | `entry_date` |
| `חתימת חוזה (סגירה)` | `close_date` |
| `תאריך תום אחריות` | `warranty_end_date` |
| `תאריך שליחת חשבונית` | `invoice_sent_date` |
| `מועד לתשלום` | `payment_due_date` |
| `תשלום בפועל` | `payment_date` (null if not paid) |
| `סטטוס תשלום לקוח` | `payment_status` (default `ממתין`; if the cell is `שולם`, use `שולם`) |
| `חשבונית עסקה` | `invoice_number_transaction` |
| `חשבונית מס קבלה` | `invoice_number_receipt` |
| `חודש סגירה` / `שנת סגירה` | `closing_month` / `closing_year` |
| `חודש כניסה` / `שנת כניסה` | `billing_month` / `billing_year` |
| `חיוב / ללא חיוב` | `is_billable` (`לחיוב` → true, `לא לחיוב` → false) |
| `סכום לתשלום חשבונית` | `net_invoice_amount` |
| `סוג הסכם והערות לקראת החשבונית)` | `notes` (prefixed with `[IMPORT-…]`) |

`kind='service'` (השמה / הדרכה) — `custom_fields` JSONB:

```json
{
  "position_number": "<מספר משרה>",
  "position_name":   "<שם משרה>",
  "salary":          <שכר למשרה>,
  "commission_amount": <עמלה>,
  "candidate_number": <מספר מועמד>,
  "supplier_commission": <עמלה לספק>,
  "supplier_name":   "<שם ספק משנה>",
  "supplier_payment_status": "<סטטוס תשלום לספק>",
  "invoice_contact": "<איש/אשת קשר לשליחת חשבונית>",
  "fiscal_year":     <שנה עסקית>
}
```

Only include non-null keys. `service_type_id` resolved from
`service_types.name = 'השמה'` or `'הדרכה'`.

`kind='time_period'` (מש"א במיקור חוץ):

- `hourly_rate_used` = `שכר למשרה` (it's actually the hourly rate, e.g. 400)
- `hours_total` = `מספר מועמד` (it's actually total hours, e.g. 24.5)
- `net_invoice_amount` = `סכום לתשלום חשבונית` (sanity-check: should
  equal `hourly_rate_used * hours_total` ± ₪1; if off by more, log a
  warning)
- `period_start` / `period_end`: parsed from the activity log — min and
  max of the parsed dates. If the activity log is missing, fall back to
  `closing_month/year` as the full month range.
- `service_type_id` = NULL.
- `custom_fields` = `{ "deliverable_name": "<שם משרה>",
  "invoice_contact": "<...>", "supplier_commission": <…>, "supplier_name":
  "<…>", "supplier_payment_status": "<…>", "fiscal_year": <…> }`.

### Activity-log → hours_log parser

The `מועמדים בתהליך` column for מש"א rows contains one entry per line:

```
D/M/YYYY (HH:MM–HH:MM) – DESCRIPTION (N שעות)
```

Note the **en-dash** `–` (U+2013), not a hyphen, between start/end times
and between time-range and description. Parser:

```python
import re
LINE_RE = re.compile(
    r'^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*'    # date D/M/YYYY
    r'\(\s*(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})\s*\)\s*'  # (HH:MM–HH:MM)
    r'[–-]\s*(.+?)\s*'                        # – description
    r'\(\s*([\d.]+)\s*שעות?\s*\)\s*$'         # (N שעות)
)
```

For each match, produce an `hours_log` row:

| field | value |
|---|---|
| `profile_id` | Oren's admin profile id (look up once: `profiles.id where email='bananioren@gmail.com'`) |
| `client_id` | the row's matched client |
| `client_name` | the row's raw client name |
| `visit_date` | `YYYY-MM-DD` from the date |
| `start_time` / `end_time` | `HH:MM:00` |
| `hours` | the explicit N from `(N שעות)` — **authoritative** over subtracting times (Oren's column values are the truth) |
| `description` | the captured description text (trimmed) |
| `month` / `year` | from `visit_date` |
| `billed_transaction_id` | the `transactions.id` of the time_period row just inserted for this client+period |

If a line in the activity log fails to parse, record it in the preview as
an anomaly but do not block the import — the transaction row still goes
through; just the specific hours_log line is skipped and logged.

## Phase 1 — Client matching

Load all rows from `clients`:

```bash
curl -sS "${VITE_SUPABASE_URL}/rest/v1/clients?select=id,name,company_id" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

For each CSV row's `שם לקוח`, match as follows:

1. **Exact** (case/whitespace insensitive, after trimming niqqud): the CSV
   name equals `clients.name` → match.
2. **Substring unique**: if the CSV name is a strict substring of exactly
   one client name (e.g., "אלדר" → only one client whose name starts with
   אלדר) → match. If multiple, **ambiguous** → queue for review.
3. **Trigram / Dice** ≥ 0.75 with exactly one best candidate → match.
4. Else → **unmatched**.

Known headaches from the data:

- `אלדר` — clients table has
  `אלדר השקעות / אלדר מגורים בע"מ / אלדר משכנתאות בע"מ / אלדר שיווק פרוייקטים (2000) בע"מ`.
  The CSV distinguishes `אלדר`, `אלדר מגורים`, `אלדר שיווק`, `קבוצת אלדר`
  — so the CSV row `אלדר מגורים` maps to `אלדר מגורים בע"מ`, and
  `אלדר שיווק` to `אלדר שיווק פרוייקטים (2000) בע"מ`. The bare
  `אלדר` / `קבוצת אלדר` are likely ambiguous — flag for Oren.
- `קסטרו מרץ` / `שיבומי מרץ` — these are "March billing" variants for
  `קסטרו ...` / `שיבומי אסטרטגיה בע"מ`. Treat "מרץ" / "ינואר" /
  "פברואר" etc. as month tags and strip before matching.
- `GROW`, `טיקוצקי`, `נובה`, `מאסטרפוד`, `קרייזיליין`, `עיריית תל אביב` —
  likely exact or close matches; let the fuzzy pass find them. If any
  ends up unmatched, flag.

## Phase 2 — Preview & gate

Write `IMPORT_PREVIEW.md`:

- Total rows parsed: (should be 30, 2 junk skipped).
- Matched rows: count.
- Unmatched rows: per-row list with the CSV row number, the CSV name, and
  the top 3 closest client candidates with scores.
- Ambiguous rows: per-row with the list of candidates.
- For matched rows, summary breakdown:
  - X service transactions (השמה / הדרכה breakdown).
  - Y time_period transactions.
  - Z hours_log rows that will be created.
- Activity-log parse anomalies (lines that didn't match the regex), if any.

**Gate:** if `unmatched + ambiguous > 0`, write
`IMPORT_UNMATCHED.md` with the same detail, print a clear message to
the console telling Oren how to resolve (either rename the CSV value, or
create / rename the client), and STOP. Do not proceed to Phase 3.

If everything is matched, proceed automatically.

## Phase 3 — Import

For every CSV row, in order:

1. Skip junk rows (empty `קטגוריה` AND `שנת סגירה` in [1900, null]).
2. **Idempotency check**: run
   `GET /rest/v1/transactions?notes=ilike.%25[IMPORT-2026-04-23-row-<N>]%25`
   — if a row exists, log `skipped (already imported)` and continue.
3. Build the `transactions` row per the mapping above. Set
   `notes` to `[IMPORT-2026-04-23-row-<N>] <original סוג הסכם cell>`.
4. Insert:
   ```bash
   curl -sS -X POST "${VITE_SUPABASE_URL}/rest/v1/transactions" \
     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -H "Prefer: return=representation" \
     -d "@row-<N>.json"
   ```
   Capture the returned `id`.
5. If `kind='time_period'`: parse the activity log, build `hours_log`
   rows with `billed_transaction_id = <returned id>`, insert in a single
   bulk POST to `/rest/v1/hours_log`.
6. On any insert error: abort the current row (do not leave a partial
   time_period transaction without its hours_log children), log with the
   full error, continue to the next row. Roll back using the captured
   id if the transaction inserted but its hours_log bulk failed.

## Phase 4 — Verify live

Using the admin magic-link flow, open Chrome on
`https://app.banani-hr.com`:

1. `/transactions` — apply `סוג: הכל` filter + no date filter. Expect
   to see the 28 imported rows (18 השמה + 8 מש"א + 2 הדרכה). Click a
   מש"א row → detail shows the time-period amount and dates.
2. Filter `סוג: שעות` → 8 rows.
3. Filter `סוג: שירות` → 20 rows.
4. `/hours` as Oren → switch to `השעות שלי` tab → see the parsed entries
   for January 2026 on the correct clients, each one linked to its
   billed time_period transaction.
5. `/billing-reports` → filter by client `שיבומי אסטרטגיה בע"מ` + period
   `January 2026` → should show both the מש"א time_period row (if it's
   for Jan) and any השמה row for that client; amounts match the CSV.

Take screenshots into `./qa-screenshots/import-2026-04-23/`.

## Termination

1. Write `IMPORT_REPORT_2026-04-23.md`:
   - Rows parsed / matched / inserted / skipped-already-imported /
     errored.
   - Per-category counts.
   - Any hours_log lines that failed to parse (description + line text).
   - Total amount imported (sum of `net_invoice_amount`).
   - Screenshots path.
   - **Rollback recipe:** a curl one-liner Oren can run to delete every
     imported row if needed:
     ```bash
     curl -sS -X DELETE \
       "${VITE_SUPABASE_URL}/rest/v1/transactions?notes=ilike.%25%5BIMPORT-2026-04-23-%25" \
       -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
       -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
     ```
     (This also cascades `hours_log.billed_transaction_id` to NULL; those
     rows would then need a separate deletion via their own tag — add a
     note field to the hours_log rows mirroring the transaction tag to
     make this clean.)
2. Print `ONE-TIME CSV IMPORT COMPLETE` and stop.
