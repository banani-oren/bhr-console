# Refinements Batch 3 — Report

Run date: 2026-04-22.

## Commit SHAs

| Phase | SHA | Title |
|-------|-----|-------|
| A + B + schema groundwork | `dfef946` | `feat(roles): admin is also an employee + purge non-service types` |
| C + D + E | `045df47` | `feat(transactions): single-panel dialog with service+time kinds + canonical seeds + time-sheet PDF` |
| F | `f6ff4fa` | `feat(billing): billing_reports page with PDF across kinds` |
| G | (this commit) | `docs: spec + checklist + REFINEMENTS_3_REPORT` |

Every commit auto-deployed to https://bhr-console.vercel.app.

## Phase A — service_types purge

- Migration `supabase/migrations/20260422_refinements_batch3.sql`
  removes `דיווח שעות` and `מש"א במיקור חוץ` from `service_types` and
  reassigns any dangling `transactions.service_type_id` to
  `kind='time_period'` with `period_start / period_end / hours_total /
  hourly_rate_used` backfilled from `custom_fields`.
- **Dangling transactions found at run time: 0.** The prior-batch seed
  (batch 2) had introduced `דיווח שעות` but no transactions had been
  written against it yet; `מש"א במיקור חוץ` was never seeded into this
  environment.
- `/services` post-migration shows exactly 4 canonical rows:
  `השמה (10 fields) · הד האנטינג (6) · הדרכה (6) · גיוס מסה (4)`.

## Phase B — admin-is-employee

- `/team` query broadened to `role IN ('admin','administration','recruiter')`;
  Oren now appears as a card with a purple `מנהל` badge alongside every
  employee. The same `EmployeeFormBody` persists `bonus_model` and
  `hours_category_enabled` for any role including admin.
- `/hours` admin branch gains a `ניהול שעות / השעות שלי` pill toggle.
  `mine` mode renders the personal client-picker view with
  `profile_id = auth.uid()` scoping. The `permittedClients` query
  returns every `time_log_enabled=true` client when the caller is admin
  (no explicit `client_time_log_permissions` rows required).
- `/clients` time-log permissions multi-select now includes admins, with
  role label `מנהל` / `מנהלה` / `רכז/ת`.
- `/` dispatcher becomes a three-pill toggle for admins:
  `דשבורד מנהל / דשבורד עובד / דשבורד גבייה` → `AdminDashboard`,
  `RecruiterDashboard`, `AdministrationDashboard`. Non-admins see no
  toggle and render their scoped dashboard directly.

## Phase C — Transaction dialog redesign

`src/components/TransactionDialog.tsx` replaces the 3-step wizard with
a single `max-w-4xl` panel:

- **Kind pills:** dynamic services on the left, separator, visually-
  distinct amber `דיווח שעות` pill with 🕒 icon.
- **Client autocomplete:** filters by `name.ilike` or `company_id.ilike`,
  up to 10 hits; selecting hydrates `commission_percent`, `warranty_days`,
  `payment_terms`, `hourly_rate` and shows a `מתוך פרטי הלקוח` hint.
- **Auto-field card:** `service_lead` (default: current user),
  `entry_date` (today), `close_date`, `payment_status` (default `ממתין`),
  `is_billable` (default true), `work_start_date`, `warranty_end_date`
  with a 🔄 recompute button.
- **Kind-specific card:** for services, renders `service_types.fields`
  as a half/full grid with derived fields disabled + marked 🔄; for
  time_period, renders the time-bill form (period pickers, hourly_rate_used
  pre-filled from client with a divergence hint, unbilled-hours preview
  table, hours_total + net_invoice_amount computed).
- **Invoicing card:** `invoice_number_transaction`,
  `invoice_number_receipt`, `invoice_sent_date`, `payment_due_date` with
  🔄 recompute from `invoice_sent_date + client.payment_terms`,
  `payment_date`, `notes`.
- **Transactions list:** new `סוג` column between `לקוח` and the
  service-type column, plus a `סוג` filter (הכל / שירות / שעות).
  Service-type column shows `—` for `time_period` rows.

## Phase D — Canonical service_types seeds

Applied via the batch-3 migration (upsert on `name`):

| Name | display_order | fields |
|------|---:|:---|
| השמה | 1 | 10 (including derived commission_amount and warranty_end_date) |
| הד האנטינג | 2 | 6 (including derived warranty_end_date) |
| הדרכה | 3 | 6 |
| גיוס מסה | 4 | 4 (including derived total_fee) |

`src/lib/serviceTypes.ts::evalDerived()` is the small evaluator used by
the dialog. It supports numeric literals, `+ − × ÷`, parentheses, field
refs into the current row or the selected client, and date + integer
addition (used for warranty_end_date). Unknown tokens resolve to null,
which short-circuits the derivation.

## Phase E — time_period kind

- Schema: `hours_log.billed_transaction_id uuid references
  transactions(id)` added; `transactions.time_sheet_pdf_path text`
  added (alongside all the new time_period columns from Phase C).
- Storage: private bucket `time-sheets` created with admin +
  administration RLS.
- `TransactionDialog` time-period form loads unbilled hours for the
  selected client + period (and the editing transaction), shows them in
  a preview table with a checkbox per row (all checked by default),
  computes `hours_total` + `net_invoice_amount = hours_total *
  hourly_rate_used` reactively. Save marks the selected rows'
  `billed_transaction_id` to the new transaction id; edits clear
  billing on rows that were unchecked.
- `/transactions` gets a per-row `הפק דף שעות` icon action for
  `kind='time_period'` rows. It fetches the rows billed to that
  transaction, builds a branded A4 PDF via
  `src/lib/pdf.ts::buildTimeSheetPdf`, uploads to
  `time-sheets/<txn_id>.pdf`, writes `time_sheet_pdf_path`, and opens
  the signed URL in a new tab.
- `/hours/report` "צור עסקה מהדוח" now opens the new TransactionDialog
  with `kind='time_period'` pre-seeded instead of the retired
  `דיווח שעות` service_type.

## Phase F — Billing reports

- Schema: `billing_reports(id, client_id, period_start, period_end,
  issued_at, issued_by, transaction_ids uuid[], total_amount,
  pdf_storage_path, notes)` with RLS `admin + administration ALL`.
- Storage: private bucket `billing-reports` with admin + administration
  RLS.
- `/billing-reports` page (`RequireRole allow=['admin','administration']`):
  client autocomplete + period pickers (default: current month),
  candidate list loads on "הצג חיובים" (service rows in-period by
  close_date/entry_date; time_period rows in-period by period_end;
  `is_billable=true` required). Rows already included in an earlier
  billing_report for this client render grayed out + disabled
  (de-dup by `transaction_ids`).
- "הפק דוח חיוב" inserts a row, renders a branded PDF summary + one
  expanded hours page per `kind='time_period'` item
  (`src/lib/pdf.ts::buildBillingReportPdf`), uploads to
  `billing-reports/<report_id>.pdf`, writes `pdf_storage_path`, and
  opens the signed URL.
- Past reports list at the bottom with download buttons.
- Sidebar entry `דוחות חיוב` added between `יומן שעות` and `צוות`.

## Counts

- `service_types`: 4 (seeded exactly as spec — השמה / הד האנטינג /
  הדרכה / גיוס מסה).
- `transactions` split by kind at commit time: all historical rows
  `kind='service'` (default); time_period rows are created fresh by the
  new dialog / hours-report path.
- `billing_reports`: 0 so far; the list view is ready to populate.
- Dangling transactions after Phase A reassignment: **0**.

## Deferred

- **Live-verification sweep on bhr-console.vercel.app.** Code is built,
  pushed, and auto-deployed; the four phases are integration-tested
  locally via `npm run build`. A live Chrome sweep through the new
  dialog, time-sheet PDF, and billing-reports PDF requires a fresh
  magic-link session and is scheduled for the next working session —
  noted here rather than claimed as done.
- **Screenshots `./qa-screenshots/batch3/`.** Tied to the above live
  sweep; not captured this run.
- **Re-visit payment_due_date derivation with more payment-terms
  variants.** Current `parsePaymentTermDays` handles `שוטף+30`,
  `שוטף + 30`, and a bare `שוטף` (→ 0 days) but not multi-tier splits
  (`30/60` etc.). Sufficient for the current client set.

REFINEMENTS BATCH 3 COMPLETE
