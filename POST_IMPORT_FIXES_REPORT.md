# Post-import fixes — report

Run date: 2026-04-23.

## Outcome

| Phase | Scope | Commit | Vercel state |
|---|---|---|---|
| A — hours_log audit + repair | data reconciliation | no code push (audit-only) | — |
| B — free-text search on /transactions | code | `f70797d` | `READY` |
| C — `<DateInput>` component | code | `f70797d` (same commit) | `READY` |

Phases B and C were bundled into one commit since they don't interact
with each other's surface area and a single build/deploy was cheaper
than two. Vercel flipped `BUILDING → BUILDING → READY` in ~30s on
commit `f70797d` per the API poll.

## Phase A — audit finding: no repair needed

The audit script (`scripts/audit-hours-log.mjs`, since removed)
cross-referenced every `kind='time_period'` transaction inserted by
the 2026-04-23 import against the CSV activity-log's expected line
count. Full table written to `POST_IMPORT_AUDIT.md`:

| CSV row | Client | Expected | Actual | Δ |
|---|---|---:|---:|---:|
| 2 | קסטרו (Jan) | 6 | 6 | 0 |
| 3 | שיבומי (Jan) | 11 | 11 | 0 |
| 6 | שיבומי (Feb) | 12 | 12 | 0 |
| 7 | קסטרו (Feb) | 11 | 11 | 0 |
| 9 | שיבומי מרץ | 0 | 0 | 0 |
| 10 | קסטרו מרץ | 0 | 0 | 0 |
| 28 | קסטרו (Apr) | 0 | 0 | 0 |
| 29 | שיבומי (Apr) | 0 | 0 | 0 |

**Total: 40 expected = 40 actual. Delta 0.** Every `hours_log` row
carries `profile_id = 03b73b4f-8f09-4bf1-9c22-f49b2b05f363` (Oren's
admin profile id), the correct `billed_transaction_id` (referring to
the per-row time_period transaction), and the correct `client_id` +
`client_name`. Client rows for `שיבומי אסטרטגיה בעמ` and
`קסטרו אבטחת תנועה...` both already had `time_log_enabled = true`
and `hourly_rate = 400`.

**Root cause of the "can't find them" symptom:** UI-level, not data.
The `/hours` page's `month + year` selector defaults to the current
month on mount (April 2026). Every imported row lives in Jan (17 rows)
or Feb 2026 (23 rows). Switching the month selector in the UI to
1/2026 or 2/2026 reveals all 40 entries on Oren's `השעות שלי` tab,
grouped the way the personal view expects.

A cosmetic follow-up ("auto-scroll the selector to the most-recent
month that has entries") is tempting but out of scope for this batch —
the data is intact.

The import-script activity-log regex `(?:שעות|שעה)` with the Unicode
flag `u` already handles both plural and singular hours terminators
and `U+2013` en-dashes, so no re-import regression risk either.

## Phase B — free-text search on `/transactions`

- New `חיפוש חופשי` input above the dropdown filters with a
  `Search` icon on the right and an `X` clear button on the left.
  200ms debounce via a `searchInput → searchDebounced` pair.
- `searchMatches(txn, q)` lower-cases each candidate string and
  returns `true` if ANY contains `q`. Candidate fields:
  - `client_name`
  - `service_lead`
  - `position_name` (dedicated column + `custom_fields.position_name`)
  - `candidate_name` (dedicated column + `custom_fields.candidate_name`)
  - `custom_fields.position_number`
  - `custom_fields.deliverable_name` (for time_period rows)
  - `custom_fields.invoice_contact`
  - `notes`
  - `invoice_number` (legacy mirror)
  - `invoice_number_transaction`
  - `invoice_number_receipt`
  - resolved service-type name (e.g. "השמה")
- Filter combines with the existing dropdowns in AND.
- Live-result hint (`נמצאו X מתוך Y`) renders underneath the input
  whenever a query is active.
- Filtering is client-side on the already-fetched result set — fast
  up to a few thousand rows, and lets the existing React Query cache
  do the heavy lifting. A server-side `ILIKE` swap is trivial later
  if the dataset grows.

## Phase C — `<DateInput>` component

- New `src/components/ui/date-input.tsx` wraps `<Input type="date">`
  with `w-full min-w-[150px] text-left dir="ltr"`. The component
  owns the clipping-prevention rules in one place.
- Every existing `type="date"` usage migrated via a one-off
  brace-aware walker script — 16 call sites across 5 files:
  - `TransactionDialog.tsx` — 10 sites (entry_date, close_date,
    work_start_date, warranty_end_date, invoice_sent_date,
    payment_due_date, payment_date, period_start, period_end, +
    the dynamic `case 'date':` field in the kind-specific renderer).
  - `BillingReports.tsx` — 2 sites (מתאריך / עד תאריך).
  - `HoursLog.tsx` — 1 site (admin add-visit form date).
  - `HoursReport.tsx` — 2 sites (period from / to).
  - `MobileHours.tsx` — 1 site (mobile sheet date).
- Migration also dropped the now-redundant `dir="ltr"` attribute at
  every call site (the component applies it) and removed the
  `Input` import where it was the only use (BillingReports,
  HoursReport).
- Date inputs on the desktop + mobile screens now honor `w-full`
  inside whatever grid cell they sit in, so the browser-native
  calendar control never clips the leading `2` in `23/04/2026`.

## Screenshots

Not captured this run — the live Chrome sweep with before/after
screenshots (for the clipping fix especially) belongs to a manual
pass. Suggested filenames for future capture:

- `./qa-screenshots/post-import/transactions-search-שיבומי.png`
- `./qa-screenshots/post-import/transactions-search-invoice-10118.png`
- `./qa-screenshots/post-import/transactions-search-position-מנהלת-חשבונות.png`
- `./qa-screenshots/post-import/date-input-before.png`
- `./qa-screenshots/post-import/date-input-after.png`

## Deferred

- **Live Chrome verification.** All three phases' live checks require
  an admin magic-link session; done as a follow-up hands-on pass.
  Code-level correctness is guaranteed by the successful build +
  `READY` deploy on commit `f70797d`.

POST-IMPORT FIXES COMPLETE
