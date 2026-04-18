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
- Wait ~60 seconds after push, then open https://bhr-console.vercel.app
- Navigate to the specific page/feature that was changed and confirm it works correctly in production
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
| Hosting | Vercel — https://bhr-console.vercel.app |
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
- `RESEND_API_KEY` — production, preview (sensitive)

### Supabase Edge Function Secrets
- `RESEND_API_KEY` — set via `supabase secrets set`

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

## User Roles (three-role model — v8)

Roles are persisted in `profiles.role`, constrained to `{admin, administration, recruiter}`.
Route access is enforced by `<RequireRole allow={...}>` in the frontend AND by role-aware
RLS at the database level (defense in depth).

| Page / resource | admin | administration | recruiter |
|-----------------|:-----:|:--------------:|:---------:|
| `/` (Dashboard) | ✅ | ❌ | ❌ |
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

  created_at timestamptz default now()
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
  client_name text,
  position_name text,
  candidate_name text,
  service_type text,
  salary numeric,
  commission_percent numeric,
  net_invoice_amount numeric,
  commission_amount numeric,
  service_lead text,                                 -- references profiles.full_name (recruiter/administration)
  entry_date date,
  billing_month integer,
  billing_year integer,
  close_date date,
  closing_month integer,
  closing_year integer,
  payment_date date,
  payment_status text default 'ממתין',
  is_billable boolean default true,
  invoice_number text,
  notes text,
  created_at timestamptz default now()
);

create table hours_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id),          -- unified: links to profiles table
  team_member_id uuid,                               -- legacy column, ignore
  client_name text,
  visit_date date,
  hours numeric,
  description text,
  hours_category text,                               -- 'BHR' or 'איגוד' (only if hours_category_enabled)
  month integer,
  year integer,
  created_at timestamptz default now()
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

#### 1. `/` — Dashboard
- KPI cards: total transactions, total revenue, billable %, open transactions
- Bar chart: monthly revenue (last 12 months)
- Donut chart: transactions by status
- Bar chart: revenue by service lead
- Table: recent transactions (last 10)

#### 2. `/clients` — Clients + Agreements (unified page)

> ⚠️ **DESIGN DECISION — DO NOT CHANGE**: There is NO separate `/agreements` page and NO "הסכמים" sidebar nav item.
> Clients and their agreement terms are managed together on this single page. This is intentional.

**Client table:**
- Searchable table: name, contact, phone, status
- Add / Edit / Delete client
- **Import button**: upload Excel (.xlsx/.csv) → preview → confirm → save
- Save handler: try-catch, success/error toast

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

#### 4. `/hours` — Hours Log
- Tabs per client (retainer clients)
- Month/year selector
- Table: date, hours, description, category (if applicable)
- Add visit form with save feedback
- **סגור חודש** button: upserts Transaction record for client/month
- Close month has confirmation dialog with success/error feedback

#### 5. `/team` — Team (non-admin users)
- Admin-only page. Queries `profiles WHERE role IN ('recruiter','administration')`.
- Cards per user: name, email, role badge.
- Edit dialog: non-admin-specific fields only — `bonus_model`, `hours_category_enabled`.
- No add/delete here — new users are onboarded via `/users` (invite flow).
- Save goes to `profiles` with success/error toast and query invalidation.

#### 6. `/users` — User Management (Admin only, behind `<RequireRole allow={['admin']}>`)
- Table: email, name, role.
- **Invite user**: calls `invite-user` edge function. The invite email links to `/set-password` so the invitee must set a password before `RequireRole` will let them into the app.
- Reset password (via Supabase Auth `resetPasswordForEmail`).
- Delete user (deletes the `profiles` row).
- Change role: 3-way dropdown (`admin` / `administration` / `recruiter`).

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

## Edge Functions

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
- צוות
- ניהול משתמשים

> ⚠️ "הסכמים" is NOT a standalone nav item. Agreements are embedded inside the Clients page.

---

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
- Live URL: https://bhr-console.vercel.app
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
- **Three-role access control + role-aware RLS**: ✅ see §"User Roles (three-role model — v8)", §"RLS Policies (v8)", and `SECURITY_FIX_REPORT.md`. Invite-link bypass closed.

---

*Last updated: April 18 2026 — v8 (three-role access control, role-aware RLS, `/set-password` invite flow, `/portal` + `portal_token` removed)*
*Repo: github.com/banani-oren/bhr-console*
*Supabase project: szunbwkmldepkwpxojma (Frankfurt)*
