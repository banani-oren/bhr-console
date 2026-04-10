# BHR Console — Project Brief for Claude Code

## Overview
**BHR Console** is an HR consulting financial management system for Banani HR.  
Migration from BASE44 to a professional stack. Build from scratch — no data migration needed.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + TypeScript + TailwindCSS + shadcn/ui |
| State / Data | @tanstack/react-query + Supabase client |
| Router | react-router-dom v6 |
| Database | Supabase (Postgres) |
| Auth | Supabase Auth — email/password |
| Email | Resend (invite + password reset only) |
| Hosting | Vercel (auto-deploy from GitHub) |
| Repo | github.com/banani-oren/bhr-console |

---

## Environment Variables

```env
VITE_SUPABASE_URL=https://szunbwkmldepkwpxojma.supabase.co
VITE_SUPABASE_ANON_KEY=<from Supabase Legacy API Keys tab>
RESEND_API_KEY=<from Resend dashboard>
```

---

## User Roles

### Admin
- Full access to all pages and data
- Manage users (invite, reset password, delete)
- Configure bonus models for each employee

### Employee
- Access to personal portal only (`/portal`)
- Log hours
- View personal bonus (if configured)

---

## Database Schema

```sql
-- Users managed by Supabase Auth
-- profiles table extends auth.users
create table profiles (
  id uuid references auth.users primary key,
  full_name text not null,
  role text not null check (role in ('admin', 'employee')),
  bonus_model jsonb, -- null = no bonus tab shown
  hours_category_enabled boolean default false, -- show BHR/איגוד select (for Nadia)
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

create table team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text,
  email text,
  status text default 'פעיל',
  bonus_model jsonb,
  hours_category_enabled boolean default false,
  portal_token text unique default gen_random_uuid()::text,
  created_at timestamptz default now()
);

create table hours_log (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid references team_members(id),
  client_name text,
  visit_date date,
  hours numeric,
  description text,
  hours_category text, -- 'BHR' or 'איגוד' (only for Nadia)
  month integer,
  year integer,
  created_at timestamptz default now()
);
```

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
- **Import button**: upload Excel (.xlsx/.csv) or PDF → preview → confirm → save

#### 3. `/agreements` — Agreements
- Table: client, type, commission %, monthly fee, dates
- Add / Edit / Delete
- **Import button**: same Excel/PDF import flow

#### 4. `/transactions` — Transactions
- Table columns: client, position, candidate, salary, commission %, service lead, entry date, closing date, net amount, supplier commission, billable toggle, invoice badge
- **6 filters**: entry month, closing month, service type, service lead, billable status, closing year
- Per-row billable toggle (✓/✗)
- Green badge if invoice number set
- Add / Edit (full details in dialog, not in table)
- **Import button**: Excel/PDF import

#### 5. `/hours` — Hours Log
- Tabs per client (retainer clients)
- Month/year selector
- Table: date, hours, description, category (if applicable)
- Add visit form
- **סגור חודש** button: creates/updates Transaction record for that client/month

#### 6. `/team` — Team
- Cards per employee: name, role, email
- Portal link with copy button
- Edit employee (name, role, email, bonus model, hours_category toggle)
- Bonus model config (see Bonus section below)

#### 7. `/users` — User Management (Admin only)
- Table: email, name, role, last login
- Invite user (send email via Resend)
- Reset password (send email via Resend)
- Delete user
- Change role (admin ↔ employee)

---

### Employee Portal

#### `/portal` — Entry point
- Reads `?token=<portal_token>` from URL
- Finds matching team_member by portal_token
- No login required — token IS the identity
- If token invalid: show "קישור לא תקין" error

#### Portal tabs (based on employee config):
- **שעות** (all employees):
  - Month/year selector (default: current month)
  - Table: date, hours, category (if hours_category_enabled), description, total footer
  - "+ הוסף דיווח" button → inline form: date + hours (step 0.5) + description + category (if enabled)
  - On save: create hours_log record
- **בונוס** (only if bonus_model is configured):
  - Shows current month revenue and calculated bonus
  - See Bonus section below

---

## Bonus Model

### Data structure (stored in `team_members.bonus_model` as JSONB)

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

### Admin configures bonus model for any employee via `/team` edit dialog.
- Form shows only 2 columns per tier row: **מינימום (₪)** and **בונוס (₪)**
- No max, no percentage, no rate fields
- emptyTier: `{ min: 0, bonus: 0 }`

---

## Import Flow (Excel / PDF)

For each entity (clients, agreements, transactions):
1. Admin clicks "ייבוא" button
2. Upload dialog opens: drag & drop or file picker (.xlsx, .csv, .pdf)
3. System parses file → shows preview table with mapped columns
4. Admin can map/correct column names
5. Admin clicks "אשר ייבוא" → rows inserted to DB
6. Show success/error summary

Libraries:
- Excel: `xlsx` (SheetJS)
- PDF: `pdf-parse` or `pdfjs-dist`

---

## UI/UX Specs

- **Direction**: RTL (`dir="rtl"`) throughout — `<html lang="he" dir="rtl">` in index.html, `direction: rtl; text-align: right` in body CSS
- **Language**: Hebrew labels everywhere
- **Colors**: Purple accent (`purple-600` primary, `purple-50/100` backgrounds)
- **Font**: System font stack
- **Component style**: Clean cards with shadows, shadcn/ui components
- **Layout**: Sidebar navigation (dark) on the **RIGHT** side of the screen — main content on the LEFT
  ```tsx
  // Layout.tsx — correct RTL structure:
  <div className="flex flex-row-reverse min-h-screen">
    <Sidebar />          {/* appears on RIGHT */}
    <main className="flex-1 pr-[sidebar-width]">...</main>
  </div>
  ```
- All padding offsets use `pr-` (not `pl-`) to account for right-side sidebar

### Sidebar nav items (admin):
- דשבורד
- לקוחות
- הסכמים
- עסקאות
- יומן שעות
- צוות
- ניהול משתמשים

---

## Auth Flow

### Admin login (`/login`):
- Email + password form
- On success → redirect to `/`
- On fail → show error

### Employee portal:
- No login — accessed via `?token=<portal_token>`
- Token stored in `team_members.portal_token`
- Admin copies portal link from `/team` page

### Password Reset:
- Admin-initiated from `/users` page
- Sends reset email via Resend + Supabase Auth

### User Invite:
- Admin enters email + name + role in `/users`
- Supabase sends invite email
- User sets password on first login

---

## Key Implementation Notes

1. **Re-render bug prevention**: Never put `useQuery` inside a Dialog/Modal component. Always hoist queries to parent and pass as props.

2. **Supabase RLS**: Enable Row Level Security on all tables. Admin role = full access. Employee role = read own hours_log only.

3. **Portal token**: `portal_token` in `team_members` is a UUID string. The `/portal` route must be excluded from auth middleware.

4. **Billable toggle**: Per-row toggle in transactions table. Immediate mutation on click, no dialog needed.

5. **Hours → Transaction**: When "סגור חודש" is clicked, upsert a Transaction record: check if exists for `client_name + month + year`, update or create.

6. **Employee = User (unified identity)**: Every employee is also a system user. `team_members` is the single source of truth for employee data (bonus model, hours category, portal token). The `profiles` table links to `auth.users` for login. When an employee is created in `/team`, a corresponding user invite must be sent so they can log in to `/portal`. The `team_members.portal_token` is used for passwordless portal access.

7. **Data persistence — save handlers**: Every form save must:
   - Call `supabase.from(...).insert()` or `.update().eq('id', id)` with `.select()` at the end
   - Await the result and check for `error`
   - Log errors with `console.error`
   - Show "המידע נשמר ✓" (green, 2 seconds) on success, then close dialog and call `queryClient.invalidateQueries()`
   - Show "שגיאה בשמירה" (red) on failure, keep dialog open
   - Never assume save succeeded without checking the Supabase response

---

## Project Structure

```
bhr-console/
├── src/
│   ├── components/
│   │   ├── ui/          # shadcn components
│   │   ├── Layout.tsx   # sidebar + header
│   │   └── shared/      # reusable components
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Clients.tsx
│   │   ├── Agreements.tsx
│   │   ├── Transactions.tsx
│   │   ├── HoursLog.tsx
│   │   ├── Team.tsx
│   │   ├── Users.tsx
│   │   ├── Login.tsx
│   │   └── Portal.tsx
│   ├── lib/
│   │   ├── supabase.ts  # supabase client
│   │   ├── auth.tsx     # auth context
│   │   └── utils.ts
│   ├── hooks/           # custom hooks
│   ├── App.tsx
│   └── main.tsx
├── .env.local           # env variables (gitignored)
├── vite.config.ts
├── tailwind.config.ts
└── BHR_CONSOLE_PROJECT.md  # this file
```

---

## Resend API Key
Stored in Vercel environment as `RESEND_API_KEY`.  
Used only for:
- `invite-user` edge function → sends invite email
- `reset-password` edge function → sends reset email

Sender: `noreply@banani-hr.com` (or `onboarding@resend.dev` until domain is configured)

---

*Last updated: April 2026 — v2 (flat bonus tiers, RTL sidebar right, employee=user unification, save persistence)*
*Repo: github.com/banani-oren/bhr-console*
*Supabase project: szunbwkmldepkwpxojma (Frankfurt)*
