# Refinements batch 3 — corrected billing model, admin-is-employee, transaction form redesign

Six focused refinements, based on Oren's review of batches 1–2 and the
reference CSV (`test-fixtures/transactions-reference.csv`). Execute in order.
Each phase ends with `npm run build` → commit → push → wait ~90s → live
verification in Chrome via the admin magic-link flow. Do not stop, do not ask,
do not summarize mid-run. Produce `REFINEMENTS_3_REPORT.md` when finished.

## Read first

1. `BHR_CONSOLE_PROJECT.md` (spec — source of truth).
2. `BHR_CONSOLE_CHECKLIST.md`.
3. `SECURITY_FIX_AND_ROLES.md`.
4. `IMPROVEMENTS_BATCH_2.md` — specifically Phase C (`service_types`),
   Phase D (transaction wizard), and Phase E (hours log). This batch
   supersedes parts of each.
5. `test-fixtures/transactions-reference.csv` — Oren's master Excel.
   Note: rows with `קטגוריה = מש"א במיקור חוץ` are NOT a service category; they
   are time-based billing that Oren tracked in the same sheet for lack of a
   better place. They map to `kind='time_period'` in the new model.
6. This file.

## Core model correction

A billable item (`transactions` row) now has a `kind`:

- `kind='service'` — a one-off service delivery (השמה, הד האנטינג, הדרכה,
  גיוס מסה). Requires `service_type_id`. Custom fields driven by
  `service_types.fields`. Billed per the client's `payment_terms`.
- `kind='time_period'` — a monthly (or custom-period) bill rolled up from
  `hours_log`. No `service_type_id`. Has its own columns
  (`period_start`, `period_end`, `hours_total`, `hourly_rate_used`). Billed
  at period end; due per the client's `payment_terms`.

Both appear in `/transactions`, both flow into the dashboard KPIs, both
participate in billing reports. The difference is only in how they're
created and what form the user sees.

`service_types` is ONLY for true services. Do not create a service_type for
דיווח שעות, מש"א במיקור חוץ, or anything time-based.

## Hard rules

- English only for reasoning and commit messages.
- No deferrals. Live-verify on the production URL.
- Never print or commit secrets.
- Update `BHR_CONSOLE_PROJECT.md` in the same commit as any spec-affecting change.

---

## Phase A — Purge non-service service_types; hours→bill uses `kind='time_period'`

**Problem:** Batch 2 seeded `דיווח שעות` as a service_type. Batch 3's earlier
draft also considered `מש"א במיקור חוץ`. Both are wrong; both must be absent
from `service_types`.

### Steps

1. Delete from `service_types` any row whose name is in
   `['דיווח שעות', 'מש"א במיקור חוץ']`.
2. For any `transactions` row whose deleted `service_type_id` now dangles:
   set `service_type_id = NULL` and `kind = 'time_period'`. Attempt to
   backfill `period_start/period_end/hours_total/hourly_rate_used` from any
   custom_fields or derivable columns. Log the rows affected in the run
   report for admin review.
3. After this phase, `service_types` contains only real services — Phase D
   seeds the canonical list: `השמה`, `הד האנטינג`, `הדרכה`, `גיוס מסה`.
4. Any nav item / filter / dropdown that exposed `דיווח שעות` as a service
   is removed.
5. `/hours/report` flow from batch 2 is rewritten in Phase E below.

Commit: `fix(services): purge non-service types from service_types (Phase A)`.

---

## Phase B — Admin is also an employee

(Unchanged from the prior draft.)

**Problem:** The role model treats `admin | administration | recruiter` as
mutually exclusive. Oren wears both admin and employee hats.

### Conceptual model

`role` continues to describe ACCESS, not identity:

- `admin` — full system access AND also has an employee identity.
- `administration` — employee; all clients, all transactions, own hours only.
- `recruiter` — employee; only own transactions, own hours only.

Every role participates in employee features: appearing on `/team`, having a
`bonus_model`, logging hours (on permitted clients), having a personal
productivity view.

### Implementation

1. **`/team` query:** show anyone in `('admin','administration','recruiter')`.
   Oren must appear as a card alongside every employee.
2. **Bonus model editor on `/team`:** works for all rows, including admins.
3. **`/hours` for admins:** tab / pill control — `ניהול שעות` (the existing
   admin tabbed-per-client view) and `השעות שלי` (personal, rows where
   `profile_id = auth.uid()`). Default to `ניהול שעות` for admin;
   non-admins see the personal view only.
4. **Dashboard (`/`):** admins see a three-pill toggle at the top:
   `דשבורד מנהל` (default — existing KPI dashboard), `דשבורד עובד`
   (personal bonus-progress view, scoped to own transactions), `דשבורד גבייה`
   (collections view over ALL transactions). Non-admins see no toggle —
   they see their single scoped dashboard.
5. **Profile (`/profile`):** already available for all roles.
6. **Time-log permissions:** when adding a permission on a client's edit
   dialog, the employee dropdown includes admins.

### Live checks

- As admin, `/team` includes Oren alongside every employee.
- Set a bonus_model on Oren's own card. Toggle dashboard to `דשבורד עובד` →
  bonus-progress widget renders.
- Toggle to `דשבורד גבייה` → collections view renders using all data.
- Enable time-log on a seeded client with Oren in its permissions → log
  09:00–10:30 on `/hours` → `השעות שלי` → entry visible.
- Seeded recruiter test user: no toggle on `/`, no admin editor on `/team`.

### Spec update

`BHR_CONSOLE_PROJECT.md` "User Roles": explicit that role controls access;
employee capabilities are universal.

Commit: `feat(roles): admin is also an employee (Phase B)`.

---

## Phase C — Transaction dialog redesign

**Problem:** Batch 2's 3-step wizard is the wrong order and too many clicks.
Oren wants: pick kind → pick client (autocomplete at the top) → fill the form.
All in one panel, wider.

### New layout

Single panel, `max-w-4xl` on desktop. RTL. Three visual blocks.

```
┌─ הוספת עסקה ──────────────────────────────────────────────┐
│                                                             │
│  סוג                                                        │
│  [השמה]  [הד האנטינג]  [הדרכה]  [גיוס מסה]  │  [דיווח שעות] │ ← pills; dynamic service types on the left,
│                                                             │   a separator, then the fixed `דיווח שעות`
│                                                             │   option (visually distinct — different tint
│                                                             │   and a 🕒 icon) representing kind=time_period
│  לקוח                                                       │
│  [חיפוש לקוח ...          ▼]                                │ ← autocomplete combobox
│                                                             │
│ ┌── שדות אוטומטיים (ניתן לערוך) ──────────────────────────┐ │
│ │  מוביל שירות [אורן בנני ▼]   תאריך פתיחה [22/04/2026]  │ │
│ │  סטטוס תשלום [ממתין ▼]       חיוב [לחיוב]              │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌── שדות ייחודיים ─────────────────────────────────────────┐│
│ │  [ rendered per the selected kind:                       ]│
│ │  [  - kind='service' → fields from service_type.fields   ]│
│ │  [  - kind='time_period' → period + hours picker         ]│
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌── חשבונית ותשלום ────────────────────────────────────────┐│
│ │  [ universal billing fields: invoice numbers, dates,     ]│
│ │    due date, payment date, notes                         ]│
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│                           [ביטול]                  [שמור]  │
└─────────────────────────────────────────────────────────────┘
```

### Client autocomplete

- `Command`-style combobox. As the user types, filter `clients` by
  `name.ilike('%term%')` or `company_id.ilike('%term%')`.
- Up to 10 results; each row shows `name` (large) and `company_id` (subtle).
- On selection, hydrate from the client's agreement terms:
  `commission_percent`, `warranty_days`, `payment_terms`, `payment_split`,
  `hourly_rate`, primary invoice contact. All editable; show a small
  "מתוך פרטי הלקוח" hint.

### Auto-fill rules (universal section, both kinds)

| Field              | Default                                        | Editable |
|--------------------|------------------------------------------------|:-------:|
| `service_lead`     | current user's full_name                       | ✅       |
| `entry_date`       | today                                          | ✅       |
| `billing_month/year` | `entry_date`                                 | derived |
| `closing_month/year` | `close_date`                                 | derived |
| `warranty_end_date` | `work_start_date + client.warranty_days`      | derived |
| `payment_due_date` | `invoice_sent_date + parsePaymentTerms(...)`   | derived |
| `payment_status`   | `ממתין`                                        | ✅       |
| `is_billable`      | true                                           | ✅       |

Derived fields recompute when sources change unless manually overridden; show
a 🔄 icon to re-derive on demand.

### Kind-specific forms

- **`kind='service'`:** the custom-fields block is a grid of fields from the
  selected `service_type.fields` (per batch 2, refined by Phase D below).
- **`kind='time_period'`:** the custom-fields block is a dedicated time-bill
  form (Phase E spec).

### Schema additions

```sql
alter table transactions
  add column if not exists kind text not null default 'service'
    check (kind in ('service','time_period')),
  add column if not exists invoice_number_transaction text,
  add column if not exists invoice_number_receipt text,
  add column if not exists work_start_date date,
  add column if not exists warranty_end_date date,
  add column if not exists invoice_sent_date date,
  add column if not exists payment_due_date date,

  -- time_period fields
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists hours_total numeric,
  add column if not exists hourly_rate_used numeric;

-- Backfill existing `invoice_number` → `invoice_number_transaction`
update transactions
  set invoice_number_transaction = invoice_number
  where invoice_number_transaction is null and invoice_number is not null;
```

### Transactions list update

- New column `סוג` (kind), rendered as a badge: purple `שירות` for service rows,
  amber `שעות` for time-period rows.
- A `סוג` filter at the top: `הכל / שירות / שעות`.
- Existing service-type name column stays for `kind='service'`; shows `—` for
  `kind='time_period'`.
- Billable toggle / invoice badge / actions all work for both kinds.

### Live checks

- Open "+ הוספת עסקה" → dialog is visibly wider; three sections visible at
  1440×900 without scrolling.
- Pills show the canonical service types and a visually-distinct `דיווח שעות`
  pill separated from them.
- Pick `השמה`, select a client from the combobox → commission % / warranty
  days / payment terms hydrate from that client's record.
- Save. Row appears in `/transactions` with purple `שירות` badge.
- Filter `סוג → שעות` → the new row is hidden.

Commit: `feat(transactions): single-panel dialog with service+time kinds (Phase C)`.

---

## Phase D — Canonical `service_types` seeds (services only)

`service_types` contains ONLY real services. Seeds:

### `השמה` (placement)

```json
[
  {"key":"position_number","label":"מספר משרה","type":"text","required":false,"width":"half"},
  {"key":"position_name","label":"שם משרה","type":"text","required":true,"width":"half"},
  {"key":"candidate_name","label":"מועמד","type":"text","required":true,"width":"half"},
  {"key":"salary","label":"שכר למשרה","type":"currency","required":true,"width":"half"},
  {"key":"commission_percent","label":"אחוז עמלה","type":"percent","required":true,"width":"half"},
  {"key":"commission_amount","label":"סכום עמלה","type":"currency","required":true,"width":"half","derived":"salary * commission_percent / 100"},
  {"key":"supplier_commission","label":"עמלה לספק","type":"currency","required":false,"width":"half"},
  {"key":"supplier_name","label":"שם ספק משנה","type":"text","required":false,"width":"half"},
  {"key":"work_start_date","label":"תאריך תחילת עבודה","type":"date","required":false,"width":"half"},
  {"key":"warranty_end_date","label":"תאריך תום אחריות","type":"date","required":false,"width":"half","derived":"work_start_date + client.warranty_days"}
]
```

### `הד האנטינג` (head-hunting)

```json
[
  {"key":"position_name","label":"שם משרה","type":"text","required":true,"width":"half"},
  {"key":"candidate_name","label":"מועמד","type":"text","required":true,"width":"half"},
  {"key":"retainer_amount","label":"מקדמה","type":"currency","required":false,"width":"half"},
  {"key":"success_fee","label":"דמי הצלחה","type":"currency","required":true,"width":"half"},
  {"key":"work_start_date","label":"תאריך תחילת עבודה","type":"date","required":false,"width":"half"},
  {"key":"warranty_end_date","label":"תאריך תום אחריות","type":"date","required":false,"width":"half","derived":"work_start_date + client.warranty_days"}
]
```

### `הדרכה` (training)

```json
[
  {"key":"workshop_name","label":"שם ההדרכה","type":"text","required":true,"width":"full"},
  {"key":"training_date","label":"תאריך ביצוע","type":"date","required":true,"width":"half"},
  {"key":"duration_hours","label":"משך (שעות)","type":"number","required":true,"width":"half"},
  {"key":"trainer","label":"מדריך/ה","type":"text","required":false,"width":"half"},
  {"key":"participants","label":"מספר משתתפים","type":"number","required":false,"width":"half"},
  {"key":"price","label":"מחיר","type":"currency","required":true,"width":"half"}
]
```

### `גיוס מסה` (mass recruiting)

```json
[
  {"key":"campaign_name","label":"שם הקמפיין","type":"text","required":true,"width":"full"},
  {"key":"candidate_count","label":"כמות מועמדים","type":"number","required":true,"width":"half"},
  {"key":"fee_per_candidate","label":"מחיר למועמד","type":"currency","required":true,"width":"half"},
  {"key":"total_fee","label":"סכום כולל","type":"currency","required":true,"width":"half","derived":"candidate_count * fee_per_candidate"}
]
```

### Derived-field evaluator

Small `evalDerived(expr, row, client)` supporting field refs
(`salary`, `client.hourly_rate`, `client.warranty_days`, etc.), `+ − × ÷`,
parentheses, and date + integer addition. Prefer `mathjs` (already available
per artifacts docs) over a DIY parser.

### Live checks

- `/services` shows exactly four rows seeded from this phase (plus any
  additional ones Oren has added since). No `דיווח שעות`, no `מש"א...` entries.
- Create a השמה with salary 10000, commission 100 → commission_amount = 10000.
  Change commission to 90 → commission_amount = 9000.
- Create a הדרכה with duration_hours 3, price 3000 → saves cleanly; no
  derivations.
- Create a גיוס מסה with 10 candidates × ₪1500 → total_fee = 15000 derived.

Commit: `feat(services): canonical seeds for השמה/הד האנטינג/הדרכה/גיוס מסה (Phase D)`.

---

## Phase E — Time-period billing (`kind='time_period'`)

Time billing is a first-class transaction kind, not a service type. It's
created from logged hours.

### Entry points

1. **From `/transactions`** — "+ הוספת עסקה" → pick `דיווח שעות` pill →
   time-bill form (see below).
2. **From `/hours`** — the existing "הפק דוח שעות" button on the admin
   tabbed view creates a time-period transaction for the current client/period,
   pre-filling the form with the hours rolled up.

### Time-bill form (shown in the custom-fields block when pill is `דיווח שעות`)

- `client` — the already-selected client from the dialog's client autocomplete.
- `period_start`, `period_end` — date range. Default: this month's
  `[first day, last day]`. Month/year quick-picker also supported.
- `hourly_rate_used` — number, ₪/שעה. Default: the client's `hourly_rate`
  field (editable; show a hint that changing it diverges from the client
  record).
- Under those controls, a **hours preview table** — the `hours_log` rows for
  this client within the period, where `billed_transaction_id IS NULL` (i.e.,
  not yet billed). Columns: date, start→end, hours, employee, description,
  checkbox (all checked by default). The admin may uncheck rows to exclude
  from this bill.
- `hours_total` — auto-sum of checked rows. Read-only; recomputes as rows
  are toggled.
- `net_invoice_amount` — `hours_total * hourly_rate_used` (derived).

### On save

- Insert a `transactions` row with `kind='time_period'`, `service_type_id=null`,
  the period fields, and the universal invoice/payment fields (blank
  initially — filled in when the admin issues the invoice later).
- **Mark the included `hours_log` rows** with `billed_transaction_id = <new
  transaction id>` so they won't appear in the next month's preview.
- Trigger `queryClient.invalidateQueries(['transactions','hours_log'])`.

### Schema

```sql
alter table hours_log
  add column if not exists billed_transaction_id uuid references transactions(id);

-- RLS stays as-is; billed_transaction_id is just metadata.
```

### Time-sheet PDF

On any `kind='time_period'` transaction row in `/transactions` (or on edit),
offer a button `הפק דף שעות`. It generates a branded A4 PDF:

- Header: BHR logo placeholder + client name + period + total hours + total
  amount + issue date.
- Body: one row per `hours_log` entry included in this bill, grouped by date,
  columns `תאריך | משעה | עד שעה | שעות | עובד | תיאור`.
- Footer: BHR contact info and bank details.
- Download + (optionally) email to the client's primary invoice contact.

Store the PDF in Supabase Storage at
`time-sheets/<transaction_id>.pdf` and add `transactions.time_sheet_pdf_path`
(nullable).

### Live checks

- Seed a time-enabled client with `hourly_rate=400` and two permitted
  employees. Log five entries totaling 24.5 hours across January 2026.
- "+ הוספת עסקה" → pill `דיווח שעות` → pick that client → period defaults
  to current month; change to January 2026 → preview shows the five rows
  with a 24.5 total; `hourly_rate_used` pre-fills to 400; amount auto-fills
  to 9,800.
- Save. `/transactions` shows a row with amber `שעות` badge, amount ₪9,800.
- Re-open "+ הוספת עסקה" → `דיווח שעות` → same client, January 2026 →
  preview is empty (rows are billed).
- On the new transaction, click "הפק דף שעות" → PDF downloads with the five
  entries listed.

Commit: `feat(transactions): time_period kind with hours-log rollup and time-sheet PDF (Phase E)`.

---

## Phase F — Billing reports (aggregation across kinds)

A billing report consolidates multiple billables for a client over a period
into a single document the admin sends to the client.

### Schema

```sql
create table if not exists billing_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  period_start date not null,
  period_end date not null,
  issued_at timestamptz not null default now(),
  issued_by uuid references profiles(id),
  transaction_ids uuid[] not null default '{}',
  total_amount numeric not null default 0,
  pdf_storage_path text,
  notes text
);

alter table billing_reports enable row level security;

-- admin + administration can read/write; recruiter no access
create policy "billing_reports_admin_admin_full" on billing_reports
  for all to authenticated
  using ((select role from profiles where id = auth.uid()) in ('admin','administration'))
  with check ((select role from profiles where id = auth.uid()) in ('admin','administration'));
```

### Page `/billing-reports`

New sidebar item `דוחות חיוב` between `יומן שעות` and `צוות`, visible to
`admin` and `administration` only (guard with `RequireRole allow=
['admin','administration']`).

Layout:

- Top: filter strip — client combobox (autocomplete), period from/to dates
  (default: current month), "הצג חיובים" button.
- On "הצג חיובים": show every `transactions` row for that client where:
  - `kind='service'` and `close_date` (or `entry_date` if close_date is null)
    falls in the period, OR
  - `kind='time_period'` and `period_end` falls in the period,
  - AND `is_billable = true`,
  - AND not already part of a later `billing_reports` row for this client
    (de-dup by `transaction_ids` arrays).
- Each row: checkbox (all checked by default), kind badge, item description
  (service name + position/candidate, or "דוח שעות" + date range),
  close/period date, amount.
- Footer: total of checked items, `הפק דוח חיוב` button.

On submit:

1. Insert a `billing_reports` row with the selected `transaction_ids` and
   sum.
2. Generate a branded PDF: header (logo, client, period, report issue date,
   total), table of billable items, per-item sub-section for
   `kind='time_period'` items that embeds the detailed hours table, footer
   with bank + contact details. Save to
   `billing-reports/<report_id>.pdf` in Storage; set `pdf_storage_path`.
3. Show the report summary + download link.

A list view at the bottom of `/billing-reports` shows past reports (most
recent first) with client, period, total, and a download button.

### Live checks

- Seed a client with one השמה transaction (₪10,000, closed in April 2026) and
  one `kind='time_period'` transaction (₪9,800, period April 2026).
- As admin, `/billing-reports` → pick that client + April 2026 → "הצג חיובים"
  → both items listed, total ₪19,800.
- Leave both checked, "הפק דוח חיוב" → PDF downloads; `billing_reports` row
  created; list view shows the new report.
- Open that client in `/billing-reports` for April 2026 again → both items
  are now grayed out / marked "כלול בדוח 1" so they can't be double-billed.
- As an administration user (seeded test), can issue billing reports.
- As a recruiter (seeded test), `/billing-reports` is forbidden (redirects).

Commit: `feat: billing reports across kinds (Phase F)`.

---

## Checklist extensions

Extend `BHR_CONSOLE_CHECKLIST.md`:

- §24 service_types purge (no דיווח שעות, no מש"א במיקור חוץ).
- §25 admin-as-employee (team card, bonus on self, personal hours tab,
  dashboard toggle).
- §26 transactions dialog redesign (single panel, pills with distinct
  דיווח שעות, client autocomplete, wider, auto-fills, derived fields).
- §27 canonical service seeds (השמה/הד האנטינג/הדרכה/גיוס מסה).
- §28 time_period kind (entry via pill, hours preview, rollup, time-sheet PDF,
  re-preview empty).
- §29 billing reports (list, issue, PDF, de-dup, RLS).

Each a pass/fail live check.

## Termination

1. Update `BHR_CONSOLE_PROJECT.md` reflecting:
   - `transactions.kind` + all new columns + RLS deltas.
   - service_types scope (services only) and canonical seeds.
   - time_period billing flow.
   - billing_reports table, page, and PDF.
   - derived-field evaluator in service_types field configs.
   - admin-is-employee semantics.
2. Write `REFINEMENTS_3_REPORT.md`:
   - Per-phase commit SHAs.
   - Counts: service_type rows (expected 4), transactions split by kind,
     billing reports issued during verification.
   - Screenshots saved to `./qa-screenshots/batch3/`: new transactions dialog
     (both kinds), `/team` with Oren's card, dashboard role toggle,
     `/billing-reports` with a generated report, a time-sheet PDF, a
     billing-report PDF.
   - Any dangling transactions found in Phase A step 2 that need admin review.
3. Print `REFINEMENTS BATCH 3 COMPLETE` and stop.
