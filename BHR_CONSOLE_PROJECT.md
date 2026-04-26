# BHR Console — Project Brief (v7)

> **Claude Code Instructions**: Before making any changes, read this entire file.
> After every change, follow the **Mandatory Development Workflow** section — build, QA, commit, push, verify deployment.
>
> Admin authentication uses the **magic-link flow** (see Auth Flow below). There is no
> shared admin password. Autonomous runs generate a one-shot link via the Supabase
> Admin API — see `CLAUDE_CODE_AUTONOMOUS.md`.

## Overview
**BHR Console** is an HR consulting financial management system for Banani HR.
Migration from BASE44 to a professional stack. Built from scratch — no data migration.

---

## ⚠️ Mandatory Development Workflow — Every Change Without Exception

After **every** code change, Claude Code MUST complete all steps below in order.
**Skipping any step is not permitted.** Changes that are not pushed to GitHub are not deployed and have no effect.

### Step 1 — Build & Type Check
```bash
npm run build
```
- Must complete with **zero errors**
- TypeScript errors are blocking — fix before proceeding
- Warnings are acceptable but should be noted

### Step 2 — QA Checklist
Before committing, verify the following manually or via dev server (`npm run dev`):

| Area | Check |
|------|-------|
| **Changed feature** | Does it behave as expected? |
| **Adjacent features** | Did the change break anything nearby? |
| **RTL layout** | Is Hebrew text and layout direction intact? |
| **Auth** | Admin login still works |
| **Console errors** | No new errors in browser console |
| **Supabase queries** | No RLS errors, data loads correctly |

If any check fails → **fix the issue and restart from Step 1**.

### Step 3 — Commit & Push to GitHub
```bash
git add .
git commit -m "<concise description of what changed>"
git push origin main
```
- Commit message must describe the actual change (not "fix" or "update")
- Example: `"Add closing month filter to transactions table"`

### Step 4 — Verify Deployment on Vercel
- GitHub → Vercel auto-deploy **is active** (confirmed). Every push to `main` triggers a deploy automatically.
- **Do not wait a fixed number of seconds.** Poll the Vercel API:
  ```bash
  # PROJECT_ID = prj_rmCrlbOpuVLP6XPiPTOwYBlq0Smz
  curl -sS "https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&limit=1" \
    -H "Authorization: Bearer $VERCEL_TOKEN"
  ```
  Extract `deployments[0].state` and loop every 10 seconds until it is
  `READY`. Timeout after 5 minutes. If it becomes `ERROR` or `CANCELED`,
  fetch `/v3/deployments/<id>/events`, diagnose the build failure, fix
  the code, and try again. "Waited 90 seconds" is NOT proof of a
  successful build and must never be accepted as done.
- Only once `state=READY` and the deployed commit SHA matches the SHA
  you just pushed, open https://app.banani-hr.com (legacy:
  https://bhr-console.vercel.app) and verify the feature in production.
- **Do not report the task as complete until the live URL has been verified**

> ⚠️ A task is only DONE when: (1) build passes, (2) QA passes locally, (3) code is on GitHub, (4) Vercel shows the change live.
> Stopping after step 1 or 2 means the user sees nothing. All 4 steps are mandatory.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + TypeScript + TailwindCSS + shadcn/ui |
| State / Data | @tanstack/react-query + Supabase client |
| Router | react-router-dom v6 |
| Database | Supabase (Postgres) — project `szunbwkmldepkwpxojma` (Frankfurt) |
| Auth | Supabase Auth — email/password + invite via edge function |
| Email | Resend (invite emails via HTTP API) |
| Edge Functions | Supabase Edge Functions (Deno) |
| Hosting | Vercel — https://app.banani-hr.com (legacy: https://bhr-console.vercel.app) |
| Repo | github.com/banani-oren/bhr-console |

---

## Environment Variables

### `.env.local` (frontend, gitignored)
```env
VITE_SUPABASE_URL=https://szunbwkmldepkwpxojma.supabase.co
VITE_SUPABASE_ANON_KEY=<from Supabase API Settings>
SUPABASE_ACCESS_TOKEN=sbp_<...>   # Management API (for CLI)
SUPABASE_SERVICE_ROLE_KEY=<...>   # Server-side only, never in frontend
VERCEL_TOKEN=vcp_<...>
RESEND_API_KEY=re_<...>
```

### Vercel Environment Variables (set via API)
- `VITE_SUPABASE_URL` — production, preview, development
- `VITE_SUPABASE_ANON_KEY` — production, preview, development
- `VITE_SITE_URL` — `https://app.banani-hr.com` (production, preview, development)
- `RESEND_API_KEY` — production, preview (sensitive)

### Supabase Edge Function Secrets
- `RESEND_API_KEY` — set via `supabase secrets set`
- `ANTHROPIC_API_KEY` — set via Management API (`extract-agreement`)
- `PUBLIC_SITE_URL` / `VITE_SITE_URL` — `https://app.banani-hr.com` (used by
  `invite-user` to build the `/set-password` redirect in the invite email)

---

## Architecture — Unified User Model

**`profiles` is the single source of truth** for all users (admin, administration, recruiter).
There is no separate `team_members` table — all non-admin data lives on `profiles`.

- `profiles.id` references `auth.users.id` (1:1)
- A database trigger (`handle_new_user`) auto-creates a `profiles` row on auth-user insert, defaulting `role='recruiter'` and `password_set=false`
- `/team` page queries `profiles WHERE role IN ('recruiter','administration')`
- `/users` page queries all `profiles` (admin only — RLS blocks non-admins from seeing other rows)
- There are no portal tokens and no portal route

---

## User Roles (three-role model — admin is also an employee, v9)

Roles are persisted in `profiles.role`, constrained to `{admin, administration, recruiter}`.
`role` describes ACCESS, not identity: every role participates in employee
features (appearing on `/team`, having a `bonus_model`, logging hours on
permitted clients, having a personal productivity view). `admin` simply layers
full system access on top of the employee identity.

Route access is enforced by `<RequireRole allow={...}>` in the frontend AND by
role-aware RLS at the database level (defense in depth).

| Page / resource | admin | administration | recruiter |
|-----------------|:-----:|:--------------:|:---------:|
| `/` (Dashboard) | ✅ (admin KPI view) | ✅ (collections view) | ✅ (bonus-progress view) |
| `/profile` | ✅ | ✅ | ✅ |
| `/clients` | ✅ | ✅ | ❌ |
| `/transactions` | ✅ (all) | ✅ (all) | ✅ (own only — `service_lead = my full_name`) |
| `/hours` | ✅ (all, per-client tabs) | ✅ (own only, personal view) | ✅ (own only, personal view) |
| `/team` | ✅ | ❌ | ❌ |
| `/users` (invite / reset / delete) | ✅ | ❌ | ❌ |

Default landing after `/login`:
- `admin` → `/`
- `administration` → `/transactions`
- `recruiter` → `/transactions`

### Admin (`bananioren@gmail.com`)
- Full access to all pages and data.
- Manages users (invite, reset password, delete) and configures bonus models.
- Auth user ID: `03b73b4f-8f09-4bf1-9c22-f49b2b05f363`.

### Administration
- Manages clients (full) and sees the full transactions list.
- Logs personal hours (own `hours_log` rows only, personal view — no admin tabs layout).

### Recruiter
- Sees only the transactions where `service_lead = profiles.full_name`.
- Logs personal hours (own `hours_log` rows only).
- Has no access to clients, team, users, or the dashboard.

**The `/portal` route and `profiles.portal_token` are removed.** Non-admin users
now log in with email + password like any other user. The previous invite-link
bypass (a Supabase invite URL silently set an authenticated session that all
`ProtectedRoute`-wrapped admin pages honored) is closed by: (a) routing invite
links to `/set-password` instead of the app, (b) requiring `profiles.password_set = true`
before `RequireRole` will render any authenticated page, and (c) role-aware RLS
ensuring that even a compromised frontend cannot read rows the role should not see.

---

## Database Schema

```sql
-- profiles: single source of truth for all users (admin, administration, recruiter)
-- bonus_model stores the full tiered bonus structure as JSONB (see Bonus Model section)
create table profiles (
  id uuid references auth.users primary key,
  full_name text not null,
  email text,
  role text not null check (role in ('admin', 'administration', 'recruiter')),
  password_set boolean not null default false,          -- must be true before any app chrome renders
  bonus_model jsonb,                                    -- null = no bonus configured
  -- bonus_model shape: { type: 'flat', filter: { field, contains }, tiers: [{ min, bonus }] }
  hours_category_enabled boolean default false,         -- enables BHR/איגוד category split
  portal_token text unique default gen_random_uuid()::text, -- DEPRECATED (portal removed); column kept only so legacy data is not dropped
  phone text,
  status text default 'פעיל',
  created_at timestamptz default now()
);

-- clients: unified table — client details AND agreement terms in one place.
-- ⚠️ There is no separate agreements page or nav item. All data lives on the client record.
-- Source sheets: 'פרטי לקוחות' + 'תנאי הסכמים' + 'כרטיסי לקוחות' from the Excel file.
create table clients (
  id uuid primary key default gen_random_uuid(),

  -- Basic identity (from 'פרטי לקוחות'):
  name text not null,                                -- שם העסק
  company_id text,                                   -- ח.פ. / מספר עסק
  address text,                                      -- כתובת
  status text default 'פעיל',                        -- פעיל / לא פעיל

  -- Single contact per client (name, phone, email — one set only):
  contact_name text,                                 -- שם איש הקשר
  phone text,                                        -- נייד
  email text,                                        -- דואל

  -- Agreement terms (from 'תנאי הסכמים' — managed in client edit dialog):
  agreement_type text,                               -- סוג הסכם: 'השמה', 'הד האנטינג', 'גיוס מסה', 'הדרכה'
  commission_percent numeric,                        -- אחוז עמלה: 90, 100
  salary_basis text,                                 -- בסיס משכורות: e.g. '1 משכורות', '1.5 משכורות'
  warranty_days integer,                             -- תקופת אחריות: 30, 45, 60, 90
  payment_terms text,                                -- תנאי תשלום: e.g. 'שוטף+30'
  payment_split text,                                -- חלוקת תשלום: e.g. '30/70', null if not applicable
  advance text,                                      -- מקדמה: e.g. '30% מקדמה', '1,500 ₪'
  exclusivity boolean default false,                 -- בלעדיות
  agreement_file text,                               -- שם קובץ הסכם (PDF filename)
  agreement_storage_path text,                       -- <client_id>/<filename>.pdf within the client-agreements bucket (Phase F)
  hourly_rate numeric,                               -- תעריף שעת עבודה (Phase B / Phase E)
  time_log_enabled boolean not null default false,   -- הפעלת דיווח שעות ללקוח זה (Phase E)

  created_at timestamptz default now()
);

-- service_types: configurable service-type definitions + per-type field schemas (Phase C).
-- Seeded with 'השמה' (7 fields) and 'דיווח שעות' (4 fields).
-- admin: read+write. authenticated: read only. RLS enforced.
create table service_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_order integer not null default 0,
  fields jsonb not null default '[]'::jsonb,
  -- fields item shape: { key, label, type, required, width, options?, default? }
  -- type ∈ { text, textarea, number, currency, percent, date, month, year, select, boolean, employee }
  -- width ∈ { full, half }
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- client_time_log_permissions: admin-managed whitelist of who may log hours for a client (Phase E).
create table client_time_log_permissions (
  client_id uuid not null references clients(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, profile_id)
);

-- agreements table: DEPRECATED — kept in DB for legacy reference only.
-- All new agreement data is stored on the clients table above.
-- Do not write new code that reads from or writes to this table.
create table agreements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  client_name text,
  agreement_type text,
  commission_percent numeric,                        -- was incorrectly named commission_rate in older versions
  warranty_days integer,
  payment_terms text,
  payment_split text,
  advance numeric,
  exclusivity boolean default false,
  contact_name text,
  contact_email text,
  notes text,
  created_at timestamptz default now()
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'service'
    check (kind in ('service','time_period')),      -- Batch 3 Phase C
  client_name text,
  position_name text,
  candidate_name text,
  service_type text,                                 -- legacy string; still mirrored for filters
  service_type_id uuid references service_types(id),-- Phase D
  custom_fields jsonb not null default '{}'::jsonb,  -- per-service-type free-form values
  salary numeric,
  commission_percent numeric,
  net_invoice_amount numeric,
  commission_amount numeric,
  service_lead text,                                 -- references profiles.full_name
  entry_date date,
  billing_month integer,
  billing_year integer,
  close_date date,
  closing_month integer,
  closing_year integer,
  payment_date date,
  payment_status text default 'ממתין',
  is_billable boolean default true,
  invoice_number text,                               -- legacy; mirrored into invoice_number_transaction
  invoice_number_transaction text,                   -- Batch 3 Phase C
  invoice_number_receipt text,                       -- Batch 3 Phase C
  work_start_date date,                              -- Batch 3 Phase C
  warranty_end_date date,                            -- Batch 3 Phase C (derived from work_start + client.warranty_days)
  invoice_sent_date date,                            -- Batch 3 Phase C
  payment_due_date date,                             -- Batch 3 Phase C (derived from invoice_sent + client.payment_terms)
  period_start date,                                 -- Batch 3 Phase C (kind='time_period')
  period_end date,                                   -- Batch 3 Phase C (kind='time_period')
  hours_total numeric,                               -- Batch 3 Phase C (kind='time_period')
  hourly_rate_used numeric,                          -- Batch 3 Phase C (kind='time_period')
  time_sheet_pdf_path text,                          -- Batch 3 Phase E — Storage key in 'time-sheets' bucket
  notes text,
  created_at timestamptz default now()
);

create table hours_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id),          -- unified: links to profiles table
  team_member_id uuid,                               -- legacy column, ignore
  client_name text,
  client_id uuid references clients(id),             -- Batch 2 Phase E
  visit_date date,
  hours numeric,                                     -- computed from start_time/end_time when both present
  description text,
  hours_category text,                               -- 'BHR' or 'איגוד' (only if hours_category_enabled)
  start_time time,                                   -- Batch 2 Phase E
  end_time time,                                     -- Batch 2 Phase E
  billed_transaction_id uuid references transactions(id), -- Batch 3 Phase E — flips a row out of the unbilled queue
  month integer,
  year integer,
  created_at timestamptz default now()
);

-- billing_reports: per-client aggregation across kinds (Batch 3 Phase F).
-- admin + administration read/write via RLS; recruiter has no access.
create table billing_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  period_start date not null,
  period_end date not null,
  issued_at timestamptz not null default now(),
  issued_by uuid references profiles(id),
  transaction_ids uuid[] not null default '{}',
  total_amount numeric not null default 0,
  pdf_storage_path text,                            -- Storage key in 'billing-reports' bucket
  notes text
);
```

### Database Trigger — Auto-create Profile on Signup
```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role, password_set)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'recruiter'),
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### RLS helpers

Two SECURITY DEFINER helpers are installed so that role-aware policies can read the
caller's `profiles.role`/`profiles.full_name` without re-triggering RLS on `profiles`
(which previously caused `42P17 infinite recursion`).

```sql
create or replace function public.current_user_role() returns text
  language sql security definer stable set search_path = public
  as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.current_user_full_name() returns text
  language sql security definer stable set search_path = public
  as $$ select full_name from public.profiles where id = auth.uid() $$;
```

### RLS Policies (v8)

All policies target the `authenticated` role. No `anon` policies remain on any
domain table — the employee portal has been removed.

| Table | Policy | cmd | Predicate |
|-------|--------|-----|-----------|
| profiles | profiles_self_read | SELECT | `id = auth.uid() or current_user_role() = 'admin'` |
| profiles | profiles_self_update | UPDATE | `id = auth.uid() or current_user_role() = 'admin'` |
| profiles | profiles_admin_insert | INSERT | `current_user_role() = 'admin'` |
| profiles | profiles_admin_delete | DELETE | `current_user_role() = 'admin'` |
| clients | clients_admin_admin_full | ALL | `current_user_role() in ('admin','administration')` |
| agreements | agreements_admin_admin_full | ALL | `current_user_role() in ('admin','administration')` |
| transactions | transactions_full_access | ALL | `current_user_role() in ('admin','administration') or service_lead = current_user_full_name()` |
| hours_log | hours_self_access | ALL | `profile_id = auth.uid() or current_user_role() = 'admin'` |

---

## Application Pages

### Admin Interface

#### 1. `/` — Dashboard (role-aware)
`src/pages/Dashboard.tsx` is a thin dispatcher that renders one of three role-specific
components (`src/pages/dashboards/*.tsx`) based on `profile.role`.

**Admin dashboard** (`AdminDashboard.tsx`):
- KPI cards: total transactions, total revenue, billable %, open transactions
- Bar chart: monthly revenue (last 12 months)
- Donut chart: transactions by status
- Bar chart: revenue by service lead
- Table: recent transactions (last 10)

**Administration dashboard** (`AdministrationDashboard.tsx`):
- Hero: collections progress for the current calendar month — `collectedThisMonth / billedThisMonth` as a percentage bar with sub-label `₪A נגבו מתוך ₪B • עוד ₪C לגבייה`.
- KPI cards: `סכום לגבייה כעת`, `שחרגו מתאריך פירעון`, `נגבה החודש`, `ממתינים לחשבונית`.
- Aging donut: open amount bucketed `0–30 / 31–60 / 61–90 / 90+` days past due.
- 6-month collections bar chart.
- Top-10 overdue table (client, candidate, amount, dueDate, days-overdue).
- Overdue logic: `dueDate = close_date + parsePaymentTerms(payment_terms)` days, where `payment_terms` is looked up from `clients.payment_terms` via `client_name` (fallback 30 days). A row is overdue when `dueDate < today AND payment_date IS NULL`.

**Recruiter dashboard** (`RecruiterDashboard.tsx`):
- Hero: current-month bonus amount (flat tier) + horizontal progress bar between `currentTier.min` and `nextTier.min`, labelled `עוד ₪Y למדרגת ₪Z` or `הגעת למדרגה המקסימלית!` at max. If `profile.bonus_model` is null, the hero shows `המנהל עדיין לא הגדיר מודל בונוס`.
- Secondary KPI cards: `הכנסה החודש`, `עסקאות שנסגרו החודש`, `עסקאות פתוחות`.
- 6-month revenue bar chart (own revenue only — RLS enforces scope server-side).
- Recent-5 own-transactions table.

**Routing:** `/` uses `<RequireRole allow={['admin','administration','recruiter']}>` and the sidebar `דשבורד` link is visible to every role.

#### 1a. `/profile` — Self-service profile
- Editable `full_name` and `phone` on `profiles` (RLS restricts updates to the caller's own row).
- `שנה סיסמה` opens a dialog that calls `supabase.auth.updateUser({ password })`; shows `הסיסמה עודכנה ✓` on success.
- `AuthContext` exposes `refreshProfile()` so the sidebar footer picks up name/role changes on the next render without a full reload.
- Sidebar footer (in `Layout.tsx`) renders the user's `full_name` (fallback to email) and a Hebrew role label (`מנהל` / `מנהלה` / `רכז/ת גיוס`). The whole footer is a `<button>` that navigates to `/profile`.

#### 2. `/clients` — Clients + Agreements (unified page)

> ⚠️ **DESIGN DECISION — DO NOT CHANGE**: There is NO separate `/agreements` page and NO "הסכמים" sidebar nav item.
> Clients and their agreement terms are managed together on this single page. This is intentional.

**Client table:**
- Searchable table: name, contact, phone, status
- Add / Edit / Delete client
- **Import button**: upload Excel (.xlsx/.csv) → **diff preview** (new / updates / skipped) → confirm → apply
- Save handler: try-catch, success/error toast

**Excel import spec (Feature 3):**

| Excel header | DB column | Normalization |
|--------------|-----------|---------------|
| `שם העסק` | `name` | trim + collapse internal whitespace; required — empty rows surfaced under שגיאות |
| `שם איש הקשר` | `contact_name` | trim, nullable |
| `דואל` | `email` | trim + lowercase, nullable |
| `נייד` | `phone` | strip non-digits, preserve leading `0`, nullable |
| `מספר עסק` | `company_id` | strip whitespace, nullable |
| `כתובת` | `address` | trim, nullable |

- Dedup order: (1) exact case-insensitive `company_id` match, (2) collapsed-whitespace-lowercased `name` match, (3) otherwise new.
- **Non-overwrite rule:** only fields where the Excel value is non-empty **and** differs from the DB are included in the update payload. Agreement-term columns (`agreement_type`, `commission_percent`, `salary_basis`, `warranty_days`, `payment_terms`, `payment_split`, `advance`, `exclusivity`, `agreement_file`) are never touched by import.
- Preview dialog shows three sections — חדשים (green), עדכונים (amber, with a per-field diff table), שגיאות (red) — and a confirm button labelled `אשר ייבוא של N רשומות`. After commit, the toast reads `נוספו X • עודכנו Y • דולגו Z`.

**Agreement terms live inside the client edit dialog (not a separate page):**
- All fields: agreement type, commission %, salary basis, warranty days, payment terms, payment split, advance, exclusivity, agreement file
- Contact (single contact per client): name, phone, email — shown in the main client section of the dialog
- When a client is selected in a Transaction dialog → auto-fill: commission_percent, warranty_days, payment_terms, payment_split from the client record

#### 3. `/transactions` — Transactions
- Table columns: client, position, candidate, salary, commission %, service lead, entry date, closing date, net amount, supplier commission, billable toggle, invoice badge
- **6 filters**: entry month, closing month, service type, service lead, billable status, closing year
- Per-row billable toggle (immediate mutation with `.select()`)
- Green badge if invoice number set
- Add / Edit (full details in dialog)
- **Import button**: Excel import
- Save handler: try-catch, success/error toast

#### 4. `/hours` — Hours Log (rebuilt 2026-04-25)

`src/pages/hours/HoursPage.tsx` is the entry point. Three views:

- **`השעות שלי` (default for non-admin; first tab for admin)** —
  `MyHoursView`. Filter row: `<ClientPicker>` (placeholder
  `כל הלקוחות שלי`, predicate = clients in
  `client_time_log_permissions` ∩ `time_log_enabled = true`; for admins,
  every `time_log_enabled` client) + month/year selectors + a
  `+ הוסף דיווח` button (always visible). Table of
  `hours_log` rows scoped to `profile_id = auth.uid()` for the chosen
  month/year and (optionally) client. Footer total recomputes on
  add/edit/delete.
- **`ניהול שעות` (admin only)** — `ManageHoursView`. Filter row:
  `<ClientPicker filter={c => c.time_log_enabled}>` over ALL
  time-logged clients + month/year. When a client is selected the
  table shows every employee's hours for that client + month with an
  extra `עובד` column; `+ הוסף דיווח`, `סגור חודש`, and `הפק דוח שעות`
  buttons appear next to the filter. `סגור חודש` upserts a
  `service_type='ריטיינר'` transaction for the client+month with
  `net_invoice_amount = totalHours`.
- **`הפק דוח שעות` (admin only, dialog)** — `HoursReportDialog`.
  Picker (filter `time_log_enabled`), period (default first-of-month
  → today), optional employee multi-select. Renders a branded jspdf
  PDF. `צור עסקה מהדוח` opens `TransactionDialog` with
  `kind='time_period'` pre-filled.

The add-entry dialog (`HoursEntryDialog`) is shared by both views.
Wraps the insert/update via `useSafeMutation` with the standard 15 s
timeout. The first field is the same `<ClientPicker>` as the page;
clicking it (even with a value selected) re-opens the search dropdown
so the user can swap clients without first clearing.

#### 5. `/team` — Team (non-admin users)
- Admin-only page. Queries `profiles WHERE role IN ('recruiter','administration')`.
- Cards per user: name, email, role badge.
- Edit dialog: non-admin-specific fields only — `bonus_model`, `hours_category_enabled`.
- No add/delete here — new users are onboarded via `/users` (invite flow).
- Save goes to `profiles` with success/error toast and query invalidation.

#### 5a. `/services` — Service types (Admin only)

Admin-only CRUD surface for `service_types`. Each type carries a `name`,
`display_order`, and a JSONB `fields` array that drives the dynamic
`/transactions` wizard (Phase C). Seeded with:

- `השמה` (display_order=1) — 7 fields: `position_name`, `candidate_name`,
  `commission_percent`, `salary`, `net_invoice_amount`, `commission_amount`,
  `service_lead` — exactly the fields the old flat dialog had, so the
  existing `service_type='השמה'` flow doesn't regress.
- `דיווח שעות` (display_order=5) — 4 fields: `period_start`, `period_end`,
  `hours_total`, `hourly_rate` — used by the "צור עסקה מהדוח" action on
  `/hours/report`.

Field editor supports types `text`, `textarea`, `number`, `currency`,
`percent`, `date`, `month`, `year`, `select` (options as comma-separated
list), `boolean`, `employee` (combobox of `profiles WHERE role IN
('recruiter','administration')`), with half/full widths and a required
flag. Delete is blocked if any `transactions.service_type_id` references
the row.

#### 5b. `/hours/report` — Hourly-billing report (Admin only)

Branded A4 PDF generated client-side with `jspdf` + `jspdf-autotable`.
Admin picks client (only `time_log_enabled=true`), date range, and an
optional employee allow-list. Body is one row per `hours_log` entry
showing date, `start_time`→`end_time`, hours, description, employee.
Footer totals: hours · hourly_rate · ₪ total. "צור עסקה מהדוח" opens the
3-step wizard (Phase D) pre-seeded on step 3 with
`service_type='דיווח שעות'`, `period_start`/`period_end`, `hours_total`,
`hourly_rate`, `net_invoice_amount = hours_total * hourly_rate`, and
`close_date = period_end`.

#### 6. `/users` — User Management (Admin only, behind `<RequireRole allow={['admin']}>`)
- Columns: `אימייל`, `שם`, `תפקיד`, and a blank trailing actions column (no "פעולות" header).
- Inline Hebrew role dropdown per row in the `תפקיד` column; `admin→מנהל`, `administration→מנהלה`, `recruiter→רכז/ת גיוס`. Changing the selected value immediately updates `profiles.role` via Supabase and invalidates the `['profiles']` query.
- Trailing column has two icon buttons only: 🔑 reset password (`supabase.auth.resetPasswordForEmail`) and 🗑 delete user.
- **Delete** calls the `delete-user` edge function, which validates the caller's profile role is `admin` and then removes the `profiles` row and the `auth.users` row via service-role.
- **Self-guard:** on the admin's own row, the role dropdown and the delete icon are both disabled (you cannot demote or delete yourself).
- **Invite user**: calls `invite-user` edge function (unchanged); invite email links to `/set-password`.

---

### Personal Hours view (recruiter + administration)

There is no standalone employee-portal route. Recruiter and administration roles
log their own hours on `/hours` — the page branches by role:

- Admin: the tabs-per-client variant (seeds retainer transactions via "סגור חודש").
- Recruiter / administration: a single personal view — one table of the current month's own `hours_log` rows with the month/year selector and a "הוסף דיווח" form that writes a `hours_log` row with `profile_id = auth.uid()`. RLS guarantees they cannot read anyone else's entries.

---

## Bonus Model

### Data structure (stored in `profiles.bonus_model` as JSONB)

```json
{
  "type": "flat",
  "filter": {
    "field": "service_lead",
    "contains": "נועה"
  },
  "tiers": [
    { "min": 0,     "bonus": 0    },
    { "min": 10000, "bonus": 800  },
    { "min": 14000, "bonus": 1200 },
    { "min": 25000, "bonus": 2100 },
    { "min": 37000, "bonus": 3200 },
    { "min": 59000, "bonus": 4100 },
    { "min": 70000, "bonus": 5200 }
  ]
}
```

### Calculation logic (flat — NOT progressive)
The user receives the single flat bonus amount for the highest tier their monthly revenue reaches:
```
revenue = 30,000  →  bonus = 2,100  (reached ₪25,000 tier)
revenue = 70,000  →  bonus = 5,200  (reached ₪70,000 tier)
revenue = 9,000   →  bonus = 0      (below ₪10,000 threshold)
```

```ts
const calcBonus = (rev: number, tiers: {min: number, bonus: number}[]) => {
  const tier = [...tiers].reverse().find(t => rev >= t.min);
  return tier ? tier.bonus : 0;
};
```

### Bonus model editor (admin only — `/team` edit dialog):
- Revenue-filter shape: `{ field: 'service_lead', contains: '<name or fragment>' }`.
- Tiers table, 2 columns per row: **מינימום (₪)** and **בונוס (₪)** — no %, no rate, no max.
- Saved as JSONB on `profiles.bonus_model`.
- Downstream consumers compute the flat bonus with `calcBonus()` above. (There is no user-facing bonus tab in v8; bonus is surfaced to admins only.)

### Admin configures bonus model via `/team` edit dialog.
- Form shows only 2 columns per tier row: **מינימום (₪)** and **בונוס (₪)**
- No max, no percentage, no rate fields
- emptyTier: `{ min: 0, bonus: 0 }`

---

## Transaction dialog (v2 — Batch 3 Phase C)

The admin-facing `+ הוספת עסקה` dialog is a single-panel form
(`max-w-4xl`) with three cards:

1. **Kind pills** — dynamic `service_types` on the left and a visually-
   distinct amber `דיווח שעות` pill on the right representing
   `kind='time_period'` (not a service type). Services set `kind='service'`
   + `service_type_id`.
2. **Client autocomplete** — search by `name` or `company_id`, up to 10
   hits; selecting hydrates `commission_percent`, `warranty_days`,
   `payment_terms`, `hourly_rate` from the client record onto the form
   and surfaces them as a "מתוך פרטי הלקוח" hint.
3. **Three cards below:**
   - `שדות אוטומטיים` — `service_lead` (default: current user),
     `entry_date` (today), `close_date`, `payment_status` (`ממתין`),
     `is_billable` (true), `work_start_date`,
     `warranty_end_date` with a 🔄 re-derive button
     (`work_start_date + client.warranty_days`).
   - `שדות ייחודיים` — per-kind:
     - `kind='service'` → grid of `service_types.fields`. Derived fields
       (entries with a `derived` expression) recompute reactively and are
       rendered disabled with a 🔄 marker. Supported operators: `+ − × ÷`,
       parentheses, field refs (`salary`, `client.hourly_rate`, …), and
       `DATE + integer` addition (for warranty_end_date).
     - `kind='time_period'` → period start/end (default to this month
       with a quick-pick button), `hourly_rate_used` (pre-filled from
       client.hourly_rate with a divergence hint), an unbilled-hours
       preview table scoped to the selected client + period (and the
       current editing transaction) with per-row checkboxes. Selecting a
       row contributes to `hours_total` (auto-sum) and
       `net_invoice_amount = hours_total * hourly_rate_used` (computed,
       read-only).
   - `חשבונית ותשלום` — `invoice_number_transaction`, `invoice_number_receipt`,
     `invoice_sent_date`, `payment_due_date` (🔄 re-derives from
     `invoice_sent_date + parsePaymentTerms(client.payment_terms)`),
     `payment_date`, `notes`.

Universal fields continue to write to their dedicated columns. Custom
fields write to `transactions.custom_fields` keyed by field `key`. The
seven mirrored keys (`position_name`, `candidate_name`,
`commission_percent`, `salary`, `net_invoice_amount`,
`commission_amount`, `service_lead`) are also written to the existing
dedicated columns.

**On save for `kind='time_period'`:** all checked `hours_log` rows get
their `billed_transaction_id` set to the new transaction's id, so they
don't show up in the next bill's preview. On edit, unchecked rows get
their `billed_transaction_id` cleared.

The `/transactions` list gets a `סוג` column (purple badge `שירות` or
amber badge `שעות`), a `סוג` filter, and an additional `הפק דף שעות`
icon action per row for `kind='time_period'` rows. The service-type
column stays for services and shows `—` for time_period rows.

## Service types (Batch 3 Phase D)

`service_types` contains **only real services**, never time-based billing.
`דיווח שעות` and `מש"א במיקור חוץ` MUST NOT be present as service types —
time-based billing is `kind='time_period'` on `transactions`.

Canonical seeds (upserted by `supabase/migrations/20260422_refinements_batch3.sql`):

- `השמה` (placement, display_order=1, 10 fields) — position_number,
  position_name, candidate_name, salary, commission_percent,
  `commission_amount (derived: salary * commission_percent / 100)`,
  supplier_commission, supplier_name, work_start_date,
  `warranty_end_date (derived: work_start_date + client.warranty_days)`.
- `הד האנטינג` (head-hunting, display_order=2, 6 fields) — position_name,
  candidate_name, retainer_amount, success_fee, work_start_date,
  warranty_end_date (derived).
- `הדרכה` (training, display_order=3, 6 fields) — workshop_name,
  training_date, duration_hours, trainer, participants, price.
- `גיוס מסה` (mass recruiting, display_order=4, 4 fields) —
  campaign_name, candidate_count, fee_per_candidate,
  `total_fee (derived: candidate_count * fee_per_candidate)`.

The derived-field evaluator (`src/lib/serviceTypes.ts::evalDerived`)
supports numeric literals, `+ − × ÷`, parentheses, field refs into the
current row or the selected client, and date + integer addition (for
warranty_end_date). Unknown tokens resolve to `null`, which short-circuits
the derivation.

## Time-log & hourly billing (Batch 2 Phase E)

- `clients.time_log_enabled` + `client_time_log_permissions(client_id,
  profile_id)` gate who may log hours for each client. The clients edit
  dialog surfaces the toggle and a multi-select of eligible profiles
  (`role IN ('administration','recruiter')`); save wipes and re-inserts
  the permissions list for that client.
- `hours_log.start_time`/`end_time` are written from the add-entry form;
  `hours` is computed as `(end-start)/60` rounded to 2 decimals, kept in
  the existing `hours` column for backwards compatibility.
- Non-admin `/hours` becomes a client-picker-gated personal view (only
  clients where I am in `client_time_log_permissions` AND `time_log_enabled`).
- Admin `/hours` keeps the tabs-per-client layout and gains a
  "הפקת דוח שעות" button that routes to `/hours/report`.

## Billing reports (Batch 3 Phase F)

`/billing-reports` is an admin + administration page that consolidates
billable transactions per client per period into a single PDF the admin
sends to the client.

- Filter strip (client autocomplete + period from/to) → "הצג חיובים".
- Candidate rows: any `transactions` where `is_billable = true` AND
  (`kind='service'` with `close_date` or `entry_date` in the period, OR
  `kind='time_period'` with `period_end` in the period). Rows already
  included in a prior `billing_reports` row for this client are shown
  grayed out + disabled (de-dup by `transaction_ids`).
- "הפק דוח חיוב" inserts a `billing_reports` row, renders a branded A4
  PDF with a summary table + an expanded hours page per `kind='time_period'`
  item, uploads to Storage bucket `billing-reports/<report_id>.pdf`, and
  writes `pdf_storage_path`. Past reports list at the bottom with
  download buttons.
- RLS: admin + administration ALL via the `current_user_role()` helper;
  recruiter has no access.

## PDF agreement extraction (Batch 2 Phase F)

### Storage

Supabase Storage bucket `client-agreements` (private) with RLS:
- `SELECT` for `admin` + `administration`.
- `ALL` for `admin` only.
- Path convention: `client-agreements/<client_id>/<filename>.pdf`.
- `clients.agreement_storage_path` holds the object path.

### Edge function `extract-agreement`

`supabase/functions/extract-agreement/index.ts` + `prompt.md` (system
prompt, versioned). Model: `claude-sonnet-4-6` by default (override via
`AGREEMENT_EXTRACTION_MODEL` secret). Accepts `{ storage_path }`, service-
role downloads the PDF, base64-encodes it, and sends a single user
message containing a `document` content block (raw PDF) + a text block
with the extraction instruction — so scanned PDFs and text PDFs flow
through the same path and Hebrew RTL is handled natively by the API.
Response is parsed as JSON (code fences stripped), schema-coerced, and
reclassified `document_kind='other'` if `matched_client_name` is null
when `document_kind='agreement'`. Per-PDF token cost ≈ $0.015–$0.025 on
Sonnet 4.6.

Fuzzy match: Dice coefficient over character 3-grams against
`clients.name` (whitespace-stripped); top 3 with score > 0.6 returned.

### UX (`/clients`)

`העלה הסכמים` button opens a dialog that:
1. Lets the admin drop multiple PDFs.
2. Uploads each to `client-agreements/pending/<uuid>.pdf` and invokes
   `extract-agreement` in parallel.
3. Previews extracted fields per PDF with a match dropdown
   (auto-selected when top score > 0.85; otherwise lists the top fuzzy
   matches, a "create new client from PDF" option, and any other client
   as fallback).
4. Confirm moves the PDF to `<client_id>/<filename>.pdf`, updates
   `clients.agreement_storage_path` + `agreement_file`, and merges
   extracted agreement terms into the client — non-overwrite rule:
   only fills empty columns.
5. Skip / dialog-close cleans up `pending/*` temp files.

Client edit dialog exposes a `הורד PDF` button that generates a
60-second `storage.createSignedUrl` when `agreement_storage_path` is
set.

## Edge Functions

### `delete-user` (deployed)
**Path**: `supabase/functions/delete-user/index.ts`
**URL**: `https://szunbwkmldepkwpxojma.supabase.co/functions/v1/delete-user`

Flow:
1. Receives `{ user_id }` from the frontend (`/users` delete icon).
2. Reads the caller's JWT from the `Authorization` header, resolves their auth user, and rejects if their `profiles.role !== 'admin'`.
3. Rejects attempts to delete yourself.
4. Service-role deletes the `profiles` row, then calls `auth.admin.deleteUser(user_id)` so the auth user no longer exists.
5. Returns `{ success: true }`. The frontend invalidates the `['profiles']` query so the row disappears from `/users`.

### `extract-agreement` (deployed)
**Path**: `supabase/functions/extract-agreement/index.ts`
**URL**: `https://szunbwkmldepkwpxojma.supabase.co/functions/v1/extract-agreement`

Accepts `{ storage_path }`, downloads the PDF via service role, sends it
to Anthropic's Messages API as a base64 `document` content block with
the system prompt from `prompt.md`, parses + schema-validates the JSON
reply, fuzzy-matches the client name against `clients.name`, and returns
`{ extracted, document_kind, fuzzy_matches }`. Requires
`ANTHROPIC_API_KEY` secret. Default model `claude-sonnet-4-6`
(overridable with `AGREEMENT_EXTRACTION_MODEL`).

### `invite-user` (deployed)
**Path**: `supabase/functions/invite-user/index.ts`
**URL**: `https://szunbwkmldepkwpxojma.supabase.co/functions/v1/invite-user`

Flow:
1. Receives `{ email, full_name, role }` from frontend (role is one of `admin | administration | recruiter`; default when unset is `recruiter`).
2. Calls `auth.admin.generateLink({ type: 'invite', options: { redirectTo: '<site>/set-password' } })` — creates the auth user and a one-shot link that lands on `/set-password` (NOT the app).
3. Auth trigger (`handle_new_user`) auto-creates the `profiles` row with `password_set=false` and `role = <invited role | 'recruiter'>`.
4. Edge function then (re)sets `full_name`, `role`, and `password_set=false` on the profile (idempotent).
5. Sends the custom Hebrew RTL invite email via Resend HTTP API (sender defaults to `BHR Console <no-reply@banani-hr.com>`; override with the `INVITE_FROM_EMAIL` secret).
6. Returns `{ success, user_id, email_sent, email_id, email_warning, action_link }`. `email_warning` is a non-fatal surface for Resend rejections — the profile is already created, so the admin UI advances.

**Resend sender**: `banani-hr.com` is verified in Resend (eu-west-1). The edge function sends from `BHR Console <no-reply@banani-hr.com>` (override with the `INVITE_FROM_EMAIL` secret on the edge function if a different address is desired). Emails deliver to any recipient.

---

## Auth Flow

### Login (`/login`):

All roles log in via the email+password form in `src/pages/Login.tsx`. On successful sign-in the page redirects to `DEFAULT_LANDING[profile.role]` (`admin → /`, `administration → /transactions`, `recruiter → /transactions`). If the user has `password_set = false`, they are routed to `/set-password` first.

**Admin magic-link (service-role, for Oren or autonomous runs):**
1. `POST $VITE_SUPABASE_URL/auth/v1/admin/generate_link` with `{ type: 'magiclink', email: 'bananioren@gmail.com' }` using `SUPABASE_SERVICE_ROLE_KEY`.
2. Open `action_link`. Supabase sets the session and the app lands on `/`.
3. Session lifetime ≈ 1 hour. Regenerate as needed. See `CLAUDE_CODE_AUTONOMOUS.md`.

**Password flow (all roles via `/login`):**
- `Login.tsx` calls `supabase.auth.signInWithPassword()` directly (not through `useAuth`).
- On success it does NOT call `setLoading(false)` — it lets `onAuthStateChange` update `user`/`profile` and the `if (user) return <Navigate to=DEFAULT_LANDING[profile.role] />` branch redirects.
- On error: `setError(error.message)` + immediate `setLoading(false)` + `console.error`.
- 10-second safety timeout resets loading if the redirect never fires.
- Already logged in: auto-redirects to the role's default landing (or `/set-password` if the password is not yet set).

### Auth context (`src/lib/auth.tsx`):
- Primes the session on mount via `supabase.auth.getSession()` (synchronous localStorage read, no network round-trip in the common case) and fetches the matching `profiles` row before clearing `loading`.
- Subscribes to `onAuthStateChange` for subsequent sign-in/out/refresh; does NOT touch `loading` after the initial resolve (prevents a transient null-session event from toggling it back on and bouncing to `/login`).
- 10-second safety timeout ensures `loading` does not stick if `getSession()` never resolves.
- Cancellation flag prevents state updates after unmount.

### Password Reset:
- Admin-initiated from `/users` page
- Uses `supabase.auth.resetPasswordForEmail(email)`

### User Invite (bypass-safe — v8):
- Admin clicks "הזמן משתמש" in `/users`.
- Frontend calls `supabase.functions.invoke('invite-user', { body: { email, full_name, role } })`.
- Edge function creates the auth user via `auth.admin.generateLink({ type: 'invite' })` and sets `redirect_to = <site>/set-password`.
- The auth trigger auto-creates the `profiles` row with `password_set = false`.
- The Resend email contains the action link; when the invitee opens it, Supabase sets a session and redirects to `/set-password`. `RequireRole` refuses to render any admin page while `profile.password_set = false` — it force-redirects back to `/set-password`.
- The invitee picks a password. `SetPassword.tsx` calls `supabase.auth.updateUser({ password })` + updates `profiles.password_set = true` + `supabase.auth.signOut()` + navigates to `/login`. The user must now log in with email + password.

---

## UI/UX Specs

- **Direction**: RTL (`dir="rtl"`) throughout — `<html lang="he" dir="rtl">` in index.html, `direction: rtl; text-align: right` in body CSS
- **Language**: Hebrew labels everywhere
- **Colors**: Purple accent (`purple-600` primary, `purple-50/100` backgrounds)
- **Font**: System font stack
- **Component style**: Clean cards with shadows, shadcn/ui components
- **Layout**: Sidebar navigation (dark) on the **RIGHT** side of the screen — main content on the LEFT
  ```tsx
  // With dir="rtl" on <html>, plain flex already renders right-to-left.
  // Do NOT use flex-row-reverse — it double-reverses and puts sidebar LEFT.
  <div className="flex min-h-screen">
    <Sidebar />          {/* first child = RIGHT in RTL */}
    <main className="flex-1">...</main>
  </div>
  ```

### Sidebar nav items (admin):
- דשבורד
- לקוחות (includes agreement terms — no separate הסכמים item)
- עסקאות
- יומן שעות
- דוחות חיוב (admin + administration)
- צוות
- שירותים (configurable service types + their field schemas — admin only)
- ניהול משתמשים

> ⚠️ "הסכמים" is NOT a standalone nav item. Agreements are embedded inside the Clients page.

---

## Route layout model

Every authenticated route is wrapped in `<RequireRole allow={...}>`.
`RequireRole` checks session + `password_set` + role membership and
then renders its children. It accepts an optional `withLayout` prop
(default `true`) that controls whether the children are wrapped in
the desktop `<Layout>`:

- **Desktop routes** (`/`, `/clients`, `/transactions`, `/hours`,
  `/team`, `/users`, `/services`, `/billing-reports`, `/profile`,
  `/hours/report`) use the default — `withLayout` is true, so the
  desktop shell (right-aligned sidebar + main content) wraps each
  page.
- **Mobile routes** (`/m/*`) pass `withLayout={false}`. They render
  directly inside `MobileShell` (bottom-tab nav + mobile header) with
  no desktop sidebar. This is the fix for the "double sidebar" bug
  where `/m/hours` previously rendered MobileShell INSIDE the admin
  Layout.

`MobileAutoRoute` still auto-redirects non-admin narrow viewports
(<640 px) from `/` to `/m/hours` on first load. Admins default to
the desktop shell and can preview `/m` via the sidebar footer.

## Profile page (`/profile`, `/m/profile`)

`src/components/ProfileEditor.tsx` is the shared editor used by both
the desktop and mobile profile pages. Editable fields:

- `full_name` and `phone` on `profiles` (persisted via
  `useSafeMutation` with a 15 s timeout).
- **Password change** (`שנה סיסמה`) — dialog calls
  `supabase.auth.updateUser({ password })`. Includes a hidden
  `autoComplete="username"` mirror so iOS Keychain associates the
  new password with the current account. Success state announces
  that the new password will be required on next login.
- **Email change** (`שנה כתובת מייל`) — dialog calls
  `supabase.auth.updateUser({ email })`. Supabase's
  `mailer_secure_email_change_enabled: true` double-confirm mode
  sends a link to the new inbox; the auth row's `email` only updates
  after the user clicks it. Until then the success toast reads
  `קישור אימות נשלח ל-<newEmail>. יש לאשר בתיבת הדואר החדשה כדי
  להשלים את השינוי.`

**`profiles.email` reconciliation:** `AuthProvider` compares the
authenticated user's `email` against the cached `profiles.email` on
every session prime and every `onAuthStateChange` event; when they
differ, the profile row is updated in place and the new email
propagates to `/users`, `/team`, and the sidebar footer on the next
render without any manual step.

## Shared UI primitives (Batch 4 Phase A)

- `src/components/ClientPicker.tsx` — single source of truth for picking a
  client anywhere in the app. Internal React Query for `clients`, renders
  the selected client's NAME in the trigger (never the raw id), supports an
  optional `filter` predicate, an optional "all clients" sentinel option,
  and a clear button. Used on `/hours`, the hours-entry dialog, the
  transaction dialog, `/billing-reports`, `/clients` time-log permissions,
  and `/m/hours`.
- `src/components/LabeledToggle.tsx` — compound toggle with adjacent
  off/on text, bold active side, purple-600 track when on, zinc-300 when
  off, `h-6 w-11` for mobile legibility. Used for is_billable,
  exclusivity, time_log_enabled, hours_category_enabled, bonus_enabled,
  and include-service/include-time-period on `/billing-reports`.
- `src/hooks/useSafeMutation.ts` — wraps `useMutation` with a 15 s
  `AbortController` timeout + a predictable `SaveStatus` state machine
  (`idle | saving | success | error | timeout`). On timeout surfaces
  `פג זמן השמירה. נסה שנית.` Declares `invalidate` keys so query
  invalidation is automatic. Used for the two hang-prone saves (client
  save, hours-log insert); other saves opportunistically migrate.
- **Dialog width scale:** `max-w-sm` (confirmations), `max-w-lg` (form
  dialogs), `max-w-4xl` (primary entity dialogs). The shared
  `DialogContent` places the close ✕ at `top-2 end-2 z-50` (logical
  end, so RTL sits it opposite the Hebrew title); `DialogHeader`
  reserves `pe-10` so long titles wrap without colliding.

## Progressive Web App (Batch 4 Phase D)

- **Manifest + icons:** `vite-plugin-pwa` generates the service worker
  and wires the web manifest. Manifest declares `lang=he / dir=rtl /
  display=standalone / start_url=/ / scope=/`, with 192, 512 (any),
  and 512 (maskable) PNG icons generated from an inline SVG template
  by `scripts/generate-icons.mjs` (uses `sharp`). `index.html` adds the
  apple-touch-icon, mask-icon, theme-color, apple-mobile-web-app-capable,
  and viewport-fit=cover for iOS notch.
- **Caching:** `workbox.generateSW` with `cleanupOutdatedCaches:true`,
  `skipWaiting:true`, `clientsClaim:true`. Supabase API calls use
  `NetworkFirst` with a 24 h TTL and a 5 s network timeout; `/auth/*`
  is `NetworkOnly` (no caching of token endpoints).
- **Install UX:** admin sidebar footer shows `התקן BHR Console` when
  `beforeinstallprompt` fired and the app isn't already in standalone
  mode; `/login` renders an iOS-specific hint
  (`לחץ שתף → הוסף למסך הבית`) when the UA is iOS Safari and we're
  not standalone.
- **`/m` route group** (mobile-optimized shell) with bottom-tab nav
  (שעות / משרות / פרופיל):
  - `/m/hours` — big `+ דווח שעות` trigger → bottom sheet with
    `ClientPicker` + date/start/end/description; last 14 days listed
    grouped by date.
  - `/m/transactions` — last 50 transactions as read-only cards.
  - `/m/profile` — device status + install hint + sign-out.
  - `MobileAutoRoute`: first authenticated load + `innerWidth < 640` +
    non-admin → redirect to `/m/hours`. Admins default to desktop.
- **Offline queue** (`src/lib/offlineQueue.ts`): idb-keyval-backed
  queue for hours_log entries that fail or happen while offline. Banner
  at top of `/m/hours` shows the pending count with a retry button.
- **Biometric-friendly auth:**
  - `/login`: form uses `method="post"`, email input has
    `autoComplete="username"` + `inputMode="email"` + `name="email"`,
    password has `autoComplete="current-password"` + `name="password"`
    — iOS Safari recognizes this shape and offers Face-ID-gated
    autofill of saved credentials.
  - `/set-password`: hidden `autoComplete="username"` email mirror so
    Safari associates the new password with the account.
  - Supabase client config is explicit about
    `persistSession/autoRefreshToken/detectSessionInUrl`. Auth config
    set to `jwt_exp=3600` + `refresh_token_rotation_enabled=true`.
- **Future — passkeys:** Supabase Auth doesn't support passkeys as a
  primary factor yet. Deferred; revisit when a custom WebAuthn
  edge-function pathway is justified.

## Key Implementation Notes

1. **Re-render bug prevention**: Never put `useQuery` inside a Dialog/Modal component. Always hoist queries to parent and pass as props.

2. **Supabase RLS — role-aware (v8)**: RLS is enabled on `profiles`, `clients`, `transactions`, `hours_log`, `agreements`. All policies target the `authenticated` role and delegate role lookups to two SECURITY DEFINER helpers — `public.current_user_role()` and `public.current_user_full_name()` — to avoid infinite recursion when a policy on `profiles` itself needs to read the caller's role. There are no `anon` policies on any domain table. See the RLS Policies (v8) table and `supabase/migrations/20260418_roles_and_rls.sql` + `_1_rls_no_recursion.sql`.

3. **Route guarding**: All authenticated routes are wrapped in `<RequireRole allow={[...]}>` (`src/components/RequireRole.tsx`). `RequireRole` redirects unauthenticated users to `/login`, users with `password_set=false` to `/set-password`, and users whose role is not in `allow` to `DEFAULT_LANDING[role]`. `ProtectedRoute`/`AdminRoute` no longer exist.

4. **Billable toggle**: Per-row toggle in transactions table. Immediate mutation on click with `.select()`.

5. **Hours → Transaction**: When "סגור חודש" is clicked (admin only), upsert a Transaction record: check if exists for `client_name + month + year`, update or create.

6. **Unified identity**: `profiles` is the single table for all user data. The `team_members` table is deprecated — all frontend queries use `profiles`. `hours_log` writes set `profile_id = auth.uid()`; `team_member_id` is ignored legacy.

7. **Data persistence — save handlers**: Every form save must:
   - Use try-catch around the mutation
   - Show "שומר..." while saving (button disabled)
   - Show "המידע נשמר ✓" (green, 2 seconds) on success, then close dialog
   - Show "שגיאה בשמירה, נסה שנית" (red) on failure, keep dialog open
   - Call `queryClient.invalidateQueries()` on success
   - Log errors with `console.error`

8. **Auth flow — no race condition**: `AuthProvider` primes the session with `supabase.auth.getSession()` on mount (localStorage read), fetches the matching `profiles` row, then clears `loading`. Subsequent sign-in/out events arrive via `onAuthStateChange` but do NOT touch `loading`. 10-second safety timeout trips only if `getSession()` never resolves.

9. **Single Supabase client**: The codebase uses one `createClient()` call — `src/lib/supabase.ts`. The legacy `supabasePublic.ts` portal client was removed together with `/portal` in v8. Do not add a second client without updating this section and the security model.

10. **Login pattern**: `Login.tsx` calls `supabase.auth.signInWithPassword()` directly. On success it leaves `loading=true` and relies on `onAuthStateChange` → `setUser`/`setProfile` → the `<Navigate to={DEFAULT_LANDING[profile.role]} />` branch to redirect. A 10-second safety timeout resets loading if the redirect never fires.

11. **RTL sidebar**: `Layout.tsx` uses `<div className="flex min-h-screen">` — NOT `flex-row-reverse`. With `dir="rtl"` on `<html>`, plain `flex` already renders the first child (sidebar) on the RIGHT. Using `flex-row-reverse` double-reverses it to the LEFT — this was a past bug.

12. **Role-aware UI** (`src/components/Layout.tsx`): The sidebar filters `NAV_ITEMS` by `profile.role` (`admin` sees all six, `administration` sees לקוחות/עסקאות/יומן שעות, `recruiter` sees עסקאות/יומן שעות). `Users.tsx` exposes a 3-way role dropdown per row. `HoursLog.tsx` renders a single personal view for non-admins (no client tabs, no close-month button).

---

## Project Structure

```
bhr-console/
├── src/
│   ├── components/
│   │   ├── ui/              # shadcn components
│   │   ├── Layout.tsx       # sidebar + header (RTL, plain flex — dir="rtl" handles direction; nav items filtered by role)
│   │   └── RequireRole.tsx  # single route guard — allow prop = UserRole[]; also enforces password_set
│   ├── pages/
│   │   ├── Dashboard.tsx         # admin only
│   │   ├── Clients.tsx           # admin + administration; includes agreement fields — no separate Agreements page
│   │   ├── Transactions.tsx      # admin + administration (all rows); recruiter (own rows via RLS)
│   │   ├── HoursLog.tsx          # admin: tabs-per-client; non-admin: single personal view
│   │   ├── Team.tsx              # admin only; queries profiles WHERE role IN ('recruiter','administration')
│   │   ├── Users.tsx             # admin only; invite via edge function; 3-way role dropdown
│   │   ├── Login.tsx             # email+password; redirects to DEFAULT_LANDING[role]
│   │   └── SetPassword.tsx       # forced password-creation step after invite
│   ├── lib/
│   │   ├── supabase.ts        # single authenticated client (persistSession:true)
│   │   ├── auth.tsx           # AuthProvider (getSession on mount + onAuthStateChange)
│   │   ├── types.ts           # UserRole, Profile (with password_set), Client, Transaction, HoursLog, BonusTier, BonusModel
│   │   │                          # Note: Agreement type is deprecated — agreement fields live on Client
│   │   └── utils.ts
│   ├── hooks/
│   │   └── useSupabaseQuery.ts  # useTable, useInsert, useUpdate, useDelete
│   ├── App.tsx               # routes — every admin route uses <RequireRole allow={[...]}>
│   └── main.tsx
├── supabase/
│   ├── functions/
│   │   └── invite-user/
│   │       └── index.ts      # edge function: invite (redirect_to=/set-password) + Resend email
│   └── migrations/
│       ├── 20260418_roles_and_rls.sql        # role enum expansion, password_set, role-aware RLS
│       └── 20260418_1_rls_no_recursion.sql   # SECURITY DEFINER helpers to avoid RLS recursion on profiles
├── .env.local                # env variables (gitignored)
├── vercel.json               # SPA rewrites for client-side routing
├── supabase-schema.sql       # original schema (reference only)
├── index.html                # lang="he" dir="rtl"
├── vite.config.ts
└── BHR_CONSOLE_PROJECT.md    # this file
```

---

## Deployment

### Vercel
- Project: `bhr-console` (team: `banani-orens-projects`)
- Live URL: **https://app.banani-hr.com** (primary, attached to the project with a
  CNAME `app → cname.vercel-dns.com.` on the Cloudflare zone; Let's Encrypt cert
  auto-issued by Vercel)
- Legacy URL: https://bhr-console.vercel.app (still serves the same app as a
  safety net until §34 retires it)
- Framework: Vite
- SPA routing via `vercel.json` rewrites
- Deploy: push to `main` branch → Vercel auto-deploys (GitHub App connected ✅)
- Manual deploy (fallback only): `npx vercel --prod`

### Supabase Edge Functions
- Deploy: `SUPABASE_ACCESS_TOKEN=sbp_... npx supabase functions deploy invite-user --project-ref szunbwkmldepkwpxojma --no-verify-jwt`

### Supabase SMTP Configuration
- Configured via Management API to use Resend SMTP (smtp.resend.com:465)
- Sender: `BHR Console <no-reply@banani-hr.com>` (the `banani-hr.com` Resend domain is verified)

---

## Pending / TODO

_(none)_

## ✅ Completed Infrastructure

- **GitHub → Vercel auto-deploy**: ✅ `banani-oren/bhr-console` is connected to Vercel. Every `git push origin main` triggers an automatic deploy. No manual `vercel --prod` needed.
- **Resend verified sender** (`banani-hr.com`, eu-west-1): ✅ wired into both the `invite-user` edge function (`INVITE_FROM_EMAIL` override available) and Supabase Auth SMTP (`smtp_sender_name=BHR Console`, `smtp_admin_email=no-reply@banani-hr.com`). See `EMAIL_FIX_REPORT.md`.
- **Three-role access control + role-aware RLS**: ✅ see §"User Roles (three-role model — v8)", §"RLS Policies (v8)", and `_archive/SECURITY_FIX_REPORT.md`. Invite-link bypass closed.

---

## Claude Code — Autonomous Task Pattern

All non-trivial tasks (imports, batch fixes, autonomous QA runs) follow this
pattern so Cowork can prepare the work and Code can execute it cleanly:

### Pattern

1. **Cowork** reads the project context and creates a **prompt `.md` file**
   in `App Dev/` root with:
   - A **Read first** section listing the files Code must read before acting.
   - **Hard rules** (secrets handling, target table, idempotency tagging).
   - **Phased execution**: match → preview/gate → action → verify. Each
     phase writes a file and the gate stops the run if issues exist.
   - A **Rollback recipe** so any import can be undone.
   - A **Termination** section that names the final report file.

2. **Code** is given the prompt file path and runs it end-to-end without
   asking questions, writing all output to the named report file.

3. **After the run**, the prompt file + report are moved to `_archive/`
   (manually or in the next Cowork session).

### Prompt files (current + archive)

| File | Status | Description |
|------|--------|-------------|
| `ONE_TIME_CSV_IMPORT.md` | archived | Import of 28 transactions + 40 hours from master CSV |
| `CLAUDE_CODE_AUTONOMOUS.md` | active | Standing autonomous QA + bug-fix loop |
| `IMPORT_AGREEMENTS_FROM_EXCEL.md` | **active** | Import agreement terms from "כרטיסי לקוחות" → `clients` |

### One-time data imports — key rules

- **Target the right table.** Agreement terms live on the `clients` table.
  The `agreements` table is DEPRECATED — never write to it.
- **Non-overwrite rule.** Only fill DB columns that are currently `null` /
  empty / `false`. Never clobber values Oren has entered manually.
- **Idempotency.** Running a script twice must produce the same DB state.
- **Match gate.** If any source row cannot be fuzzy-matched to a DB client
  above the threshold (0.40 Dice), write an `*_UNMATCHED.md` file and stop.
  Resolve manually → add to `*_MATCH_REPORT.md` → re-run.
- **Manual overrides.** Confirmed mappings are stored in `*_MATCH_REPORT.md`
  and injected as a `MANUAL_OVERRIDES` map at the top of the script before
  the live run.

### Scripts

| Script | Purpose |
|--------|---------|
| `scripts/import-agreements.mjs` | Import agreement terms from Excel → `clients` |
| `scripts/generate-icons.mjs` | Regenerate PWA icons from SVG template |

---

## Historical references

Every prior autonomous-run prompt and report lives in `_archive/`
(see `_archive/INDEX.md` for a one-line description per file).
Highlights for understanding the current state:

- `_archive/IMPROVEMENTS_BATCH_2.md` — service_types + transactions
  wizard + time-log + PDF agreement extraction.
- `_archive/REFINEMENTS_BATCH_3.md` — `transactions.kind` model
  (`service` vs `time_period`), single-panel transaction dialog,
  billing reports.
- `_archive/REFINEMENTS_BATCH_4.md` — PWA / `/m` mobile shell /
  ClientPicker / useSafeMutation / DateInput.
- `_archive/REFINEMENTS_BATCH_5.md` — universal `dd/mm/yy` dates +
  bonus dashboard + sidebar footer.
- `_archive/IMPORT_REPORT_2026-04-23.md` — one-time import of Oren's
  master spreadsheet (28 transactions + 40 hours_log).
- `_archive/URGENT_FIXES_REPORT.md` — Noa invite root-cause fix
  (always-upsert profile in invite-user).
- `_archive/QUICK_FIXES_REPORT.md` — admin-update-user edge function
  + ClientPicker swap-in-place fix + tighter mobile guide.

The `/hours` module documented in §4 above replaces what the prior
batches built — see `REBUILD_HOURS_AND_CLEANUP.md` (after this
batch is archived, also under `_archive/`).

---

*Last updated: April 26 2026 — v10 (added Claude Code task pattern + agreement import workflow)*
*Repo: github.com/banani-oren/bhr-console*
*Supabase project: szunbwkmldepkwpxojma (Frankfurt)*
