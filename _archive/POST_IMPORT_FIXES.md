# Post-import fixes — audit missing hours, add transactions search, fix date input clipping

Three independent phases. Execute in order. Each phase ends with verification
in Chrome at `https://app.banani-hr.com`. Do not stop, do not ask, do not
summarize mid-run. Produce `POST_IMPORT_FIXES_REPORT.md`.

## Read first

1. `BHR_CONSOLE_PROJECT.md`.
2. `ONE_TIME_CSV_IMPORT.md` and `IMPORT_MATCH_REPORT.md` — what the import
   was supposed to do.
3. `IMPORT_REPORT_2026-04-23.md` — what actually happened (counts,
   anomalies).
4. `test-fixtures/import-2026-04-23.csv` — the source truth for re-parsing
   activity logs if needed.
5. This file.

## Hard rules

- English only for commits. No secrets in output.
- Per the Vercel deploy rule in `CLAUDE_CODE_AUTONOMOUS.md`, any code
  change is verified by `state=READY` before declaring done.

---

## Phase A — Audit and repair missing `hours_log` entries from the import

**Symptom:** Oren inspected `/hours` as himself and could not find hourly
entries for שיבומי or קסטרו, even though the corresponding `kind='time_period'`
transactions for those clients DID land (visible in `/transactions`).

### A1. Audit

Load secrets from `.env.local`. Produce a complete reconciliation report.

```bash
SUPA_URL="$(grep '^VITE_SUPABASE_URL=' .env.local | cut -d= -f2-)"
SUPA_KEY="$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)"

# 1. Every time_period transaction from this import:
curl -sS "${SUPA_URL}/rest/v1/transactions?select=id,client_id,period_start,period_end,hours_total,notes&kind=eq.time_period&notes=ilike.%25IMPORT-2026-04-23%25" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY"

# 2. Every hours_log row tied to this import (by billed_transaction_id or by tag in description):
curl -sS "${SUPA_URL}/rest/v1/hours_log?select=id,client_id,client_name,visit_date,hours,description,billed_transaction_id,profile_id&description=ilike.%25IMPORT-2026-04-23%25" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY"

# 3. Hours_log rows linked to any of the imported transactions by billed_transaction_id:
#    (loop over each transaction id from #1 and count hours_log rows)
```

Cross-reference against the CSV:

- For each CSV row where `קטגוריה = מש"א במיקור חוץ`:
  - Parse its `מועמדים בתהליך` activity log into N lines (using the regex
    from `ONE_TIME_CSV_IMPORT.md`).
  - Look up the corresponding imported transaction by
    `notes ilike '%[IMPORT-2026-04-23-row-<N>]%'`.
  - Expected hours_log count = N parsed lines. Compare against actual.

Write the audit results to `POST_IMPORT_AUDIT.md`:

| CSV row # | Client | Transaction id | Expected hours lines | Actual hours_log rows | Delta | Root cause (if any) |
|---|---|---|---|---|---|---|

### A2. Likely root causes to check in code

Claude Code must identify which of these actually applies before patching:

- **En-dash vs hyphen regex failure.** The CSV uses `–` (U+2013), but if
  the parser was written with `-` only, NO lines match and zero hours_log
  rows get created per מש"א transaction. This is the most likely cause.
- **`billed_transaction_id` written but no FK insert.** If the parser ran
  but the INSERT to `hours_log` silently failed (RLS, type mismatch on
  `start_time` / `end_time`, missing column), it would log an error and
  the transaction row would still land without its children.
- **`profile_id` lookup failed.** If `profiles WHERE email='bananioren@gmail.com'`
  returned nothing (e.g., admin was queried before Phase B of batch 3
  made admins appear in the employee-capable set), all hours_log inserts
  would fail.
- **Truncation in the text cell.** If the CSV reader truncated the
  activity log at the first embedded newline, only line 1 would parse.
  Check: row 2 (קסטרו) has 6 lines, row 3 (שיבומי) has 11 lines. If
  actual count for these is 0 or 1, this is the smoking gun.

### A3. Repair

For every time_period transaction that is missing its hours_log children:

1. Re-parse the activity log from the CSV cell for that row.
2. Insert the missing hours_log entries with:
   - `profile_id` = Oren's auth id (look up once)
   - `client_id` / `client_name` = the transaction's client
   - `visit_date`, `start_time`, `end_time`, `hours`, `description` = per
     the parsed line
   - `billed_transaction_id` = the transaction id
   - `description` prefixed with `[IMPORT-2026-04-23-row-<N>]` so repair
     is idempotent and reversible.
3. Do NOT touch transactions that already have the correct child count.

If the root cause was a regex bug in the import script, ALSO fix the bug
in the import script so a re-import wouldn't regress. The one-time import
script lives in-repo as whatever Code created during the prior run;
locate and patch it.

### A4. Live verification

- `/hours` → `השעות שלי` tab → January 2026. See the 40+ entries
  distributed across קסטרו and שיבומי, each showing date, start→end,
  hours, description. Total for January hours should match the sum of
  `hours_total` across the imported time_period transactions.
- Open one of the time_period transactions in `/transactions` → edit
  dialog → "הפק דף שעות" button produces a PDF with the same entries.

Commit: `fix(import): repair missing hours_log entries + patch activity-log regex (Phase A)`.

---

## Phase B — Free-text search on `/transactions`

Current `/transactions` has only dropdown filters (סוג, שנה, חודש, ליד
שירות, סטטוס, חיוב). Oren wants a single text input above the filters
that matches across every searchable field simultaneously.

### Target

- Text input at the top of `/transactions`, left of the existing filter
  dropdowns, labeled `חיפוש חופשי` with placeholder
  `חפש לפי לקוח, עובד, משרה, מועמד...`.
- As the user types (debounce 200ms), the table filters to rows where
  ANY of the following substrings (case-insensitive) match:
  - `clients.name` (joined via `client_id`)
  - `service_lead` (string column)
  - `custom_fields->>'position_name'`
  - `custom_fields->>'candidate_name'`
  - `custom_fields->>'position_number'`
  - `notes`
  - `invoice_number_transaction`
  - `invoice_number_receipt`
- Works in combination with the existing dropdown filters (AND logic).
- Empty search box means no text-filter applied (all rows).

### Implementation approach

React Query already fetches transactions with joined client. Filtering
happens client-side on the result set (simple, fast for up to a few
thousand rows; database query stays simple). If the dataset grows past
that, move to a server-side `ILIKE` query in a follow-up — not needed
now.

Use a single-line debounced input. No magic. Expose a small "×" to clear.

### Live checks

- Type `שיבומי` → only שיבומי rows visible. Clear → all rows back.
- Type `מנהלת חשבונות` → the קבוצת אלדר placements with that position
  appear.
- Type `10118` (an invoice number) → the single matching row appears.
- Combine: type `אלדר` + select `סוג שירות: השמה` → only השמה transactions
  for any אלדר client.
- Clear with `×` button.

Commit: `feat(transactions): free-text search across client/lead/position/candidate/invoice (Phase B)`.

---

## Phase C — Date-input clipping in hours-entry dialog

**Symptom (see Oren's screenshot):** the date input in the hours-log
entry dialog displays `3/04/2026` where the full value is `23/04/2026` —
the leading `2` is clipped off the visible edge of the input. Likely
the `<input type="date">` has a constrained width that doesn't
accommodate the full `DD/MM/YYYY` + calendar icon in RTL context.

### Fix

1. In the hours-entry dialog's date field:
   - Set `w-full` on the input (no fixed width).
   - Apply `min-w-[150px]` as a guard so the browser's native
     date-picker rendering (which is OS-dependent) never clips.
   - Add `text-left dir="ltr"` on the date input specifically — date
     values are numeric LTR even inside an RTL form, and letting them
     auto-inherit RTL causes the calendar icon and digits to compete for
     the same edge.
2. Audit every other `<input type="date">` in the app for the same
   pattern. Candidates:
   - Client edit dialog (work start date, warranty end date)
   - Transaction dialog (entry date, close date, invoice sent date,
     payment due date, payment date)
   - Hours log filters (month/year selectors)
   - Billing reports filter (מתאריך / עד תאריך)
3. Extract the fixed styling into a `<DateInput>` component so future
   date fields can't regress.

### Live checks

- Open hours-entry dialog → today's date shows as `23/04/2026` in full,
  not clipped.
- Tab to any other date field in the app (client dialog, transaction
  dialog, billing reports) → full date visible, calendar icon not
  overlapping.
- Set the date to `01/12/2026` (month/day with different widths) →
  still displays fully.

Commit: `fix(ui): <DateInput> component, prevents RTL clipping on date fields (Phase C)`.

---

## Termination

1. Write `POST_IMPORT_FIXES_REPORT.md`:
   - Per-phase commit SHAs.
   - Phase A audit table with before/after counts and the root cause.
   - Total hours_log rows created during repair (should match expected
     lines across all מש"א rows — the CSV had 6+11+... entries in
     `מועמדים בתהליך`; report the precise expected total).
   - Phase B: screenshots of `/transactions` with the search in action
     (three distinct searches covering all match fields).
   - Phase C: before/after screenshots of the hours-entry dialog date
     field + a second example from a different dialog.
2. Print `POST-IMPORT FIXES COMPLETE` and stop.
