# BHR Console — Codebase Map (Claude Code)

> This file is the authoritative reference for Claude Code. Read it at the start of every session.
> Root `CLAUDE.md` (one level up) defines the Cowork planning role and working method.

> ⚠️ **Standing rule (Repair 19, 2026-10-06):** Any claim that something is broken,
> expired, deprecated, blocked, or anomalous must carry the date it was last
> verified. Before relying on such a claim — or building a workaround for it —
> re-verify it. Two claims in this file (a 401 token and a billing anomaly)
> were false for months; one of them nearly caused a legitimate ₪7,560
> receivable to be deleted. A dated claim that fails re-verification is
> corrected in the same session it is found. The full phase-by-phase history
> (including historical rows that were true on the day they were written but
> are not current status) lives in `DOCS/PHASE-HISTORY.md` — never read a
> historical row as a live claim; re-verify first.

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
│   │   ├── bonus.ts                    # Bonus engine — single source of truth for every bonus surface (Repair 16). fetchBonusEvents()/buildBonusLedger(): actual by payment_date, forecast = actual + open-by-due_date w/ overdue roll-forward. See "Bonus Engine" section above.
│   │   ├── billingEvents.ts            # Billing event helpers — generation, status, שוטף+X calculation
│   │   ├── attendance.ts               # Attendance helpers — Israel-tz today/time, status, pair-matching hours (dayHours), dayPairs() (check_in→check_out AttendancePair[]), toLocalInputValue() (UTC→browser-local for datetime-local inputs)
│   │   ├── dates.ts                    # Date/timezone utilities — Israeli locale helpers
│   │   ├── pdf.ts                      # PDF export helpers (jsPDF)
│   │   ├── serviceTypes.ts             # ServiceType/ServiceField types + evalDerived() formula evaluator
│   │   ├── offlineQueue.ts             # idb-keyval offline mutation queue
│   │   └── excelExport.ts              # exportSheetsToExcel() — shared xlsx multi-sheet export helper (Batch 8 Phase 4)
│   │
│   ├── hooks/
│   │   ├── useSupabaseQuery.ts         # Generic hooks: useTable, useInsert, useUpdate, useDelete
│   │   ├── useSafeMutation.ts          # Mutation wrapper with offline queue support
│   │   └── useIsMobileDevice.ts        # detectMobileDevice()/useIsMobileDevice() — UA regex OR narrow-width+coarse-pointer, reactive. Single source of truth for the mobile hard lock (Batch 8 Phase 1)
│   │
│   ├── components/
│   │   ├── ui/                         # shadcn/ui primitives — regenerate via CLI, do not edit directly
│   │   ├── Layout.tsx                  # Desktop shell: RTL sidebar (right) + main content
│   │   ├── RequireRole.tsx             # Route guard — checks profile.role
│   │   ├── TransactionDialog.tsx       # Add/edit transaction (dynamic fields from ServiceType)
│   │   ├── AgreementUploader.tsx       # PDF upload + extract-agreement edge function
│   │   ├── BonusWidget.tsx             # Compact per-employee bonus card (current month, actual + תחזית) on AdminDashboard — mounted there since Repair 16 (previously built but never wired in anywhere)
│   │   ├── ClientPicker.tsx            # Autocomplete client selector
│   │   ├── SortableHead.tsx            # Shared sortable <TableHead> + SortState/toggleSortKey/compareBySort (Repair 8)
│   │   ├── LabeledToggle.tsx           # Labeled switch/toggle
│   │   ├── MobileAutoRoute.tsx         # Mobile hard lock: redirects any mobile device to /m on every navigation (re-evaluates via useIsMobileDevice, no one-shot guard, no bhr_force_desktop opt-out — Batch 8 Phase 1)
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
│   │   ├── Reports.tsx                 # Admin-only דוחות section — currently one report (דוח גיוסים): KPIs + לפי מוביל/לקוח/משרה breakdowns with drill-down + Excel export (Batch 8 Phase 4)
│   │   ├── Bonuses.tsx                 # Per-employee card: actual vs. forecast stats, two-layer progress bar, sortable per-month deals table (click a row → TransactionDialog), stacked 12-month chart (Repair 16 — tier table removed, moved to Team only)
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
│   │   ├── impersonate-user/index.ts   # Edge function: admin generates one-time magiclink to log in AS a target user ("התחבר בתור"). ✅ DEPLOYED 2026-06-01 via the Supabase dashboard in-browser editor, back when `SUPABASE_ACCESS_TOKEN` was expired (verified: it now works, HTTP 200 — see the standing rule at the top of this file; deploy via CLI/Management API normally). verify_jwt=true.
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
│       ├── 20260601_attendance_edit_requests.sql    # Feature: Attendance V2 — attendance_edit_requests table + RLS (insert/select own, admin update)
│       ├── 20260712_atomic_save_transaction.sql     # Fix: save_transaction_with_events() SECURITY DEFINER RPC — atomic transaction+billing_events save (see Billing Events § Persistence)
│       ├── 20260913_due_date.sql                    # Feature: Expected Payment Date — billing_events.due_date/due_date_is_manual, trigger-maintained, retroactive backfill
│       ├── 20260913_2_due_date_freeze_paid.sql       # Same-day fix: freeze due_date against auto-recompute once an event is paid/cancelled (see Phase History)
│       ├── 20261003_hours_billing_rpc.sql            # Repair 15: save_transaction_with_events gains period_start/period_end/hours_total/hourly_rate_used; retroactive backfill
│       ├── 20261003_collection_model.sql             # Repair 17: billing_events.invoice_date (real חשבון עסקה date, distinct from the planned billing_date); due_date from COALESCE(invoice_date, billing_date) — superseded by Repair 19, invoice_date only; drops 4 dead transactions columns
│       ├── 20261004_payment_terms_integrity.sql      # Repair 18: due_date never invented — SECURITY DEFINER fix + strict terms parser (NULL, never a 30-day default)
│       ├── 20261006_business_days_and_event_index.sql # Repair 19: two-shape payment terms (eom/business — מיידי = 5 business days Sun-Thu), invoice_date-only due_date basis, event_index unique constraint
│       └── 20261006_2_drop_billing_percent.sql       # Repair 19: drops the dead transactions.billing_percent column
│
├── scripts/
│   └── generate-icons.mjs              # PWA icon generation
│
├── public/                             # Static assets + PWA icons
├── EMPLOYEE_MOBILE_INSTALL_GUIDE.md    # iPhone PWA install guide for team (Hebrew)
├── vite.config.ts
├── components.json                     # shadcn/ui config
├── vercel.json                         # SPA rewrite rules
├── package.json
└── .env.local                          # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (never commit)
```

**Prompts directory** (sibling of App Dev, at `C:\Users\Oren\BHR Console\prompts\`):
- Active Claude Code prompts follow the pattern `repair{N}-*.md` or `feature-*.md`
- Completed prompts are deleted after the task is live (full history: `DOCS/PHASE-HISTORY.md`)
- **`prompts/` is empty — this is the normal resting state** (verified: 2026-10-06). A prompt file that survives its own phase is a bug: delete it as the final step of every phase, right after it's live and verified. (`cleanup-d141e376-billing-event.md`, once listed here as a pending open item, was deleted 2026-10-06 — it encoded a destructive instruction derived from a stale reading of the d141e376 transaction; see Billing Events → event_index integrity below for what that transaction actually is.)

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
| `/reports` | Reports (דוח גיוסים) | admin |
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
  ⚠️ DEPRECATED — DO NOT WRITE. verified 2026-10-06: table exists, 0 rows
  (always has — not "legacy data", there never was any). The only code that
  reads it (`getClients`/`getClientById` in `lib/clients.ts`, via a join,
  feeding the `ClientWithAgreement`/`Agreement` types) has zero callers
  anywhere in the app — dead code reading a dead table. Recommend DROPPING
  the table and deleting `getClients`/`getClientById`/`ClientWithAgreement`/
  `Agreement` — nothing would break (grep-confirmed zero call sites); not
  executed this phase since Repair 19 only explicitly authorized dropping
  `billing_percent`. The real, actively-used client-agreement feature is
  unrelated: the `client-agreements` Storage bucket + `AgreementUploader.tsx`
  + the `extract-agreement` edge function — do not confuse the two.

transactions
  id uuid PK
  kind text CHECK IN ('service', 'time_period')
  client_id uuid → clients
  client_name text NOT NULL
  position_name text
  candidate_name text
  service_type text
  service_type_id uuid → service_types
  custom_fields jsonb DEFAULT '{}'      -- גיוס also carries final_salary, position_number, candidate_number: hardcoded TransactionDialog renders keyed off isGiyus, NOT entries in service_types.fields jsonb (Batch 8 Phase 2)
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
  work_start_date date
  warranty_end_date date
  period_start date
  period_end date
  hours_total numeric
  hourly_rate_used numeric
  time_sheet_pdf_path text
  notes text
  supplier_id uuid → suppliers
  supplier_percent numeric
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
  billing_date date                -- תאריך חיוב מתוכנן — the SYSTEM'S internal PLANNING field only, never shown as a document date (Repair 19 removed its last UI slot in TransactionDialog). Still drives the pending→to_bill transition and every "not yet invoiced" worklist. Set by generators only.
  invoice_date date                -- תאריך הפקה (relabelled from תאריך חיוב, Repair 19) — the REAL חשבון עסקה issue date, user-entered. Added 20261003_collection_model.sql (Repair 17). Defaults to today when invoice_number is entered with none set; cleared together with invoice_number.
  status text CHECK IN ('pending', 'to_bill', 'billed', 'paid', 'cancelled')
  invoice_number text              -- חשבון עסקה number (entered manually)
  payment_date date                -- תאריך תשלום (relabelled from תאריך תשלום בפועל, Repair 19) — ACTUAL receipt date only (when money arrived). Auto-set to today when receipt_number is entered and it was empty. Repair 17: must be NULL on every non-paid row — enforced by buildBillingEventPatch() going forward.
  due_date date                    -- תאריך תשלום צפוי (relabelled from תאריך פירעון, Repair 19) — EXPECTED payment date, trigger-maintained from invoice_date ONLY (Repair 19, Part B3.1 — no more COALESCE with billing_date: before a חשבון עסקה is issued there is no expected payment date, full stop). See below.
  due_date_is_manual bool DEFAULT false  -- true = an admin typed an explicit due_date override; the trigger leaves it alone until reset. Added 20260913_due_date.sql.
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

### Collection model — confirmed by Oren 2026-10-03 (Repair 17)

Oren's own description of the real process: *"אני שולח חשבונות עסקה ללקוחות
כדרישת תשלום. הם נשלחים ממערכת הנהח"ש ומתועדים כאן כחשבון עסקה עם תאריך —
זה המועד שבו נשלח החשבון אל הלקוח כדרישת תשלום. לכל לקוח יש תנאי תשלום
(שוטף, שוטף + 30 וכד). תאריך פרעון נגזר ממועד החיוב ותנאי התשלום. כשלקוח
משלם, יוצאת חשבונית מס קבלה שמתועדת במערכת עם מספר ותאריך — זה מועד תשלום
בפועל."*

**Field model — current (Repair 19, 2026-10-06, Part B).** Two documents,
each a number **and** date set/cleared together, plus one derived date, plus
one internal-only system field with no UI slot in TransactionDialog:

| Column | Hebrew label (current) | Hebrew label (before Repair 19) | Meaning | Set by |
|---|---|---|---|---|
| `billing_date` | *(no UI label — internal only)* | תאריך חיוב מתוכנן | the system's internal PLAN — when the generator expects to invoice (end of hours month; last הדרכה execution date; `work_start_date` + split days; `entry_date` for the advance). Still drives the pending→to_bill transition, BillingReports' own תאריך חיוב מתוכנן column, and every "not yet invoiced" worklist — just no longer shown or editable inside TransactionDialog's billing-event block | generators only, never the real invoice date |
| `invoice_number` + `invoice_date` | **מספר חשבון עסקה** + **תאריך הפקה** | מספר חשבון עסקה + תאריך חיוב | the REAL חשבון עסקה — when the invoice was actually issued | user, via TransactionDialog / BillingReports |
| `due_date` | **תאריך תשלום צפוי** | תאריך פירעון | expected payment date, derived from `invoice_date` ONLY (Part B3.1 — no `billing_date` fallback: before a חשבון עסקה is issued there is no expected payment date, full stop) + the client's payment-term shape (see "Payment terms" below) — **DB-trigger-maintained** | trigger (`bhr_billing_events_set_due_date`); can be manually overridden (`due_date_is_manual`) |
| `receipt_number` + `payment_date` | **מספר חשבונית מס קבלה** + **תאריך תשלום** | מספר חשבונית מס קבלה + תאריך תשלום בפועל | the REAL חשבונית מס קבלה — when money actually arrived | user |

Before Repair 19, `due_date` fell back to `billing_date` when no invoice
existed yet, so almost every open event carried a provisional expected date.
That fallback is gone: a not-yet-invoiced event now has **no** expected
payment date at all (NULL `due_date`) — this is the normal, common
lifecycle stage (טרם חויב), not an error, and every surface that shows
`due_date` has an explicit state for it (see `DueDateCell`'s `hasBasis`
prop, and TransactionDialog's `notYetInvoiced` state) distinct from the
Repair 18 "terms missing" state.

**Document-pairing rule (§3.3):** a document's number and date are always
set and cleared together — entering `invoice_number`/`receipt_number` with
no existing date defaults that date to today (still editable after);
clearing the number also clears the date. `payment_date` is never editable
on a row with no `receipt_number`. The ONLY place that applies this rule
and computes `status` is `buildBillingEventPatch()` in
`src/lib/billingEvents.ts` — every save site (TransactionDialog's
`BillingEventRow`, BillingReports' `BillingEventDashRow`) must call it,
never set `status` or a paired date/number by hand.

**Status** (`computeEventStatus`, unchanged table, now the only writer):

| Stored value | Condition | UI bucket |
|---|---|---|
| `cancelled` | set manually; nothing overrides it | מבוטל |
| `paid` | `receipt_number` present | שולם |
| `billed` | `invoice_number` present, no receipt | ממתין לתשלום |
| `to_bill` | no invoice, transaction approved, `billing_date <= today` | טרם חויב (לחיוב עכשיו) |
| `pending` | no invoice, and (not approved OR `billing_date > today`) | טרם חויב |

⚠️ `computeEventStatus`'s `status === 'billed'` branch is a deliberate
one-way lock for ITS OTHER caller (event regeneration on save, which must
never downgrade an already-billed/paid row it has no fresh invoice_number
for) — `buildBillingEventPatch` resets to a neutral baseline before calling
it (except `cancelled`, kept sticky) specifically so that clearing an
invoice number on a billed row correctly demotes it, instead of staying
"billed" forever. Caught live during Repair 17 QA — if you ever touch
either function again, re-verify this interaction.

- `payment_date` must only ever be non-null on `paid` rows — before
  2026-09-13 it was overloaded to mean both expected and actual payment
  date (see Feature: Expected Payment Date below for why they were split);
  Repair 17 (2026-10-03) found and cleared 3 more leftover rows the
  due_date migration had backfilled `due_date` from but never cleared.
- **Dropped (2026-10-03, Repair 17; re-verified gone from the live schema
  2026-10-06):** `transactions.invoice_sent_date`, `payment_due_date`,
  `invoice_number_transaction`, `invoice_number_receipt` — zero references
  then, confirmed zero references and zero columns now.
- **Dropped (2026-10-06, Repair 19):** `transactions.billing_percent` — 0
  non-null rows anywhere, 0 functional code references (only the TS type
  declaration and a comment explicitly saying it wasn't used); this had
  been "noted as dead" since Batch 8 Phase 3 (2026-08-23) without ever
  being finished. `transactions.invoice_number` (singular, legacy) remains
  dead but undropped — a separate, still-open decision.

### Payment terms — two date shapes (Repair 19, 2026-10-06)

`payment_terms` on the client resolves to exactly one of two shapes, never
both — `bhr_payment_term_spec()` (SQL) / `parsePaymentTermSpec()` (TS, in
`src/lib/billingEvents.ts`) is the one parser for both:

| Shape | Vocabulary | Formula |
|---|---|---|
| `'eom'` | `שוטף` (0 days); `שוטף+30`, `שוטף + 30`, `שוטף30`, `שוטף 30`, `שוטף+30 יום` (30 days); a bare integer e.g. `30`, `45`, `60`, or `30 יום` (that many days) | end of the invoice_date's calendar month, + N calendar days |
| `'business'` | `מיידי`, `מידי`, `לתשלום מיידי`, `תשלום מיידי` (always 5 days) | invoice_date + N **business days**, Sunday–Thursday (Israeli work week) |

All vocabulary matching strips whitespace first, so `שוטף + 30` and
`שוטף30` are the same input. Anything else (e.g. a client's terms field
containing free text that matches none of the above) → shape `NULL` → no
usable terms → `due_date` stays NULL, never a guess (Repair 18's rule,
unchanged — this is the `bhr_payment_term_days_strict(...)  IS NULL` / shape
`IS NULL` audit condition).

**Oren, 2026-10-06, on `מיידי`:** *"לתשלום מיידי אומר שהתשלום יתקבל בתוך 5
ימי עסקים."* Worked example that must hold: invoice_date Wed 2026-10-07 → +5
business days (Thu 8th, Sun 11th, Mon 12th, Tue 13th, Wed 14th) → due
**2026-10-14**.

⚠️ **Known, dated limitation (2026-10-06): Israeli public holidays are NOT
handled.** A holiday falling inside the 5-business-day window still counts
as a business day — `bhr_add_business_days()` / `addBusinessDays()` only
know Sunday–Thursday vs. Friday/Saturday. Do not build a holiday calendar
without a fresh decision from Oren; this is an accepted gap, not a bug to
silently "fix" by guessing which days are holidays.

**`'eom'` example:** invoice_date = 11 May 2026, terms = שוטף+30 → 31 May + 30 = **30 June 2026** (unchanged since Repair 17/18).

Key functions in `src/lib/billingEvents.ts` (client-side PREVIEW only, shown live in TransactionDialog before a row is saved — `bhr_calc_due_date`/`bhr_payment_term_spec` in Postgres are the authoritative implementation that actually persists `due_date`; keep both in lockstep, same matched-pair discipline as Repair 18):
- `parsePaymentTermSpec(terms)` → `{ shape: 'eom' | 'business', days: number } | null`
- `calculateTaxInvoiceDate(invoiceDate, spec)` → applies whichever formula `spec.shape` selects
- `addBusinessDays(iso, days)` → the `'business'` shape's primitive

`bhr_payment_term_days_strict(terms)` (SQL) still exists as a days-only
convenience wrapper for ad-hoc audits (`IS NULL` = unrecognised terms) — it
drops the shape, so never use it for actual date math.

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

**Advance (מקדמה) — since Batch 8 Phase 3.** The advance is a PART OF THE
COMMISSION, never a percentage of gross salary: `resolveAdvanceAmount()`
computes `totalCommission = salary × commissionPercent/100` first, then
applies the fixed/percent advance to that (capped at the total commission
either way). For גיוס specifically, the advance is generated **instantly**
from `entry_date` (תאריך פתיחה) the moment the client has an advance
configured — it does not wait for `work_start_date` like the split events
do. `generateServiceBillingEvents()`'s `workStartDate` param is
`string | null`: when `null` (no work-start date yet), only the advance
event is emitted (event_index 1, `billing_date = advanceBillingDate ??
workStartDate`) and split generation is skipped entirely. Once a
work-start date is added, the next save takes the **full regeneration
path** (not the reconcile-final-salary path) so the advance is re-emitted
at index 1 alongside the newly-computable splits at 2+ — the RPC's
delete-then-insert of pending/to_bill rows means this never produces a
duplicate index-1 row.

**Time-period (hours billing) transactions — rule fixed by Repair 15 (2026-10-03).**
Single event generated by `generateTimePeriodBillingEvent()`, wired into
`TransactionDialog.handleSave` as its own `canGenerateTimePeriod` track (same
carry-forward-manual-survivors / locked-event-warning pattern as הדרכה) AND
into `MyHoursView`'s `hoursBillingMut` (the "הפק חיוב שעות" button — see
below, both paths now call the same generator):
- `amount` = `hours_total × hourly_rate_used`
- `billing_date` = **the last calendar day of the month the report covers**
  (end of `periodEnd`, falling back to `periodStart`, then today) — Oren,
  2026-10-03: *"בהפקת דוח שעות, תאריך החיוב הוא היום האחרון של החודש שעבורו
  הופק הדו"ח. תנאי התשלום הם בהתאם לתנאי התשלום של הלקוח."* Payment terms
  are applied **only** by the `due_date` trigger on top of this — never
  baked into `billing_date` itself (the old code did `addDays(today,
  termDays)`, which double-counted the client's שוטף+X on top of the
  trigger's own שוטף+X). Same shape as the הדרכה rule (billed once
  delivered, `billing_date` = last execution date).

**הדרכה transactions — since Batch 8 Phase 5.** A single event generated by
`generateHadrachaBillingEvent()`, wired into `handleSave` as its own
`canGenerateHadracha` track (mutually exclusive with the גיוס advance/split
tracks — different service types can never both be true). `amount` reuses
the same live total the dialog already displays (`custom.price × number of
execution dates + travel`) — never recomputed separately, so the billed
amount can't drift from what's on screen. `billing_date` = the latest valid
`custom_fields.execution_dates[].date` (validated `^\d{4}-\d{2}-\d{2}$` —
malformed strings are ignored, not trusted), falling back to `entry_date`
when there are none yet. Returns no event at all when the computed amount
is ≤ 0 (an empty/half-filled form never creates a ₪0 row). Regenerates on
every save like the גיוס tracks; a manually-added event (`+ הוסף אירוע`,
always at `event_index` ≥ 2) that hasn't progressed past `pending`/`to_bill`
is carried forward unchanged into the same save's `p_events` so the RPC's
delete-then-insert doesn't wipe it — the RPC deletes by **status**, not by
index, so anything not explicitly re-included in `p_events` is lost. An
already-`billed`/`paid` event is left untouched by the RPC's occupied-index
skip; if the recomputed amount would have differed, `handleSave` shows a
Hebrew warning instead of silently diverging.

### Approval gate
- Transactions with `needs_approval = true` and no `approved_at` are greyed out (opacity-50)
- Billing events for unapproved transactions stay `pending` regardless of billing_date
- Approved = `approved_at IS NOT NULL`

### Management permissions

Billing-event *management* — the "+ הוסף אירוע" manual-add button in
`TransactionDialog.tsx` — is available to **admin and administration**
(`canManageBillingEvents`, since Batch 8 Phase 5). Inline row edits
(`saveField`/`handleDelete` on `BillingEventRow`) were already ungated in
the UI and are RLS-governed regardless. `billing_events` RLS
(`administration_billing_events_all`, `20260509_phase2_transactions.sql`)
has always permitted `administration` full read/write — the button gate
was frontend-only (`isAdmin`) until Phase 5; no migration was ever needed.
Recruiters are excluded from management (their `billing_events` policy is
SELECT-only via `recruiter_billing_events_read`) — exposing the button to
them would only produce a confusing RLS failure.

### Persistence: atomic save RPC (since 2026-07-13, see Phase History)

Neither `TransactionDialog.handleSave` nor `MyHoursView`'s `hoursBillingMut`
(the "הפק חיוב שעות" button) writes `transactions`/`billing_events` directly —
**every transaction write in the app goes through this one RPC**, no
exceptions. Each computes the billing-events draft(s) client-side (unchanged —
`generateServiceBillingEvents`/`reconcileFinalSalaryBillingEvents`/
`generateTimePeriodBillingEvent` above) and sends them, alongside the
transaction payload, to a single RPC: `supabase.rpc('save_transaction_with_events',
{ p_mode, p_id, p_payload, p_events, p_flip_to_bill, p_work_end_date })`
(migration `20260712_atomic_save_transaction.sql`, extended by
`20261003_hours_billing_rpc.sql`).
The RPC is `SECURITY DEFINER` and re-implements the `transactions_full_access` authorization
rule itself (admin/administration, or `service_lead` matches the caller) — it must be updated
in lockstep with that RLS policy if the policy ever changes. It performs the transaction
insert/update, the billing-events upsert (mirrors `upsertBillingEvents()` — deletes only
pending/to_bill rows, never billed/paid/cancelled), the past-due pending→to_bill flip, and the
work-end-date cancel-future step all in one DB transaction, so a stall or error partway through
can never leave an orphan transaction row without its billing events.

⚠️ **Any NEW column added to `transactions` or `billing_events` must be added
to the RPC's explicit column list in the SAME change** (both the `update`
`case when p_payload ? '...'` branch and the `insert` values list) — it will
otherwise be silently dropped on every save, not written, with no error.
This has now happened **twice**: `period_start`/`period_end`/`hours_total`/
`hourly_rate_used` were added to `transactions` in `20260422_refinements_batch3.sql`
but never added to the RPC until `20261003_hours_billing_rpc.sql` (Repair 15,
2026-10-03) — every hours transaction saved through the dialog silently lost
them for over two months. Treat this as a standing checklist item whenever a
column is added to either table.

---

## Bonus Engine — Business Logic (Repair 16, 2026-10-03)

`src/lib/bonus.ts` is the **single source of truth** for every bonus number in
the app — Bonuses.tsx, RecruiterDashboard.tsx, and BonusWidget.tsx all call
the same `fetchBonusEvents()`/`buildBonusLedger()` pair; there is no other
bonus calculation anywhere. (Before this phase there were three independent,
disagreeing engines — see the Repair 16 Phase History row for the full
diagnosis.)

**Actual (בפועל):** revenue = net (`amount − supplier_amount`) of
`billing_events.status = 'paid'`, for approved transactions, where the
employee is the מוביל (`transactions.service_lead`, matched via
`normalizeLead()`). Month attribution = **`payment_date`** (falls back to
`due_date`, then `billing_date`, for legacy rows with no `payment_date`).
Oren, 2026-10-03: *"בונוס משולם לפי התאריך שבו התקבל הכסף בפועל ... אם
התקבל תשלום ב-1/9, הסכום לבונוס ישולם כבר במשכורת ספטמבר"* — payroll cuts
off at month-end, so 31/08 is an August bonus and 01/09 is September. This
**reverses** the 2026-09-13 `due_date`-based rule (D5) — see the
Architectural Decisions note above.

**Forecast (תחזית):** forecast revenue for month M = actual paid revenue in
M + expected revenue in M, where expected = net of every **open** event
(`status IN ('pending','to_bill','billed')`, approved transactions only)
whose `due_date` falls in M — **no `billing_date` fallback** (Repair 18,
unchanged by Repair 19, though Repair 19's Part B3.1 change massively
widened how often `due_date` is NULL — see below). An open event dated
**before the first day of the current month** is rolled forward into the
**current month** and flagged `overdue` — it can still only be paid now or
later, so leaving it stranded in a closed past month would hide it.
**Past months are closed:** forecast = actual there (no open event can ever
land in a past month after the roll-forward). Month keys are always derived
from the `'YYYY-MM-DD'` date **string** (`.slice(0, 7)`), never
`new Date(...).getMonth()`, to avoid timezone drift miscategorizing a
payment on the 1st.

**Excluded-from-forecast events (Repair 18 + 19):** an open event with no
`due_date` is excluded from every month's forecast (`monthKey` stays null)
but still returned (`excludedFromForecast: true`), so `Bonuses.tsx` can
report the total instead of letting it silently vanish. `excludedReason`
distinguishes why: `'terms_missing'` (a חשבון עסקה was issued but the
client's payment terms are missing/unparseable — Repair 18, the original,
narrower case) vs. `'not_invoiced'` (no חשבון עסקה has been issued yet —
Repair 19, Part B3.1; this is now the OVERWHELMINGLY common reason, since
every ordinary open/not-yet-invoiced event has no `due_date` under the new
field model, not just terms-missing ones). `Bonuses.tsx` renders these as
two separate lines with different tones — a neutral "טרם נכלל בתחזית... טרם
הופק חשבון עסקה" for the normal case, and the original amber "תנאי תשלום
חסרים" line only for genuine terms problems. Never collapse these back into
one undifferentiated line — mislabeling routine not-yet-invoiced pipeline
as a payment-terms data problem is confusing and wrong.

Tier math (`calculateBonus`/`bonusBreakdown`, unchanged) is non-cumulative —
the bonus for a month is the highest tier whose `min ≤ revenue`; below the
first tier = **₪0** (fixes a real bug: `RecruiterDashboard`'s old
`calcBonusTier` fell back to the lowest tier's bonus via `?? sorted[0]` even
when revenue hadn't reached it). `actualForecastProgress()` is the one
two-layer progress-bar formula every surface uses (current/next tier always
chosen by ACTUAL revenue, never forecast).

Display rule (mandatory everywhere a bonus number appears): בפועל = solid
purple `#7c3aed`; תחזית = light purple `#c4b5fd`, always labelled "תחזית" —
never shown unlabelled.

⚠️ Interacts with the `due_date` trigger (Feature: Expected Payment Date):
an open event's `due_date` is whatever the trigger last computed from
`invoice_date` (Repair 19 — was `billing_date` before Part B3.1) + the
client's payment terms, not whatever a caller tried to
insert — confirmed live during QA when a hand-set `due_date` silently got
recomputed by the trigger and correctly shifted which month's forecast the
event landed in.

---

## MIRRORED_KEYS Pattern (TransactionDialog → DB)

These fields exist both in `custom_fields` jsonb AND as top-level DB columns. They are mirrored on save:

```
position_name, candidate_name, commission_percent, salary,
net_invoice_amount, commission_amount, service_lead
```

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
- **`agreements` table is deprecated** — do not write to it. 0 rows, 0 live callers (verified 2026-10-06) — see the Database Schema entry above for the drop recommendation.
- **Transaction kinds** — `service` (placements, HR work) and `time_period` (hourly billing). Fields are dynamic via `service_types` + `custom_fields` jsonb.
- **Mobile is a hard lock, not just hours-only** (Batch 8 Phase 1) — any device detected as mobile (`useIsMobileDevice()`: UA regex OR narrow-width+coarse-pointer) is redirected to `/m` on every navigation, enforced at both the `MobileAutoRoute` router effect and the `RequireRole` render boundary (so the desktop shell can't paint even one frame first). There is no opt-out by design — the old `bhr_force_desktop` localStorage escape hatch was removed entirely, not just hidden. `/m/*` itself is still scoped to hours entry + attendance + profile — no admin surfaces.
- **PWA** — standalone app, workbox NetworkFirst for Supabase API calls
- **Bonus model** — JSONB in `team_members` for flexibility
- **Billing events are the financial source of truth** — dashboards and bonus calculations should read from `billing_events`, not `transactions` legacy fields (Phase 3 migration pending)
- **Payment terms resolve to a shape + day count, never a bare integer** — parse with `parsePaymentTermSpec()` (TS) / `bhr_payment_term_spec()` (SQL); `'eom'` (שוטף/שוטף+N/bare integer) or `'business'` (מיידי = 5 business days, Sun-Thu) (Repair 19, 2026-10-06 — see Billing Events → Payment terms above).
- **`billing_events.due_date` = expected payment date (trigger-maintained), `payment_date` = actual receipt date — never conflate them again** (Feature: Expected Payment Date, 2026-09-13).
- **A `due_date` is only ever produced from payment terms the system can actually read and parse, from a חשבון עסקה that has actually been issued — never invented (Repair 18 + Repair 19, 2026-10-04/06).** NULL/missing terms, terms hidden by an RLS bug, terms that don't match a recognized shape, and a not-yet-issued חשבון עסקה (Part B3.1, Repair 19) must all collapse to the SAME `NULL` due_date, never to a guessed one — `?? 30`/`COALESCE(..., 30)` must never be reintroduced on the live path, and `due_date` must never fall back to `billing_date` (`bhr_payment_term_spec`/`bhr_calc_due_date` in SQL, `parsePaymentTermSpec`/`calculateTaxInvoiceDate` in `lib/billingEvents.ts` — a matched pair, change together). The reason: a silent default or fallback makes "no terms configured," "terms I can't see," "terms I can't parse," and "not yet invoiced" all indistinguishable from each other and from a real, committed date — exactly the bug that showed a real-looking תאריך פירעון on קסטרו's account when it had no payment terms at all. Every surface that reads `due_date` must have an explicit state for each of these (see `DueDateCell`'s `hasBasis` prop — invoice_date only, never `?? billing_date` — and TransactionDialog's `termsMissing`/`notYetInvoiced` states) instead of silently showing nothing or a wrong date.
- **Any trigger function that reads a second table must be `SECURITY DEFINER` or it will silently see less than the data owner does (Repair 18, 2026-10-04)** — general architecture trap, not specific to one function. RLS doesn't error when it filters a row out of a join; it just returns fewer rows. A trigger runs under the CALLING role unless the function is `SECURITY DEFINER`, so a trigger-context join to a table the caller doesn't have full RLS visibility into can silently return NULL/fewer rows for a perfectly valid, fully-populated row — with no error anywhere, only quietly wrong data. This is exactly what happened to `bhr_billing_event_payment_terms` (the `due_date` trigger's lookup of a transaction's client's terms): a recruiter's own trigger context couldn't see the client row, so terms that definitely existed looked NULL. Fixed by marking it `SECURITY DEFINER SET search_path = public`. When marking any function `SECURITY DEFINER`, also do an EXPLICIT `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` before re-granting only the roles that should call it — Supabase's schema-level default privileges can hand a function a *direct* grant to `anon`/`authenticated` at creation time, which a bare `REVOKE ALL FROM PUBLIC` does not strip.
- **`bhr_parse_payment_term_days` is DEPRECATED (Repair 18, 2026-10-04)** — kept only as a `COALESCE(bhr_payment_term_days_strict(terms), 30)` wrapper for callers not yet migrated off it. `bhr_payment_term_days_strict` itself (Repair 19, 2026-10-06) is now a derived, days-only view of `bhr_payment_term_spec` — fine for `IS NULL` audits, wrong for date math (drops the shape). Do not call either from new code that computes a date; use `bhr_payment_term_spec` (SQL) / `parsePaymentTermSpec` (TS) directly.
- **`(transaction_id, event_index)` is a DB-enforced unique constraint (Repair 19, 2026-10-06)** — `billing_events_transaction_event_index_unique`. Added after the 2026-10-04 full-database sweep found exactly one legitimate collision (אלדר השקעות's 30/70 split, never incremented past index 1) and confirmed it was the only one. `upsertBillingEvents`'s delete-then-insert already avoided writing into occupied indices defensively; this constraint makes a duplicate impossible to insert at all, from any path, rather than merely unlikely.
- **Bonus month attribution reversed back to `payment_date` (Repair 16, 2026-10-03)** — the 2026-09-13 `due_date`-based rule (D5, row above) was wrong per Oren: a bonus is paid with the salary for the month the money actually arrived, cut off at month-end (payment on 31/08 → August bonus; 01/09 → September). `due_date` is used ONLY for the forecast (expected revenue of still-open events) — see Repair 16's Phase History row and the "One Bonus Engine" note in the Billing Events section below.

---

## Phase History

Full detail for every phase (diagnosis, QA evidence, commits) lives in
**`DOCS/PHASE-HISTORY.md`** — read that file, not this index, before relying
on any historical detail. ⚠️ Numbering rule: each `Repair N` number is used
once — check the highest number already there before writing a new phase;
see `DOCS/PHASE-HISTORY.md`'s own header for the two times this was nearly
broken.

| Phase | One-line summary |
|---|---|
| Baseline → Phase 3 | Roles/RLS, service_types, suppliers, billing_reports, client financial fields, billing_events table, approval workflow, bonus engine v1 |
| `billing_percent` column | Added (later dropped — Repair 19, dead code) |
| Repair 1–14, Repair 5b, 5 (Complete) | Bug fixes: duplicate dates, billing event generation, payment-terms field, two-document billing UI, bonus accrual rules, password-reset loop, UI polish, filters/sorting, save-timeout abort coverage |
| Feature: Impersonation | Admin "התחבר בתור" one-time magiclink login-as |
| Feature: Attendance, Attendance V2 | Check-in/out log, pair display, edit requests, admin approval |
| Feature: Billing Events Engine | Advance as its own event, final_salary reconciliation, manual event add |
| Feature: Billing Reports Accuracy | לגבייה/חויב/שולם totals corrected, AdminDashboard payment-schedule widget |
| Feature: Attendance Admin | Edit both sides of a pair, weekday display, month filter |
| Feature: Approval Notification | Sidebar badge + AdminDashboard card for pending-approval transactions |
| Feature: Form Improvements | גיוס expected/final salary split, הדרכה multi-date billing |
| Fix: Save-Timeout Root Cause | auth.tsx reentrant-lock deadlock; one atomic `save_transaction_with_events` RPC |
| Feature: Mobile Redesign | `/m` landing page, bottom nav, hours/attendance redesign |
| Batch 8 Phase 1–5 | Mobile hard lock; השמה→גיוס merge; advance-as-%-of-commission fix; `/reports` (דוח גיוסים); מנהלה billing permission + הדרכה auto-generation |
| Feature: Expected Payment Date | `due_date`/`due_date_is_manual` columns, trigger-maintained, paid-row freeze |
| Repair 15: Hours Billing Fields | `save_transaction_with_events` gains period/hours columns; hours billing_date = end of report month |
| Repair 16: Bonus Engine | One engine (`bonus.ts`) replaces 3 disagreeing ones; actual=payment_date, forecast=due_date |
| Repair 17: Collection Model | `invoice_date` (real) vs `billing_date` (plan) split; `computeEventStatus` the only status writer; `CollectionForecastDialog` |
| Repair 18: Payment Terms Integrity | `due_date` never invented — SECURITY DEFINER fix + strict terms parser, NULL not 30 |
| Repair 19: מיידי Terms, event_index Integrity, Doc Truth Pass | Two-shape terms (eom/business, 5-business-day מיידי); due_date from invoice_date only (no billing_date fallback); event_index unique constraint; `billing_percent` dropped; this file split out of `CLAUDE.md` |

