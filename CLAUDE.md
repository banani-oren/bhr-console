# BHR Console — Codebase Map (Claude Code)

> This file is the authoritative reference for Claude Code. Read it at the start of every session.
> Root `CLAUDE.md` (one level up) defines the Cowork planning role and working method.

---

## Project

Internal financial and operational management system for **Banani HR**.  
Used daily by Oren (CEO) and the recruitment team.

**Live URL (production domain for QA/users):** `app.banani-hr.com` — HTTP 200, serves the app.  
**Vercel URL:** `bhr-console-banani-orens-projects.vercel.app` — ⚠ behind Vercel deployment protection (SSO), returns HTTP 401 to anonymous curl; use `app.banani-hr.com` to verify a live deploy, or match the served `/assets/index-*.js` hash to your local `dist/` build.  
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
│   │   ├── attendance.ts               # Attendance helpers — Israel-tz today/time, status, pair-matching hours (dayHours), dayPairs() (check_in→check_out AttendancePair[]), toLocalInputValue() (UTC→browser-local for datetime-local inputs)
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
│   │   ├── SetPassword.tsx             # Password reset / first-login flow. ⚠ Routing gates on `recoveryMode` ONLY (arrived via reset/magic link), NOT on `profiles.password_set` (Repair 5b) — a normal login session always goes to the app, so a stale password_set=false can never trap a user. password_set is still written true on a successful set; it is not a routing gate. PKCE recovery detected via ?code/?type=recovery query params + #type=recovery hash (Repair 5).
│   │   ├── Dashboard.tsx               # Role-aware: loads correct dashboard per role
│   │   ├── Clients.tsx                 # Client list + ClientDialog (create/edit)
│   │   ├── Transactions.tsx            # Transaction table: filters, inline edit, export
│   │   ├── Attendance.tsx              # Check-in/out + daily attendance report (report = admin/administration). V2: two-phase check-out with optional note (≤250); today's-log + report show check_in→check_out pairs (report = one TableRow per pair, name/date only on first); employee 'תיקון' edit-request form (insert into attendance_edit_requests); admin pencil direct-edit + 'בקשות תיקון ממתינות' approve/reject panel. Edit forms use toLocalInputValue() so datetime-local shows Israel local time. Repair 12: admin-only AdminDeleteButton (trash, two-step inline 'מחק? כן/ביטול') in the פעולות column deletes both pair entries; /attendance sidebar link now allows admin too (Layout.tsx).
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
│   │       ├── MobileLanding.tsx       # /m index — full-screen section picker (שעות/נוכחות), zero chrome (no MobileShell wrapper)
│   │       ├── MobileShell.tsx         # /m/hours|attendance|profile layout — purple-950 header + safe-area bottom nav (no sidebar)
│   │       ├── MobileHours.tsx         # Mobile hours: month stepper, summary card, tap-to-expand cards w/ edit+delete (billed rows locked), FAB add
│   │       ├── MobileAttendance.tsx    # Mobile check-in/out (no report). V2: two-phase check-out note + pair display in today's log. Redesign: in-page title+date header.
│   │       └── MobileProfile.tsx       # Mobile profile view
│   │
│   └── assets/
│       └── hero.png
│
├── supabase/
│   ├── functions/
│   │   ├── impersonate-user/index.ts   # Edge function: admin generates one-time magiclink to log in AS a target user ("התחבר בתור"). ✅ DEPLOYED 2026-06-01 via the Supabase dashboard in-browser editor (the sbp_ SUPABASE_ACCESS_TOKEN in .env.local is expired, so CLI/Management-API deploy fails — refresh it before the next functions deploy). verify_jwt=true.
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
│       ├── 20260531_hours_administration_read.sql   # Repair 7: additive SELECT RLS so administration reads all hours_log rows
│       └── 20260601_attendance_edit_requests.sql    # Feature: Attendance V2 — attendance_edit_requests table + RLS (insert/select own, admin update)
│
├── scripts/
│   └── generate-icons.mjs              # PWA icon generation
│
├── public/                             # Static assets + PWA icons
├── EMPLOYEE_MOBILE_INSTALL_GUIDE.md    # iPhone PWA install guide for team (Hebrew)
├── supabase-schema.sql                 # Bootstrap schema only — migrations are the live state
├── vite.config.ts
├── components.json                     # shadcn/ui config
├── vercel.json                         # SPA rewrite rules
├── package.json
└── .env.local                          # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (never commit)
```

**Prompts directory** (sibling of App Dev, at `C:\Users\Oren\BHR Console\prompts\`):
- Active Claude Code prompts follow the pattern `repair{N}-*.md` or `feature-*.md`
- Completed prompts are deleted after the task is live (history lives in git + phase table above)
- Current pending prompts: _(none)_ — all known prompts done & live (see Phase History for full history: `repair5`/`repair5-complete`, `repair5b`, `repair6`, `repair8`, `repair9`, `repair10`, `repair11`, `repair12`, `feature-impersonate-user`, `fix-impersonate-deploy`, `feature-attendance-v2`, `housekeeping-repair13`). ✅ Repair 13 (2026-07-04): all 13 stale `.md` prompt files for completed phases deleted from `prompts/` — directory now empty except `housekeeping-repair13.md` itself (also deleted as the task's final step). ✅ Repair 6 fully complete (commit 71df2f4): every `supabase.from(...)` write in the app now has a 20s abort — coverage-grep verified zero gaps. Only `auth.*`/`functions.invoke`/`storage.*` excluded (different APIs). See Repair 6 Phase History note.

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

attendance_edit_requests           -- Employee-submitted correction requests (Feature: Attendance V2)
  id uuid PK
  attendance_log_id uuid → attendance_log NOT NULL (ON DELETE CASCADE)
  profile_id uuid → profiles NOT NULL (ON DELETE CASCADE)
  requested_at timestamptz DEFAULT now()
  proposed_logged_at timestamptz NOT NULL
  proposed_notes text
  reason text NOT NULL
  status text DEFAULT 'pending' CHECK IN ('pending','approved','rejected')
  reviewed_by uuid → profiles
  reviewed_at timestamptz
  -- RLS: insert own (profile_id = auth.uid()); select own OR admin/administration;
  --      UPDATE admin only (approve/reject). Approve copies proposed_logged_at/proposed_notes onto the attendance_log row.
  -- NOTE: two FKs to profiles (profile_id, reviewed_by) → embeds must disambiguate:
  --       profiles!attendance_edit_requests_profile_id_fkey(full_name)

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
| Feature: Impersonation | (no migration) | ✅ Live (deployed 2026-06-01) | Admin "התחבר בתור" button on /users (admin-only, hidden on own row, before edit/delete). New edge function `impersonate-user` verifies caller JWT + admin role (service role), refuses self, generates a one-time magiclink for the target's email and returns its action_link; Users.tsx opens it in a new tab (noopener). Edge function DEPLOYED 2026-06-01 via the Supabase dashboard in-browser editor (verify_jwt=true); deployed source confirmed byte-identical to repo and live status verified (404→401). ⚠ The sbp_ SUPABASE_ACCESS_TOKEN in .env.local is still EXPIRED — CLI/Management-API function deploys will fail until it is refreshed. ⚠ Known design caveat: magiclink opens on the same origin → shared localStorage means the admin's own tab also switches to the impersonated user (Supabase session is per-origin). Commit e666255. |
| Repair 10 | (no migration) | ✅ Live | Filter layout. BillingReports: collapsed the search-row + 5-col dropdown grid into one flex row (flex-wrap) inside the Card, removed per-field `<Label>`s (triggers act as placeholders — סטטוס/סוג שירות/כל הלקוחות shown when 'all'); no query/search/totals logic changed. Transactions: re-added a single "חודש סגירה" dropdown beside the search bar (in a Card row), filtering by `closing_month` 1–12 (distinct from the billing_month dropdown removed in Repair 8; 'all'→כל החודשים shows everything). Re-added HEBREW_MONTHS + Select imports. Sort + search preserved. Commit dd87804, deployed 2026-05-31. |
| Repair 9 | (no migration) | ✅ Live | Fixed base-ui `<SelectValue/>` showing the raw value (e.g. "all", "5", "2026-5") when the dropdown is closed — replaced with a `<span>` reading the label from state / existing label maps inside each `<SelectTrigger>`. Pages: Clients (status, group, dialog-status), BillingReports (status, service-type), Bonuses (period — keeps "(תחזית)" suffix; sort — new SORT_LABELS), MyHoursView (month/year), Services (field-type + width, reusing FIELD_TYPE_LABELS/WIDTH_LABELS). Removed unused SelectValue imports. ⚠ Known remaining: AgreementUploader's client-match select (picker-style, out of this task's scope). Commit 74e03c1, deployed 2026-05-31. |
| Repair 8 | (no migration) | ✅ Live | Cleaner tables. Removed Transactions' four filter dropdowns (client/service/month/approval) + collapsible — kept free-text search only. Added sortable column headers (shared `src/components/SortableHead.tsx`: SortState, toggleSortKey, Hebrew/numeric-aware compareBySort with empties-last) to Transactions (default close_date desc), Clients (name asc), MyHoursView (visit_date desc; עובד/ת sorts by derived name), BillingReports (billing_date desc; nested transactions.client_name accessor). BillingReports filters/checkboxes/inline inputs and Transactions billing dots/approve/edit/delete preserved. Commit 1ae2573, deployed 2026-05-31. |
| Repair 7 | 20260531_hours_administration_read.sql | ✅ Live | Hours UX redesign. Merged השעות שלי + ניהול שעות into ONE unified MyHoursView (no tabs). Role-aware: admin+administration see all employees' hours with עובד/ת filter (names via list_profiles_for_attendance RPC); recruiters see own only. ClientPicker overflow fixed (Card overflow-visible + relative z-50). HoursEntryDialog: editable auto-calc hours, client locked when preset from filter. HoursReportDialog: jsPDF replaced with browser-native print to styled RTL HTML (correct Hebrew, zero deps). Deleted ManageHoursView.tsx. Admin-only הפק חיוב שעות billing + billed-row locking preserved. RLS: additive SELECT-only `hours_administration_select` policy on hours_log. Commit c2a60d8, deployed 2026-05-31. |
| Feature: Attendance | 20260530_attendance_log.sql | ✅ Live | Employee check-in/out tracking. `attendance_log` table (work_date set by Israel-tz trigger), multiple in/out pairs per day. `/attendance` desktop (status + check button + today's log + admin/administration report with pair-matched hours and ⚠ פתוח for open pairs) and `/m/attendance` mobile. Sidebar item (recruiter+administration, NOT admin), mobile bottom tab. Report names via SECURITY DEFINER `list_profiles_for_attendance()` (administration can't read profiles directly). Sidebar icon: `CalendarCheck` (distinct from Clock/hours). Commit bb808d8, deployed 2026-05-31. |
| Repair 5 (Complete) | (no migration) | ✅ Live (2026-06-01) | Password-reset loop fixed (3 issues). (1) PKCE detection: `supabase.ts` + `SetPassword.tsx` now treat `?code=`/`?type=recovery` query params as recovery, not just the legacy `#type=recovery` hash, so reset links no longer bounce to `/login` before the code exchange resolves; SetPassword shows "מאמת קישור..." while the exchange is pending. (2) Lock retry: `updateUser({password})` retries once after 600ms on "Lock ... was released because another request stole it". (3) `auth.tsx` strips code/type params after PASSWORD_RECOVERY so refresh doesn't re-trigger. Also: `impersonate-user` edge fn now sets `password_set=true` before generateLink so impersonation lands in-app, not `/set-password` (non-fatal on error). Nadia unblocked directly (`profiles.password_set=true` via pooler). Commit 91feabe, frontend deployed to app.banani-hr.com (verified: live bundle contains the new `מאמת קישור`/`bhr_recovery_mode` code). Edge fn `impersonate-user` REDEPLOYED 2026-06-01 with the password_set change via the Supabase dashboard in-browser editor (deployed source verified to contain `password_set: true`; curl 401 = alive); CLI/Management-API token still expired. Supersedes original `repair5-password-reset.md`. |
| Repair 5b | (no migration) | ✅ Live (2026-06-02) | Closed the `password_set` trap systemically. `SetPassword.tsx` routing now gates on `recoveryMode` ONLY: a normal login session always navigates to `/` regardless of `profiles.password_set`, so a stale `password_set=false` can never block a user who logged in normally (the recurring Nadia/Noa lockout). Reset-link (recoveryMode) sessions still see the password form; password_set is still written true on a successful set (just not a routing gate). All stuck users unblocked directly (`noa`, `michal.sample`, `r@fixme.co.il` → password_set=true via pooler; all 5 profiles now true). Step 3 (admin reset button) was already implemented in `Users.tsx` (KeyRound icon → `resetPasswordForEmail` with the correct dynamic `${window.location.origin}/set-password` redirect + inline status) — confirmed with Oren to keep it and NOT add the prompt's duplicate LinkIcon button (which also hardcoded the SSO-protected `*.vercel.app` URL). Only `SetPassword.tsx` changed. Commit 390b479, deployed to app.banani-hr.com (live bundle index-ZbYR5_17.js). |
| Repair 11 | (no migration) | ✅ Live (2026-06-02) | Four UI/accuracy fixes. (1) `ClientPicker` no longer opens its dropdown on focus (removed `onFocus`) — it was auto-opening when TransactionDialog auto-focuses the first field; click + typing still open it (verified live). (2) Renamed visible Hebrew קפס→ספק in TransactionDialog Section 4 (header + 'עמלת ספק %'); no var/state/DB renames. (3) **Billing status colors** unified across ALL dot/badge maps (TransactionDialog, Transactions, BillingReports, Admin/Recruiter dashboards): pending=gray, to_bill=blue, billed=**amber** (invoiced, awaiting payment), paid=emerald/green (money in). Green now ALWAYS = paid. Added missing `paid` label('שולם')/badge to AdminDashboard + RecruiterDashboard maps; recolored BillingReports 'סה"כ חויב' total green→amber. (4) **Income = paid only**: AdminDashboard תקבולים החודש/YTD count `status='paid'` by `payment_date` (a billed event has a calculated payment_date but isn't received); KPI 'ממתין לתשלום'→'לגבייה' now sums billed+to_bill; monthly-revenue + lead-revenue charts count only paid. 4e applied: AdministrationDashboard 'נגבה החודש' + 6-month collections paid-only; RecruiterDashboard month income + 6-month chart paid-only by payment_date — now consistent with the live bonus engine (Repair 4), so a recruiter's displayed bonus reflects actually-paid revenue (⚠ this lowers displayed recruiter income vs the old billing-based number — intended). 'לחיוב' KPI unchanged. Commit 9eabd1f, live (bundle index-BSF4LPXV.js); verified on app.banani-hr.com (לגבייה=₪55,980/5, billed badge=amber, ClientPicker no auto-open). |
| Feature: Attendance V2 | 20260601_attendance_edit_requests.sql | ✅ Live (2026-06-02) | Three attendance improvements. (1) **Pair display**: today's-log + report show check_in→check_out pairs (`dayPairs()` in attendance.ts — sequential pairing, unmatched check-ins → open pairs); report renders one `TableRow` per pair (name/date only on first), with כניסה/יציאה/שעות/**תיאור**/**עריכה** columns. (2) **Check-out notes**: two-phase check-out — clicking יציאה shows an optional ≤250-char note input before saving (check-in still one click); notes shown in pairs + report. Desktop + mobile. (3) **Edit requests**: employees can't directly edit; they submit a 'תיקון' request (`attendance_edit_requests`, insert-own RLS). Admin sees a 'בקשות תיקון ממתינות' panel (approve copies proposed time+notes to the log; reject just marks status) and can also directly edit any row via the pencil (AdminEditButton → updates attendance_log). datetime-local inputs use `toLocalInputValue()` to show Israel local time (fixed a UTC off-by-2-3h bug in the original prompt code). The pending-panel embed disambiguates the two profiles FKs via `profiles!attendance_edit_requests_profile_id_fkey`. QA: migration/RLS verified via pg; report pairs, admin edit form (correct local times), and pending panel (FK embed → name resolved) all verified live on app.banani-hr.com. Commit 5f4dcc1, bundle index-b3z0Kj3h.js. ⚠ Note for the prompt's literal code: the `AttendanceEditRequest` import it specified for Attendance.tsx is unused (omitted to satisfy noUnusedLocals); `Array<Promise>` → `Array<PromiseLike>` (PostgREST builders are thenables). |
| Repair 12 | (no migration) | ✅ Live (2026-06-02) | Two attendance fixes. (1) `Layout.tsx`: added `'admin'` to the נוכחות nav item's `allow` list (was recruiter/administration only) — admin needs the page for reports + edit-request approvals; item position unchanged. (2) `Attendance.tsx`: new admin-only `AdminDeleteButton` (trash icon, two-step inline 'מחק? כן/ביטול' confirm) in the report פעולות column (header renamed עריכה→פעולות), next to the edit pencil; deletes both pair entries (`inEntry` + `outEntry` if present) from attendance_log via `.in('id', ids)`. QA (throwaway user, full cleanup): admin sidebar link verified live; trash→confirm→ביטול (non-destructive) and →כן (deletes both rows, DB-confirmed 0 rows, report row vanishes) verified live; recruiter/administration link unaffected (additive change). Commit d0f984f, bundle index-BAQYhg4m.js. |
| Repair 6 | (no migration) | ✅ Live (2026-06-03) | Save-hang fix completed. **Root cause:** `useSafeMutation` builds an AbortController + timeout and passes the `signal` as the 2nd `mutationFn` arg, but most callers ignored it — so the timeout fired without interrupting the hung fetch, leaving dialogs stuck on "שומר...". Threaded `.abortSignal(signal)` into every save/write handler that lacked it: HoursEntryDialog (insert/update), Clients save (clients + permissions), ProfileEditor profile save, MyHoursView delete + hours-billing (txn/hours-link/event). Suppliers + Services use plain `useMutation` (no timeout) → added a 20s AbortController in the handler and threaded the signal via `mutateAsync`. Touched save mutations bumped to `timeoutMs: 20000`. TransactionDialog + billingEvents already had 20s abort (commit 9f19e3a). ⚠ Gotcha: `.abortSignal()` must come BEFORE `.single()` (after `.single()` the builder type no longer exposes it — caught by build). Logic unchanged (abort plumbing only). QA: build/tsc green; Clients edit→save verified live (saves + closes, no regression, no console errors). The Slow-3G behavioral timeout test (QA step d) needs DevTools network throttling — not runnable from automation; mechanism is build-verified. Commit 5b4173d, bundle index-jHi-Yr-T.js. **Follow-up sweep (commit e7cab8d):** added a self-contained 20s AbortController (no call-site changes) to the remaining plain-`useMutation`/raw handlers — generic `useInsert/useUpdate/useDelete` (`useSupabaseQuery.ts`, shared `withSaveTimeout`), Transactions approve, Users role-toggle, Suppliers/Services delete, Clients raw `handleDelete`. **Final sweep (commit 71df2f4) — now COMPLETE across the whole app:** added a 20s AbortController to every remaining raw `from()` write — Attendance V2 (handleCheck, edit-request submit, AdminEditButton, AdminDeleteButton, PendingEditRequests approve/reject), MobileAttendance check-in/out, MobileHours save (the controller existed but never threaded the signal — bug) + offline-queue flush, AgreementUploader confirmItem, TransactionDialog billing-event ROW edits (saveField/handleDelete) + legacy handleGenerate, BillingReports inline edit, Clients bulk-import (per-row) + raw handleDelete, SetPassword profile update, and lib/clients.ts upsertClient/deleteClient (unused, covered for safety). ✅ A coverage grep now shows ZERO `supabase.from(...).insert/update/delete` without `.abortSignal()` (the only 2 grep hits are multi-line inserts whose `.abortSignal()` is on the closing line). The 15s `useSafeMutation` default still applies to any caller that *does* thread the signal but didn't override `timeoutMs`; all directly-touched save handlers use 20s. Only excluded: `supabase.auth.*` (SDK takes no signal), `supabase.functions.invoke` (best-effort), `supabase.storage.*` (different API). |
| Repair 14 | (no migration) | ✅ Live (2026-07-04) | Save-hang root cause finally fixed (Repair 6 closed the `.abortSignal()` coverage gap for `supabase.from()` writes, but this was a different gap). **Real root cause:** `withSaveTimeout`/`useSafeMutation` don't swallow AbortError (no catch block exists in either — errors already propagate to onError). The actual bug: `Users.tsx`'s `handleInvite`/`handleDelete`/`handleResetPassword`/`handleImpersonate` called `supabase.functions.invoke()`/`auth.resetPasswordForEmail()` with **zero** AbortController/timeout at all — a hung request left the button spinning forever with no error and no recovery, since the `finally` that resets the loading flag never ran. `TransactionDialog.tsx`'s `send-approval-email` invoke (recruiter-create-transaction path) had the same gap. `ProfileEditor.tsx`'s `ChangePasswordDialog`/`ChangeEmailDialog` used `useSafeMutation` but ignored the `signal` param, so `auth.updateUser()` could hang past the hook's own timeout since `updateUser()` never reacts to abort. **Fixes:** 10s AbortController+signal wired into all 4 `Users.tsx` handlers (`Promise.race` guard for `resetPasswordForEmail`, which takes no signal param); `TransactionDialog`'s approval-email invoke now shares `handleSave`'s abort signal; `ProfileEditor`'s two sub-dialogs race `updateUser()` against the abort signal (mirrors the pre-existing guard in `Team.tsx`'s `saveMutation` — proving that pattern was already the established fix for this exact class of bug elsewhere). All 30 occurrences of the 20000ms abort timeout across 17 files reduced to 10000ms (users abandon before 20s). New `src/hooks/useSaveWatchdog.ts` (last-resort UI-recovery timer) wired into `Users.tsx` + `TransactionDialog.tsx` only — not blanket-applied to already-safe dialogs (Suppliers/Services/Clients/HoursEntryDialog/Team/main ProfileEditor save), which investigation confirmed already guarantee resolution via `useSafeMutation`/`Promise.race`/manual `AbortController`+`finally`. Closed 3 silent-error gaps in `Attendance.tsx` (`RequestEditButton`/`AdminEditButton` used `alert()`, `AdminDeleteButton` was console-only) with inline Hebrew error text. QA: build/tsc green; regression 12/12 Transactions columns confirmed live; full invite→delete cycle exercised on a `[TEST-Repair14]` throwaway user on `/users` (confirms the new `signal`-wired `functions.invoke()` calls work end-to-end); `AdminEditButton`/`AdminDeleteButton` inline forms and `TransactionDialog` verified rendering correctly on real data (cancelled without saving); no app console errors. ⚠ The literal Slow-3G DevTools-throttle test isn't runnable from this automation environment (same limitation as Repair 6) — mechanism is build+live-verified instead. Commit 9eb85a7. |
| Feature: Billing Events Engine | (no migration) | ✅ Live (2026-07-04) | Three interconnected billing improvements in `TransactionDialog.tsx` + `lib/billingEvents.ts`. **(1) Advance is now a separate discrete billing event** (event_index=1, description "מקדמה") instead of being folded into the first split event's amount; payment-split percentages now apply to the REMAINING commission after the advance, not the original gross total. ⚠ Stopped mid-implementation to confirm with Oren: the prompt assumed `transaction.billing_percent` drives the advance, but audit found that field is completely dead/unused (TransactionDialog already computed net_invoice_amount without it) — the real, live mechanism is `client.advance_type`/`advance_amount` (+ per-transaction override via `AdvanceEditor`). Confirmed to keep that mechanism as the trigger; `billing_percent` remains untouched/unused. **(2) גיוס transactions get two salary fields**: שכר משוער (expected — existing `salary`/`custom.salary`, unchanged) and new optional שכר סופי (`custom.final_salary` only, NOT mirrored to the top-level `salary` column — the prompt self-contradicted here between "top-level salary stays unchanged" and "mirror final_salary to it"; resolved in favor of backward compatibility since Transactions.tsx's שכר column reads the top-level value directly). `net_invoice_amount`/`commission_amount` use final_salary once set. Changing final_salary on an already-billed transaction prompts for confirmation ("שכר סופי עודכן. לעדכן את אירועי החיוב בהתאם?"), then `reconcileFinalSalaryBillingEvents` reconciles: advance stays locked (always expected-salary-based), already billed/paid split events are left untouched, and the last still-open event absorbs whatever delta remains. **(3) Admin-only "+ הוסף אירוע"** manual billing event insert, plus `amount`/`billing_date` are now editable inline on existing rows (previously read-only, using the same onBlur-save convention as `invoice_number`/`payment_date`/`receipt_number`); added row-level Hebrew error display (previously console-only). QA: build/tsc green; regression 12/12 (file untouched); standalone Node-script math verification (4 scenarios: no-advance, with-advance, one-locked-event, two-locked-event reconciliation) run before any live test — caught and fixed a real indexing bug in the reconciliation function this way; full live E2E test via a throwaway `[TEST-Phase4]` service type + client + transaction confirmed advance separation (₪1,000 + ₪300/₪700 split), final_salary reconciliation (→₪420/₪980, total ₪2,400), and locked-advance reconciliation (marked advance 'paid' via DB, changed final_salary again → advance stayed locked at ₪1,000, splits became ₪600/₪1,400, total ₪3,000) all matching expected math exactly; manual add/inline-edit/delete on billing event rows all confirmed working; `window.confirm`/`alert` overridden via `javascript_tool` before triggering the save-time confirmation dialog to avoid blocking the browser automation session while still exercising the real code path. All test data cleaned up and confirmed via a final DB query. Commit 4b5f7bc. |
| Feature: Billing Reports Accuracy | (no migration) | ✅ Live (2026-07-04) | Audited AdminDashboard/AdministrationDashboard/RecruiterDashboard/BillingReports against the prompt's new accuracy rules before touching anything. ⚠ Found "לגבייה" (outstanding) currently means three different things across the app: AdministrationDashboard's "סכום לגבייה כעת" (already billed-only, matches the rule), AdminDashboard's "לגבייה" KPI (billed+to_bill combined — an explicit, documented Repair 11 decision, not an oversight), BillingReports' "יתרה לגבייה" (pending+to_bill — furthest from the rule, didn't even include billed). Confirmed with Oren how to reconcile rather than silently overriding Repair 11's choice: **left AdminDashboard's KPI as-is**, fixed BillingReports only. **BillingReports.tsx**: "יתרה לגבייה" now billed-only (was pending+to_bill); "סה\"כ חויב" now billed+paid combined — cumulative ever-invoiced regardless of later payment (was billed-only, undercounting); new "סה\"כ שולם" total added (paid-only, didn't exist before). Date-range filter now matches `payment_date` instead of `billing_date` when the status filter is "שולם" (paid). **AdminDashboard.tsx**: new collapsible "לוח תשלומים צפוי" widget (all `billed` events sorted by payment_date + total; hidden when none exist; collapse state in localStorage per `profile.id`) placed directly below the KPI grid — NOT literally "above the pending approvals panel" per the prompt's mockup, since that panel already sits ABOVE the KPI grid from Phase 2; reordering it to match the mockup would have violated NO REGRESSION for no real gain, so its position was left untouched. AdministrationDashboard.tsx and RecruiterDashboard.tsx needed zero changes — already fully correct (paid-only income by payment_date, billed-only outstanding). QA (read-only, real data, no test data needed): one real billed event (₪10,080) was enough to verify the widget and all four BillingReports totals against a direct DB aggregate query — every total matched exactly (billed=₪10,080, paid=₪88,460, to_bill=₪8,400 → סה"כ חויב=₪98,540, יתרה לגבייה=₪10,080, סה"כ שולם=₪88,460, סה"כ לחיוב=₪8,400); widget collapse state confirmed persisting across a full page reload. Commit 51ba52f. |
| Feature: Attendance Admin | (no migration) | ✅ Live (2026-07-04) | Three improvements to the attendance admin report in `Attendance.tsx`. (1) `AdminEditButton` rewritten to edit BOTH check_in and check_out of a pair (+ notes on each, was previously only one side editable); open pairs (missing check_out) get a "+ הוסף יציאה" reveal that inserts a new check_out row on save (`profile_id` from `pair.inEntry.profile_id`). (2) Report date column now shows the Hebrew weekday via new `formatWorkDateWithDay()` in `lib/attendance.ts` (`formatWorkDate` kept unchanged, still used/exported elsewhere). (3) Month filter added (last 12 months + הכל) as a new grid column; selecting a month pre-fills מתאריך/עד תאריך (still independently editable); the report's initial `submitted` state is now pre-set to current-month bounds (was `null`) so it auto-loads on page open without requiring "הפק דוח" first. ⚠ **Bug caught and fixed within this same phase**: making the report auto-fire on mount exposed a race where employee names resolved inside the cached `queryFn` (via `nameById`) could permanently bake in `'—'` if the query settled before the employees list loaded (same queryKey ⇒ never re-runs). Fixed by moving name resolution into a separate `useMemo(reportRowsRaw, nameById)` so it's reactive regardless of query timing — shipped as a same-phase follow-up commit before declaring QA complete. ⚠ **PWA cache gotcha discovered**: verifying a deploy via `curl`'s bundle hash is NOT sufficient — the workbox service worker can keep an open browser tab on a stale precached bundle even after the server has the new one; had to explicitly call `serviceWorker.getRegistrations()[].update()` + clear `caches` and re-navigate to confirm each deploy actually landed in the browser under test. QA: build/tsc green; regression 12/12 Transactions columns confirmed (file untouched); full live verification after force-clearing the PWA cache — current-month auto-load, weekday+date display, month-switch auto-fill (July↔June, names/weekdays correct post-fix) all confirmed on real data; the "add missing check-out" save cycle was verified end-to-end on a throwaway `[TEST-Phase3]` attendance row (not on the real open pair found live, to avoid fabricating a real employee's hours) — DB confirmed the correct check_out row inserted and the UI correctly closed the pair; cleaned up after. Commits c78365d (feature), 722f659 (name-race fix). |
| Feature: Approval Notification | (no migration) | ✅ Live (2026-07-04) | Admins previously had no way to notice a recruiter-created transaction awaiting approval short of manually scanning Transactions. New `src/hooks/usePendingApprovals.ts` (`needs_approval=true AND approved_at IS NULL`, `enabled` only for admin) backs two new surfaces: (1) a red-dot badge on the עסקאות sidebar item in `Layout.tsx` — added as an absolutely-positioned dot inside a new `relative` wrapper around the existing icon span, no NAV_ITEMS reordering/renaming; (2) a "ממתין לאישור (N)" card at the top of `AdminDashboard.tsx` (before the KPI row, hidden entirely when count=0) listing לקוח/שירות/מועמד/מוביל with inline אשר (approve) + ערוך (opens the existing `TransactionDialog` in edit mode) actions; collapses to a name+actions-only list below `sm` breakpoint. The אשר action deliberately mirrors `Transactions.tsx`'s existing `approveMut` in full (also flips past-due `pending` billing_events to `to_bill`), not the simpler version, so both approve entry points behave identically. QA: build/tsc green; regression 12/12 Transactions columns confirmed (file untouched this phase); full live cycle on a `[TEST-Phase2]` throwaway transaction (inserted via pg) — badge appeared, card showed correct row, אשר set approved_at/approved_by and both badge+card disappeared without reload, ערוך opened TransactionDialog correctly; empty state confirmed (card absent, not just empty) both before insert and after approve; recruiter/administration exclusion verified by code (Dashboard.tsx never renders AdminDashboard for those roles, so the card can't exist for them). ⚠ 375px visual check blocked by the same resize-tool limitation as Repair 14 — mechanism reuses the app's existing `hidden sm:block`/`sm:hidden` pattern (e.g. KPI grid), not new/unproven. Commit 55d0ca1. |
| Repair 13 | (no migration — direct DB row delete via pooler) | ✅ Live (2026-07-04) | Housekeeping, 3 parts. (1) Deleted all 13 stale completed-phase `.md` files from `prompts/` (history lives in this table + git). (2) **Phantom billing_events**: verified 3 flagged transactions before deleting anything — only `f1d2a93d-f153-4c2c-9641-cdbe37ad5e59` matched the described pattern (a `pending` row at event_index=1 exactly duplicating the `paid` row's ₪4,800) and was deleted. The other two did NOT match: `cdbca750-2c19-422c-a99b-e9094742063a` has no pending row at all at that event_index (only `paid` ₪4,320 idx 1 + `billed` ₪10,080 idx 2 — nothing to delete); `d141e376-0a03-40b0-af69-5c56cc49ff0b` has a pending row at idx 1 (₪10,800) but it does NOT match the paid row's amount (₪3,240) — a real duplicate-index anomaly, not a clean phantom. ⚠ **Unresolved**: these two need Oren's review before any deletion — do not delete without re-verifying intent. (3) `SUPABASE_ACCESS_TOKEN` in `.env.local` is still expired (401) as of 2026-07-04 — CLI/Management-API function deploys remain blocked; renew at https://supabase.com/dashboard/account/tokens. No source files changed; `npm run build`/`tsc` green; no commit needed. |
| Feature: Form Improvements | (no migration) | ✅ Live (2026-07-04) | Two service-type-specific redesigns in `TransactionDialog.tsx`. ⚠ Audited the live `הדרכה` service type's actual fields before coding — didn't match the prompt's guessed shape; kept the real DB field key `price` unchanged (only relabeled on-screen to "מחיר הדרכה" via a new `labelOverride` param on the shared `wrap()` helper). **(1) גיוס**: salary split into שכר משוער (expected, existing `salary`/`custom.salary`) / שכר סופי (final, `custom.final_salary`); advance always derives from EXPECTED salary via `resolveAdvanceAmount`, never final. New optional מספר מועמד (`custom_fields.candidate_number`, no new DB column) rendered directly under candidate name. Changing final salary after billing events exist prompts `window.confirm` before reconciling via the Phase 4 `reconcileFinalSalaryBillingEvents` engine. **(2) הדרכה**: multi-row תאריכי ביצוע (execution dates + per-row hours) replacing the single work-start/end date pair; חיוב נסיעות (travel billing) toggle + amount; a dedicated `useEffect` live-syncs `custom.net_invoice_amount` to `price × dates + travel` so the invoice amount never drifts from the displayed total. Section 2's four placement-lifecycle date fields (work_start/end, warranty_end, close_date) hidden via `{!isHadracha && (...)}`; `הערות` deliberately left outside that conditional so it still renders for every service type (unasked-for removal would've been a regression). QA (throwaway `[TEST-Phase6] QA Client`, real גיוס/הדרכה service types, full cleanup): הדרכה — created a transaction, added a 2nd execution-date row (confirmed live total 1,000→2,000), removed it, enabled travel billing (₪150, confirmed live total "1,150 ₪ (1,000 ₪ × 1 תאריכים + 150 ₪ נסיעות)"), saved, DB-confirmed `net_invoice_amount=1150` + all custom_fields persisted, reopened via edit pencil and confirmed every field reloaded correctly including hidden Section 2 dates + visible הערות. גיוס — created a transaction with שכר משוער=15000, מספר מועמד=CAND-99887; confirmed via screenshot the field renders directly below candidate name; saved, DB-confirmed `custom_fields.candidate_number="CAND-99887"` persisted; reopened and confirmed reload. All test data (2 transactions + billing_events + throwaway client) deleted; DB count query confirmed zero `%Phase6%` rows remain anywhere. Regression: 12/12 Transactions columns confirmed (file untouched — only TransactionDialog.tsx changed). ⚠ Repeated browser-automation flakiness this phase (Select option clicks intermittently closing the whole parent Dialog) affected pre-existing unmodified UI (client picker) identically — an environment/coordinate-drift issue in the automation harness, not an app bug; mitigated by always fetching a fresh element ref via `find` immediately before each click. Commit 6aa09b8. |
| Feature: Mobile Redesign | (no migration) | ✅ Live (2026-07-04) | ⚠ Audited before coding (per the prompt's own Step 0) and found the "double sidebar" bug the prompt described was already fixed in a prior batch (`RequireRole.tsx`'s `withLayout={false}` already kept `/m` out of `<Layout>`; `MobileShell.tsx` already had a 3-tab bottom nav) — proceeded with what was still real: a landing page, sidebar cleanup, and a visual redesign. New `src/pages/mobile/MobileLanding.tsx` — full-screen purple-gradient section picker (שעות/נוכחות cards, profile+logout footer), reachable at the `/m` index route with zero chrome (nested `<Route element={<MobileShell/>}>` wraps only the section routes, not the landing index, in `App.tsx`). `MobileAutoRoute.tsx` now redirects to `/m` (was `/m/hours`). `Layout.tsx`'s now-orphaned `תצוגת מובייל` button + its `Smartphone` icon import removed. `MobileShell.tsx`: purple-950 header, iOS-safe-area (`env(safe-area-inset-bottom)`) bottom nav, active-tab `border-t-2` styling. `MobileHours.tsx` redesigned beyond the prompt's literal ask: month-scoped query (replacing the old hardcoded "last 14 days"), a monthly summary card, tap-to-expand cards with edit/delete (mirrors desktop `MyHoursView.tsx`'s `billed_transaction_id` lock pattern — badge + disabled actions on billed rows), and a floating "+" FAB. `MobileAttendance.tsx` only needed a small in-page header (title + `formatWorkDateWithDay`) — the rest was already built to spec by the earlier Attendance V2 feature. ⚠ **Bug caught same-phase**: the new month-stepper/summary `<Card>`s rendered as a vertical stack — `Card`'s base class sets `flex-col` and a `className="flex items-center..."` override without an explicit `flex-row` never wins in `cn()`/tailwind-merge (no same-utility conflict to replace). Fixed by adding `flex-row` explicitly; shipped as a same-phase follow-up commit before declaring QA complete. QA (real admin account, `[TEST-Phase7]`-tagged throwaway hours/attendance rows, full cleanup): landing page (two cards, zero chrome, RTL) ✓; bottom nav Hours↔Attendance↔Profile navigation ✓; check-in→note-gated check-out pairing ✓; FAB add→save→appears in list (duration auto-computed) ✓, DB-confirmed persistence; tap-to-expand→edit/delete (delete confirmed removed from UI+DB) ✓; month-stepper ◀/▶ (יולי⇄אוגוסט 2026) + post-fix row layout ✓; empty state ("אין דיווחים בחודש זה.") ✓; desktop `/transactions` sidebar confirmed with no תצוגת מובייל button, unaffected otherwise ✓. Regression: 12/12 Transactions columns (file untouched). ⚠ Known environment limits (not app defects, both previously documented): the `resize_window` browser tool doesn't actually change `window.innerWidth` here, so the true 375px auto-detect trigger was verified by code review + direct `/m/*` navigation instead of a live narrow viewport; mid-QA one browser tab's CDP connection froze entirely (a save appeared to hang, but DB/network inspection showed the request never even fired — recovered via a fresh tab group, after which the identical flow completed in under 2s). Commits fb28d43 (feature), 4bfd900 (flex-row fix). |
