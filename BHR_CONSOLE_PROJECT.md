# BHR Console — Project Brief

## Overview
**BHR Console** is an HR consulting financial management system for Banani HR.
Migration from BASE44 to a professional stack. Built from scratch — no data migration.

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

**`profiles` is the single source of truth** for all users (admin + employee).  
There is no separate `team_members` table — all employee data lives on `profiles`.

- `profiles.id` references `auth.users.id` (1:1)
- A database trigger (`handle_new_user`) auto-creates a `profiles` row when a new auth user is created
- `/team` page queries `profiles WHERE role = 'employee'`
- `/users` page queries all `profiles`
- Portal lookups use `profiles.portal_token`

---

## User Roles

### Admin (`bananioren@gmail.com`)
- Full access to all pages and data
- Manage users (invite, reset password, delete)
- Configure bonus models for each employee
- Auth user ID: `03b73b4f-8f09-4bf1-9c22-f49b2b05f363`

### Employee
- Access to personal portal only (`/portal`)
- Log hours
- View personal bonus (if configured)

---

## Database Schema

```sql
-- profiles: single source of truth for all users
create table profiles (
  id uuid references auth.users primary key,
  full_name text not null,
  email text,
  role text not null check (role in ('admin', 'employee')),
  bonus_model jsonb,                                    -- null = no bonus tab
  hours_category_enabled boolean default false,         -- BHR/איגוד toggle
  portal_token text unique default gen_random_uuid()::text,
  phone text,
  status text default 'פעיל',
  created_at timestamptz default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  phone text,
  email text,
  status text default 'פעיל',
  created_at timestamptz default now()
);

create table agreements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  client_name text,
  agreement_type text,
  commission_rate numeric,
  monthly_fee numeric,
  start_date date,
  end_date date,
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
  service_lead text,
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
  profile_id uuid references profiles(id),        -- links to profiles (unified)
  team_member_id uuid,                             -- legacy, kept for migration
  client_name text,
  visit_date date,
  hours numeric,
  description text,
  hours_category text,                             -- 'BHR' or 'איגוד'
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
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'employee')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### RLS Policies (current)
| Table | Policy | Role | Access |
|-------|--------|------|--------|
| profiles | auth_full_profiles | authenticated | ALL |
| profiles | service_role_profiles | service_role | ALL |
| profiles | anon_read_profiles | anon | SELECT |
| clients | Authenticated full access | authenticated | ALL |
| agreements | Authenticated full access | authenticated | ALL |
| transactions | Authenticated full access | authenticated | ALL |
| hours_log | auth_full_hours | authenticated | ALL |
| hours_log | anon_read_hours | anon | SELECT |
| hours_log | anon_insert_hours | anon | INSERT |

---

## Application Pages

### Admin Interface

#### 1. `/` — Dashboard
- KPI cards: total transactions, total revenue, billable %, open transactions
- Bar chart: monthly revenue (last 12 months)
- Donut chart: transactions by status
- Bar chart: revenue by service lead
- Table: recent transactions (last 10)

#### 2. `/clients` — Clients
- Searchable table: name, contact, phone, status
- Add / Edit / Delete client
- **Import button**: upload Excel (.xlsx/.csv) → preview → confirm → save
- Save handler: try-catch, success/error toast

#### 3. `/agreements` — Agreements
- Table: client, type, commission %, monthly fee, dates
- Add / Edit / Delete
- **Import button**: same Excel import flow
- Save handler: try-catch with `formError` state

#### 4. `/transactions` — Transactions
- Table columns: client, position, candidate, salary, commission %, service lead, entry date, closing date, net amount, supplier commission, billable toggle, invoice badge
- **6 filters**: entry month, closing month, service type, service lead, billable status, closing year
- Per-row billable toggle (immediate mutation with `.select()`)
- Green badge if invoice number set
- Add / Edit (full details in dialog)
- **Import button**: Excel import
- Save handler: try-catch, success/error toast

#### 5. `/hours` — Hours Log
- Tabs per client (retainer clients)
- Month/year selector
- Table: date, hours, description, category (if applicable)
- Add visit form with save feedback
- **סגור חודש** button: upserts Transaction record for client/month
- Close month has confirmation dialog with success/error feedback

#### 6. `/team` — Team (employees only)
- Queries `profiles WHERE role = 'employee'`
- Cards per employee: name, email, portal link
- Edit dialog: employee-specific fields only — bonus_model, hours_category_enabled
- No add/delete — employees are managed via `/users` (invite flow)
- Save goes to `profiles` table with success/error toast
- Portal link copy button

#### 7. `/users` — User Management (Admin only, behind AdminRoute)
- Table: email, name, role
- **Invite user**: calls `invite-user` edge function → sends email via Resend
- Reset password (via Supabase Auth `resetPasswordForEmail`)
- Delete user (deletes profile row)
- Toggle role (admin ↔ employee)

---

### Employee Portal

#### `/portal` — Entry point
- Reads `?token=<portal_token>` from URL
- Finds matching `profiles` row by `portal_token`
- No login required — token IS the identity
- If token invalid: show "קישור לא תקין" error

#### Portal tabs (based on employee config):
- **שעות** (all employees):
  - Month/year selector (default: current month)
  - Table: date, hours, category (if hours_category_enabled), description, total footer
  - "+ הוסף דיווח" button → inline form
  - On save: creates `hours_log` record with `profile_id`
- **בונוס** (only if bonus_model is configured):
  - Shows current month revenue and calculated bonus
  - See Bonus section below

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
The employee receives the single flat bonus amount for the highest tier their monthly revenue reaches:
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

### Portal Bonus Tab shows:
- Revenue card (current month, filtered by bonus_model.filter)
- Bonus card (flat ₪ amount)
- Current tier indicator (₪ min threshold reached)
- "עוד ₪X למדרגה הבאה" (if not at max tier)
- Tiers table showing ₪ min and ₪ bonus columns (NO percentages) — highlight current tier

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
1. Receives `{ email, full_name, role }` from frontend
2. Calls `auth.admin.generateLink({ type: 'invite' })` — creates auth user + invite link
3. Auth trigger (`handle_new_user`) auto-creates the `profiles` row
4. Updates profile with `portal_token`
5. Sends custom Hebrew RTL invite email via Resend HTTP API
6. Returns `{ success: true, user_id, email_id }`

**Resend limitation**: Using `onboarding@resend.dev` (free tier), emails only deliver to the Resend account owner (`bananioren@gmail.com`). To send to any email, verify a domain at https://resend.com/domains and update the `from` address in the edge function.

---

## Auth Flow

### Admin login (`/login`):
- Email + password form
- On success: `onAuthStateChange` updates user state → declarative redirect via `<Navigate>`
- On fail: show error
- Already logged in: auto-redirect to `/`

### Auth context (`src/lib/auth.tsx`):
- Uses `onAuthStateChange(INITIAL_SESSION)` only — no separate `getSession()` call (avoids race condition)
- Fetches profile from `profiles` table on auth state change
- 5-second safety timeout prevents infinite loading screen
- Cancellation flag prevents state updates after unmount

### Employee portal:
- No login — accessed via `?token=<portal_token>`
- Token stored in `profiles.portal_token`
- Admin copies portal link from `/team` page

### Password Reset:
- Admin-initiated from `/users` page
- Uses `supabase.auth.resetPasswordForEmail(email)`

### User Invite:
- Admin clicks "הזמן משתמש" in `/users`
- Frontend calls `supabase.functions.invoke('invite-user', { body: { email, full_name, role } })`
- Edge function creates user + sends invite email via Resend
- Auth trigger auto-creates profile row

---

## UI/UX Specs

- **Direction**: RTL (`dir="rtl"`) throughout — `<html lang="he" dir="rtl">` in index.html, `direction: rtl; text-align: right` in body CSS
- **Language**: Hebrew labels everywhere
- **Colors**: Purple accent (`purple-600` primary, `purple-50/100` backgrounds)
- **Font**: System font stack
- **Component style**: Clean cards with shadows, shadcn/ui components
- **Layout**: Sidebar navigation (dark) on the **RIGHT** side of the screen — main content on the LEFT
  ```tsx
  <div className="flex flex-row-reverse min-h-screen">
    <Sidebar />          {/* appears on RIGHT */}
    <main className="flex-1">...</main>
  </div>
  ```

### Sidebar nav items (admin):
- דשבורד
- לקוחות
- הסכמים
- עסקאות
- יומן שעות
- צוות
- ניהול משתמשים

---

## Key Implementation Notes

1. **Re-render bug prevention**: Never put `useQuery` inside a Dialog/Modal component. Always hoist queries to parent and pass as props.

2. **Supabase RLS**: RLS enabled on all tables. Authenticated users get full access. Anon users get read access to profiles (portal lookup) and hours_log. No recursive policies on profiles (causes infinite recursion).

3. **Portal token**: `portal_token` in `profiles` is a UUID string. The `/portal` route is excluded from auth middleware (no `ProtectedRoute` wrapper).

4. **Billable toggle**: Per-row toggle in transactions table. Immediate mutation on click with `.select()`.

5. **Hours → Transaction**: When "סגור חודש" is clicked, upsert a Transaction record: check if exists for `client_name + month + year`, update or create.

6. **Unified identity**: `profiles` is the single table for all user data. The `team_members` table is deprecated — all frontend queries use `profiles`. hours_log uses `profile_id` (not `team_member_id`).

7. **Data persistence — save handlers**: Every form save must:
   - Use try-catch around the mutation
   - Show "שומר..." while saving (button disabled)
   - Show "המידע נשמר ✓" (green, 2 seconds) on success, then close dialog
   - Show "שגיאה בשמירה, נסה שנית" (red) on failure, keep dialog open
   - Call `queryClient.invalidateQueries()` on success
   - Log errors with `console.error`

8. **Auth flow — no race condition**: Use `onAuthStateChange` only (not `getSession()`). The `INITIAL_SESSION` event provides the session on mount. A 5-second safety timeout prevents the loading screen from hanging forever.

9. **Supabase client singleton**: Only one `createClient()` call exists in `src/lib/supabase.ts`. All files import the shared instance.

---

## Project Structure

```
bhr-console/
├── src/
│   ├── components/
│   │   ├── ui/              # shadcn components
│   │   └── Layout.tsx       # sidebar + header (RTL, flex-row-reverse)
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Clients.tsx
│   │   ├── Agreements.tsx
│   │   ├── Transactions.tsx
│   │   ├── HoursLog.tsx
│   │   ├── Team.tsx         # queries profiles WHERE role='employee'
│   │   ├── Users.tsx        # invite via edge function
│   │   ├── Login.tsx
│   │   └── Portal.tsx       # queries profiles by portal_token
│   ├── lib/
│   │   ├── supabase.ts      # singleton client
│   │   ├── auth.tsx          # AuthProvider (onAuthStateChange only)
│   │   ├── types.ts          # Profile, Client, Agreement, Transaction, HoursLog, BonusTier, BonusModel
│   │   └── utils.ts
│   ├── hooks/
│   │   └── useSupabaseQuery.ts  # useTable, useInsert, useUpdate, useDelete
│   ├── App.tsx               # routes, ProtectedRoute, AdminRoute
│   └── main.tsx
├── supabase/
│   └── functions/
│       └── invite-user/
│           └── index.ts      # edge function: invite + Resend email
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
- Deploy: `npx vercel --prod` or push to GitHub

### Supabase Edge Functions
- Deploy: `SUPABASE_ACCESS_TOKEN=sbp_... npx supabase functions deploy invite-user --project-ref szunbwkmldepkwpxojma --no-verify-jwt`

### Supabase SMTP Configuration
- Configured via Management API to use Resend SMTP (smtp.resend.com:465)
- Sender: `BHR Console <onboarding@resend.dev>` (until custom domain is verified)

---

## Pending / TODO

- **Resend domain verification**: Verify `banani-hr.com` at https://resend.com/domains to send invite emails to any address (not just account owner)
- **GitHub → Vercel auto-deploy**: Install the Vercel GitHub App at https://github.com/apps/vercel to enable auto-deploys on push

---

*Last updated: April 2026 — v3*
*Repo: github.com/banani-oren/bhr-console*
*Supabase project: szunbwkmldepkwpxojma (Frankfurt)*
