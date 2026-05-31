# BHR Console — Codebase Map (Claude Code)

> This file is the authoritative reference for Claude Code. Read it at the start of every session.
> Root `CLAUDE.md` (one level up) defines the Cowork planning role and working method.

---

## Project

Internal financial and operational management system for **Banani HR**.  
Used daily by Oren (CEO) and the recruitment team.

**Live URL:** `bhr-console-banani-orens-projects.vercel.app`  
**Repo:** `banani-oren/bhr-console` → Vercel auto-deploys on push to `main`  
**Supabase:** project ID `szunbwkmldepkwpxojma`, Frankfurt region

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 8 + TypeScript 6 |
| Styling | TailwindCSS v4 + shadcn/ui (`components.json`) |
| Server state | @tanstack/react-query v5 |
| Routing | react-router-dom v6 |
| Backend/DB | Supabase (auth, Postgres + RLS, storage, edge functions) |
| Charts | Recharts |
| PDF export | jsPDF + jspdf-autotable |
| Excel export | xlsx |
| Email | Resend (via Supabase edge functions) |
| PWA | vite-plugin-pwa (auto-update, offline caching) |
| CI/CD | Vercel — auto-deploy on push to `main` |

---

## Critical Constraints — Never Break These

- **Hebrew RTL everywhere** — every component, dialog, table, form is `dir="rtl"`. Sidebar on the **right**.
- **Currency: ₪ ILS** — display with `₪` prefix. No floating-point arithmetic. Use Postgres `numeric`.
- **Israeli locale** — dates display as `dd/MM/yyyy`, timezone `Asia/Jerusalem`.
- **Roles**: `admin` | `administration` | `recruiter` — see route guards in `App.tsx`.
- **Build must pass** — `npm run build` before every commit. TypeScript errors = blocked.
- **No new dependencies** without explicit approval. Stack is fixed.
- **Live data** — never modify real records during testing. Only `[TEST-...]` tagged records.

### ⚠️ NO REGRESSION RULE — Enforced on Every Task

**Never remove, rename, or reorder any existing UI element, column, field, button, or component unless Oren explicitly asks for it.**

Before committing any edit to a page or component file:
1. List every column / field / section that existed before your edit
2. Confirm every one of them still exists in your output
3. If any is missing — put it back before continuing

This rule applies to all files. There are no exceptions.

---

## Canonical Column Orders (never change without explicit instruction)

### Transactions.tsx — table columns (in order)

| # | Header | Source |
|---|---|---|
| 1 | לקוח | `t.client_name` |
| 2 | שירות | `t.service_type` |
| 3 | משרה / מועמד | `t.position_name` + `t.candidate_name` |
| 4 | שכר | `t.salary` |
| 5 | % עמלה | `t.commission_percent` |
| 6 | מוביל | `t.service_lead` |
| 7 | תאריך סגירה | `t.close_date` |
| 8 | תחילת עבודה | `t.work_start_date` |
| 9 | סכום נטו | `t.net_invoice_amount` |
| 10 | חיובים | billing event status dots |
| 11 | אישור | approval button |
| 12 | פעולות | edit / delete buttons |

---

## File Map

```
App Dev/
├── src/
│   ├── main.tsx                        # Entry — mounts App into #root
│   ├── App.tsx                         # Router + QueryClientProvider + AuthProvider + all routes
│   ├── index.css                       # Global styles, TailwindCSS v4 tokens, CSS variables
│   │
│   ├── lib/
│   │   ├── supabase.ts                 # Supabase client singleton (VITE_SUPABASE_URL + ANON_KEY)
│   │   ├── types.ts                    # All shared TypeScript types
│   │   ├── auth.tsx                    # AuthProvider + useAuth hook (user, profile, loading, recoveryMode)
│   │   ├── utils.ts                    # cn() helper (clsx + tailwind-merge)
│   │   ├── clients.ts                  # Client CRUD: getClients, getClientById, upsertClient, deleteClient
│   │   ├── bonus.ts                    # Bonus calculation logic
│   │   ├── billingEvents.ts            # Billing event helpers — generation, status, שוטף+X calculation
│   │   ├── attendance.ts               # Attendance helpers — Israel-tz today/time, status, pair-matching hours
│   │   ├── dates.ts                    # Date/timezone utilities — Israeli locale helpers
│   │   ├── pdf.ts                      # PDF export helpers (jsPDF)
│   │   ├── serviceTypes.ts             # ServiceType/ServiceField types + evalDerived() formula evaluator
│   │   └── offlineQueue.ts             # idb-keyval offline mutation queue
│   │
│   ├── hooks/
│   │   ├── useSupabaseQuery.ts         # Generic hooks: useTable, useInsert, useUpdate, useDelete
│   │   └── useSafeMutation.ts          # Mutation wrapper with offline queue support
│   │
│   ├── components/
│   │   ├── ui/                         # shadcn/ui primitives — regenerate via CLI, do not edit directly
│   │   ├── Layout.tsx                  # Desktop shell: RTL sidebar (right) + main content
│   │   ├── RequireRole.tsx             # Route guard — checks profile.role
│   │   ├── TransactionDialog.tsx       # Add/edit transaction (dynamic fields from ServiceType)
│   │   ├── AgreementUploader.tsx       # PDF upload + extract-agreement edge function
│   │   ├── BonusWidget.tsx             # Bonus calculator widget
│   │   ├── ClientPicker.tsx            # Autocomplete client selector
│   │   ├── SortableHead.tsx            # Shared sortable <TableHead> + SortState/toggleSortKey/compareBySort (Repair 8)
│   │   ├── LabeledToggle.tsx           # Labeled switch/toggle
│   │   ├── MobileAutoRoute.tsx         # Auto-redirects mobile browsers to /m/hours
│   │   ├── ProfileEditor.tsx           # Inline profile edit form
│   │   └── UserEditDialog.tsx          # Admin dialog: edit user profiles + roles
│   │
│   ├── pages/
│   │   ├── Login.tsx                   # Login form (email + password)
│   │   ├── SetPassword.tsx             # Password reset / first-login flow
│   │   ├── Dashboard.tsx               # Role-aware: loads correct dashboard per role
│   │   ├── Clients.tsx                 # Client list + ClientDialog (create/edit)
│   │   ├── Transactions.tsx            # Transaction table: filters, inline edit, export
│   │   ├── Attendance.tsx              # Check-in/out + daily attendance report (report = admin/administration)
│   │   ├── BillingReports.tsx          # Monthly billing summary reports
│   │   ├── Bonuses.tsx                 # Bonus calculations per team member
│   │   ├── Team.tsx                    # Team member management
│   │   ├── Services.tsx                # Dynamic service type builder (admin only)
│   │   ├── Suppliers.tsx               # Supplier management
│   │   ├── Users.tsx                   # User management (admin only)
│   │   ├── Profile.tsx                 # Current user's own profile
│   │   │
│   │   ├── dashboards/
│   │   │   ├── AdminDashboard.tsx
│   │   │   ├── AdministrationDashboard.tsx
│   │   │   └── RecruiterDashboard.tsx
│   │   │
│   │   ├── hours/
│   │   │   ├── HoursPage.tsx           # Thin header + renders unified MyHoursView (no tabs — Repair 7)
│   │   │   ├── MyHoursView.tsx         # Unified hours view. Role-aware: admin+administration see ALL employees' hours (עובד/ת filter via list_profiles_for_attendance RPC); recruiters see only their own. Admin-only הפק חיוב שעות billing + billed-row locking. (Repair 7)
│   │   │   ├── HoursEntryDialog.tsx    # Add/edit single hours entry — editable auto-calc hours field; client locked to read-only when preset from filter
│   │   │   ├── HoursReportDialog.tsx   # Hours report — browser-native print to styled RTL HTML (no jsPDF); + צור עסקה מהדוח
│   │   │   └── common.ts              # Shared types + utilities for hours module
│   │   │
│   │   └── mobile/
│   │       ├── MobileShell.tsx         # /m/* layout (no sidebar)
│   │       ├── MobileHours.tsx         # Mobile hours entry
│   │       ├── MobileAttendance.tsx    # Mobile check-in/out (no report)
│   │       └── MobileProfile.tsx       # Mobile profile view
│   │
│   └── assets/
│       └── hero.png
│
├── supabase/
│   ├── functions/
│   │   ├── delete-user/index.ts        # Edge function: delete auth user (admin only)
│   │   └── extract-agreement/          # Edge function: extract agreement fields from PDF via Claude
│   │       ├── index.ts
│   │       └── prompt.md               # Versioned system prompt for extraction
│   └── migrations/                     # Applied in order — true live schema state
│       ├── 20260418_1_rls_no_recursion.sql
│       ├── 20260418_2_improvements_batch2.sql    # service_types, client_time_log_permissions, hourly_rate
│       ├── 20260418_roles_and_rls.sql             # three-role model (admin/recruiter/administration)
│       ├── 20260422_refinements_batch3.sql        # transaction.kind, billing_reports
│       ├── 20260422_2_flexible_billing_reports.sql
│       ├── 20260426_suppliers.sql                 # suppliers table + transaction supplier fields
│       ├── 20260509_phase1_clients.sql            # Phase 1: client financial fields (payment_split_json, advance_*, payment_terms, etc.)
│       ├── 20260509_phase2_transactions.sql       # Phase 2: billing_events table, transaction approval fields
│       ├── 20260512_billing_events_paid_status.sql  # Repair 2: 'paid' status added to billing_events CHECK constraint
│       ├── 20260530_attendance_log.sql              # Feature: attendance_log table, work_date trigger, RLS, list_profiles_for_attendance()
│       └── 20260531_hours_administration_read.sql   # Repair 7: additive SELECT RLS so administration reads all hours_log rows
│
├── scripts/
│   ├── import-agreements.mjs           # One-off: import agreement terms from Excel into clients
│   ├── repair-billing-events.mjs       # One-off: generate billing events for pre-Phase-2 transactions
│   └── generate-icons.mjs              # PWA icon generation
│
├── public/                             # Static assets + PWA icons
├── EMPLOYEE_MOBILE_INSTALL_GUIDE.md    # iPhone PWA install guide for team (Hebrew)
├── supabase-schema.sql                 # Bootstrap schema only — migrations are the live state
├── PHASE3_SUMMARY.md                   # Phase 3 design spec: bonus engine, dashboards, auth, PDF
├── PHASE3_PROMPT.md                    # Phase 3 Claude Code execution prompt
├── REPAIR_PROMPT.md                    # Repair 1: 5-bug fix (dates, UUID, billing events, hours, close_date)
├── REPAIR2_PROMPT.md                   # Repair 2: שוטף+X payment terms + two-document billing events
├── vite.config.ts
├── components.json                     # shadcn/ui config
├── vercel.json                         # SPA rewrite rules
├── package.json
└── .env.local                          # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (never commit)
```

---

## Routes

| Route | Page | Roles |
|---|---|---|
| `/` | Dashboard | admin, administration, recruiter |
| `/clients` | Clients | admin, administration |
| `/transactions` | Transactions | admin, administration, recruiter |
| `/hours` | Hours | admin, administration, recruiter |
| `/attendance` | Attendance (check-in/out + report) | admin, administration, recruiter (report section: admin, administration only) |
| `/billing-reports` | Billing Reports | admin, administration |
| `/bonuses` | Bonuses | admin |
| `/team` | Team | admin |
| `/services` | Services | admin |
| `/suppliers` | Suppliers | admin |
| `/users` | Users | admin |
| `/profile` | Profile | all |
| `/login` | Login | public |
| `/set-password` | Set Password | public |
| `/m/hours` | Mobile Hours | all authenticated |
| `/m/attendance` | Mobile Attendance (check-in/out) | all authenticated |
| `/m/profile` | Mobile Profile | all authenticated |

---

## Database Schema (live — all migrations applied as of May 2026)

```
profiles
  id uuid PK → auth.users
  full_name text
  email text
  role text CHECK IN ('admin', 'recruiter', 'administration')
  bonus_model jsonb
  hours_category_enabled bool DEFAULT false
  password_set bool DEFAULT false
  phone text
  status text DEFAULT 'active'
  created_at timestamptz

clients
  id uuid PK
  name text NOT NULL
  company_id text
  tax_id text
  group_name text
  address text
  contact_name text
  phone text
  email text
  status text DEFAULT 'active'
  notes text
  -- Financial fields (added Phase 1 — 20260509_phase1_clients.sql)
  commission_percent numeric
  warranty_days int
  payment_terms text               -- stored as "שוטף+X" format (e.g. "שוטף+30")
  payment_split_json jsonb         -- array of {percent, days} — drives billing event splits
  advance_type text CHECK IN ('fixed', 'percent')
  advance_amount numeric
  hourly_rate numeric
  time_log_enabled bool DEFAULT false
  created_at timestamptz

agreements
  ⚠️ DEPRECATED — DO NOT WRITE. Table exists for legacy data only.

transactions
  id uuid PK
  kind text CHECK IN ('service', 'time_period')
  client_id uuid → clients
  client_name text NOT NULL
  position_name text
  candidate_name text
  service_type text
  service_type_id uuid → service_types
  custom_fields jsonb DEFAULT '{}'
  salary numeric
  commission_percent numeric
  net_invoice_amount numeric
  commission_amount numeric
  service_lead text
  entry_date date
  billing_month int
  billing_year int
  close_date date                  -- added back (Repair 1) after Phase 2 removal
  closing_month int
  closing_year int
  payment_date date
  payment_status text
  is_billable bool
  invoice_number text              -- legacy field, do not use for new logic
  invoice_number_transaction text  -- legacy
  invoice_number_receipt text      -- legacy
  work_start_date date
  warranty_end_date date
  invoice_sent_date date
  payment_due_date date
  period_start date
  period_end date
  hours_total numeric
  hourly_rate_used numeric
  time_sheet_pdf_path text
  notes text
  supplier_id uuid → suppliers
  supplier_percent numeric
  billing_percent numeric          -- % of total commission billed in this invoice (e.g. 30 = 30% advance, 70 = 70% balance)
  work_end_date date
  -- Approval fields (added Phase 2 — 20260509_phase2_transactions.sql)
  created_by uuid → profiles
  approved_by uuid → profiles
  approved_at timestamptz
  needs_approval bool DEFAULT false
  created_at timestamptz

billing_events                     -- Source of truth for all money events (added Phase 2)
  id uuid PK
  transaction_id uuid → transactions NOT NULL
  event_index int NOT NULL         -- 1-based, order within transaction
  amount numeric NOT NULL          -- gross amount minus advance
  description text                 -- auto-generated label
  billing_date date                -- חשבון עסקה issue date (system-calculated at creation)
  status text CHECK IN ('pending', 'to_bill', 'billed', 'paid', 'cancelled')
  invoice_number text              -- חשבון עסקה number (entered manually)
  payment_date date                -- חשבונית מס קבלה due date (calculated or manual override)
  receipt_number text              -- חשבונית מס קבלה number (entered manually → triggers paid)
  advance_applied numeric DEFAULT 0
  supplier_amount numeric DEFAULT 0
  created_at timestamptz
  updated_at timestamptz

attendance_log                     -- Employee check-in/out log (Feature: Attendance)
  id uuid PK
  profile_id uuid → profiles NOT NULL (ON DELETE CASCADE)
  action text CHECK IN ('check_in', 'check_out')
  logged_at timestamptz DEFAULT now()
  work_date date NOT NULL           -- derived from logged_at AT TIME ZONE 'Asia/Jerusalem' by BEFORE trigger
  notes text
  created_at timestamptz
  -- RLS: insert own (profile_id = auth.uid()); select own OR admin/administration (current_user_role());
  --      update/delete admin only. Report names come from SECURITY DEFINER public.list_profiles_for_attendance().

team_members
  id uuid PK
  name text
  role text
  email text
  status text
  bonus_model jsonb
  hours_category_enabled bool
  portal_token text

hours_log
  id uuid PK
  team_member_id uuid → team_members
  profile_id uuid → profiles
  client_name text
  client_id uuid → clients
  visit_date date
  hours numeric
  description text
  hours_category text
  start_time time
  end_time time
  billed_transaction_id uuid → transactions
  month int
  year int
  created_at timestamptz

service_types
  id uuid PK
  name text NOT NULL
  display_order int
  fields jsonb                     -- array of ServiceField — drives dynamic fields in TransactionDialog

client_time_log_permissions
  client_id uuid → clients
  profile_id uuid → profiles

suppliers
  id uuid PK
  first_name text
  last_name text
  email text
  mobile text
  created_at timestamptz

billing_reports
  id uuid PK
  client_id uuid → clients
  period_start date
  period_end date
  issued_at timestamptz
  issued_by uuid → profiles
  transaction_ids uuid[]
  total_amount numeric
  pdf_storage_path text
  notes text
  filter_client_id uuid
  filter_period_start date
  filter_period_end date
  filter_payment_status text
  filter_include_service bool
  filter_include_time_period bool
```

---

## Billing Events — Business Logic

### Two-document flow

Each `billing_event` row represents money to be collected and goes through two documents:

**Document 1 — חשבון עסקה** (Proforma / Transaction Invoice)
- `billing_date` — system-calculated at transaction creation (work_start_date + split.days)
- `invoice_number` — entered manually when the proforma is sent to client
- Entering `invoice_number` → status becomes `billed`

**Document 2 — חשבונית מס קבלה** (Tax Invoice + Receipt — confirms payment received)
- `payment_date` — auto-calculated = `end_of_month(billing_date) + payment_term_days`, can be manually overridden
- `receipt_number` — entered manually when payment arrives
- Entering `receipt_number` → status becomes `paid`
- **Payment is only confirmed when `receipt_number` is set.**

### שוטף+X calculation

`payment_terms` on the client is stored as `"שוטף+X"` (e.g. `"שוטף+30"`).

Calculation:
1. Take the `billing_date` of the חשבון עסקה
2. Advance to the **last day of that calendar month** ("שוטף")
3. Add X additional days

**Example:** billing_date = 11 May 2026, terms = שוטף+30 → 31 May + 30 = **30 June 2026**

Key functions in `src/lib/billingEvents.ts`:
- `parsePaymentTermDays(terms)` → extracts the integer X from "שוטף+X"
- `calculateTaxInvoiceDate(invoiceDate, days)` → applies the שוטף+X formula

### Status flow

```
pending → to_bill → billed → paid
                  ↘ cancelled
```
- `pending`: created, billing_date in future (or transaction not approved)
- `to_bill`: billing_date ≤ today AND transaction is approved (automatic)
- `billed`: `invoice_number` has been entered
- `paid`: `receipt_number` has been entered
- `cancelled`: manual, or triggered by `work_end_date` being set

### Generation

**Service transactions** — events generated by `generateServiceBillingEvents()`:
- Uses `client.payment_split_json` to split commission across multiple events
- First event deducts `advance_applied` from amount
- `billing_date` = `work_start_date` + `split.days`

**Time-period transactions** — single event generated by `generateTimePeriodBillingEvent()`:
- `amount` = `hours_total × hourly_rate_used`
- `billing_date` = today (the date the billing is generated)
- Tax invoice date calculated on-the-fly from payment_terms

### Approval gate
- Transactions with `needs_approval = true` and no `approved_at` are greyed out (opacity-50)
- Billing events for unapproved transactions stay `pending` regardless of billing_date
- Approved = `approved_at IS NOT NULL`

---

## MIRRORED_KEYS Pattern (TransactionDialog → DB)

These fields exist both in `custom_fields` jsonb AND as top-level DB columns. They are mirrored on save:

```
position_name, candidate_name, commission_percent, salary,
net_invoice_amount, commission_amount, service_lead
```

`billing_percent` is a **top-level column only** (not in custom_fields). It is auto-derived in the UI:
- `autoInvoiceAmount = salary × (commission_percent / 100) × (billing_percent / 100)`
- When billing_percent changes, `net_invoice_amount` and `commission_amount` in `custom_fields` are auto-updated via useEffect

`SECTION2_MANAGED_KEYS` — these date fields are rendered in their own Section 2 block and must be **skipped** in `renderField()` to avoid duplication:
```
close_date, work_start_date, work_end_date, warranty_end_date
```

---

## Key Patterns

### Auth
```tsx
const { user, profile, loading, signOut, refreshProfile } = useAuth()
// profile.role: 'admin' | 'administration' | 'recruiter'
```

### Data Fetching
```tsx
const { data, isLoading, error } = useTable<Transaction>('transactions', { orderBy: 'entry_date' })
```

### Mutation (with offline support)
```tsx
const mutation = useSafeMutation({
  mutationFn: async (payload) => {
    const { error } = await supabase.from('hours_log').insert(payload)
    if (error) throw error
  },
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hours_log'] }),
})
```

### shadcn Dialog (always dir="rtl")
```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent dir="rtl" className="max-w-lg">
    <DialogHeader><DialogTitle>כותרת</DialogTitle></DialogHeader>
  </DialogContent>
</Dialog>
```

### Role Guard
```tsx
const { profile } = useAuth()
if (profile?.role !== 'admin') return null
```

### Money Display
```tsx
const fmt = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
fmt.format(amount) // → "‏₪1,234"
```

### Date Display
```tsx
import { format } from 'date-fns'
import { he } from 'date-fns/locale'
format(new Date(dateStr), 'dd/MM/yyyy', { locale: he })
```

---

## Infrastructure Access — Non-Negotiable

Claude Code has direct API/CLI access to **Git, Vercel, Supabase, and Resend**.  
**Oren never runs any manual steps. Ever.** All infrastructure is handled autonomously.

- SQL migrations: `supabase db push` or Supabase Management API — never "paste in the SQL editor"
- Deploys: `git push` triggers Vercel; confirm via Vercel CLI or API
- Oren is never asked to perform any terminal, dashboard, or browser action

---

## Every Phase Ends with Full QA by Claude Code

Claude Code runs QA — not Oren. QA must be executed (not just listed) before declaring a phase done.

QA must cover:
- DB: query Supabase to confirm new columns, FK links, data integrity
- Live URL: confirm Vercel deploy is up and the app loads
- Functional flows: walk every changed user flow using browser/API tools
- RTL rendering on all changed dialogs/forms
- Empty states, error states, loading states
- Mobile width (375px) on any changed UI
- **Regression check**: confirm all columns/fields listed in "Canonical Column Orders" are still present

Print `QA COMPLETE ✓` with evidence, then `PHASE N COMPLETE ✓`.

---

## Completion Checklist (mandatory for every task)

1. `npm run build` — zero errors, zero new warnings
2. `npx tsc --noEmit` — clean
3. Apply DB migration via `supabase db push` or Management API — query DB to confirm
4. Commit — atomic, clear message (what changed + why)
5. `git push` to GitHub — triggers Vercel auto-deploy
6. Confirm deploy via Vercel CLI or API — verify live URL responds
7. **Regression check** — count columns in Transactions.tsx table, confirm all 12 present
8. Run full QA (see above) — print `QA COMPLETE ✓`
9. Print `PHASE N COMPLETE ✓`

---

## Architectural Decisions (already made — don't revisit without reason)

- **No Redux / Zustand** — @tanstack/react-query handles all server state; local UI state is `useState`
- **No CSS modules** — TailwindCSS utility classes only, with `cn()` for conditionals
- **shadcn/ui, not custom UI** — add via `npx shadcn@latest add <component>`
- **`agreements` table is deprecated** — do not write to it. Legacy data only.
- **Transaction kinds** — `service` (placements, HR work) and `time_period` (hourly billing). Fields are dynamic via `service_types` + `custom_fields` jsonb.
- **Mobile is hours-only** — `/m/*` scoped to hours entry + profile. No admin surfaces.
- **PWA** — standalone app, workbox NetworkFirst for Supabase API calls
- **Bonus model** — JSONB in `team_members` for flexibility
- **Billing events are the financial source of truth** — dashboards and bonus calculations should read from `billing_events`, not `transactions` legacy fields (Phase 3 migration pending)
- **Payment terms stored as "שוטף+X"** — parse with `parsePaymentTermDays()`, never assume raw integer

---

## Phase History

| Phase | Migration(s) | Status | Key Changes |
|---|---|---|---|
| Baseline | 20260418–20260426 | ✅ Live | Roles, RLS, service_types, suppliers, billing_reports |
| Phase 1 | 20260509_phase1_clients.sql | ✅ Live | Client financial fields: payment_split_json, advance_*, payment_terms, commission_percent, warranty_days |
| Phase 2 | 20260509_phase2_transactions.sql | ✅ Live | billing_events table, transaction approval workflow (needs_approval, approved_by, approved_at) |
| Repair 1 | (no migration) | ✅ Live | 5 bug fixes: duplicate dates, UUID in service type, billing events generation, hours×rate, close_date column |
| Repair 2 | 20260512_billing_events_paid_status.sql | ✅ Live | שוטף+X payment terms field, two-document billing event UI (חשבון עסקה + חשבונית מס קבלה), paid status |
| Phase 3 | (no new migration) | ✅ Live | Bonus engine on billing_events, dashboards rebuilt, forgot-password, Performa PDF |
| billing_percent | ALTER TABLE (applied via Management API 2026-05-30) | ✅ Live | billing_percent numeric column on transactions; TransactionDialog reorganized (auto-calc, payment status moved to חשבונית ותשלום) |
| Repair 3 | (no migration) | ✅ Live | 4 TransactionDialog/billingEvents fixes: supplier select shows "ללא ספק"/supplier name instead of raw `__none__` (span reads label from state), RTL `עמלת קפס %` label, delete button on billing event rows (two-step inline confirm), `upsertBillingEvents` skips already-occupied event_index to stop phantom duplicate rows. Commit f6ff0ee, deployed 2026-05-30. |
| Repair 4 | (no migration) | ✅ Live | Bonus engine (`src/lib/bonus.ts`) now accrues revenue **only on `paid` billing events** (was all non-cancelled), attributed to **`payment_date`** month (falls back to `billing_date` when null). `fetchApprovedBillingEventRows` filters `.eq('status','paid')` + selects `payment_date`; `groupBillingRevenueByEmployeeMonth` keys by payment month. Commit f88a0e3, deployed 2026-05-30. |
| Repair 9 | (no migration) | ✅ Live | Fixed base-ui `<SelectValue/>` showing the raw value (e.g. "all", "5", "2026-5") when the dropdown is closed — replaced with a `<span>` reading the label from state / existing label maps inside each `<SelectTrigger>`. Pages: Clients (status, group, dialog-status), BillingReports (status, service-type), Bonuses (period — keeps "(תחזית)" suffix; sort — new SORT_LABELS), MyHoursView (month/year), Services (field-type + width, reusing FIELD_TYPE_LABELS/WIDTH_LABELS). Removed unused SelectValue imports. ⚠ Known remaining: AgreementUploader's client-match select (picker-style, out of this task's scope). Commit 74e03c1, deployed 2026-05-31. |
| Repair 8 | (no migration) | ✅ Live | Cleaner tables. Removed Transactions' four filter dropdowns (client/service/month/approval) + collapsible — kept free-text search only. Added sortable column headers (shared `src/components/SortableHead.tsx`: SortState, toggleSortKey, Hebrew/numeric-aware compareBySort with empties-last) to Transactions (default close_date desc), Clients (name asc), MyHoursView (visit_date desc; עובד/ת sorts by derived name), BillingReports (billing_date desc; nested transactions.client_name accessor). BillingReports filters/checkboxes/inline inputs and Transactions billing dots/approve/edit/delete preserved. Commit 1ae2573, deployed 2026-05-31. |
| Repair 7 | 20260531_hours_administration_read.sql | ✅ Live | Hours UX redesign. Merged השעות שלי + ניהול שעות into ONE unified MyHoursView (no tabs). Role-aware: admin+administration see all employees' hours with עובד/ת filter (names via list_profiles_for_attendance RPC); recruiters see own only. ClientPicker overflow fixed (Card overflow-visible + relative z-50). HoursEntryDialog: editable auto-calc hours, client locked when preset from filter. HoursReportDialog: jsPDF replaced with browser-native print to styled RTL HTML (correct Hebrew, zero deps). Deleted ManageHoursView.tsx. Admin-only הפק חיוב שעות billing + billed-row locking preserved. RLS: additive SELECT-only `hours_administration_select` policy on hours_log. Commit c2a60d8, deployed 2026-05-31. |
| Feature: Attendance | 20260530_attendance_log.sql | ✅ Live | Employee check-in/out tracking. `attendance_log` table (work_date set by Israel-tz trigger), multiple in/out pairs per day. `/attendance` desktop (status + check button + today's log + admin/administration report with pair-matched hours and ⚠ פתוח for open pairs) and `/m/attendance` mobile. Sidebar item (recruiter+administration, NOT admin), mobile bottom tab. Report names via SECURITY DEFINER `list_profiles_for_attendance()` (administration can't read profiles directly). Sidebar icon: `CalendarCheck` (distinct from Clock/hours). Commit bb808d8, deployed 2026-05-31. |
