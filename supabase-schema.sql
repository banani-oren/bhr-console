-- BHR Console - Supabase Database Schema
-- Run this in the Supabase SQL Editor to create all tables

-- ============================================
-- PROFILES (extends auth.users)
-- ============================================
create table if not exists profiles (
  id uuid references auth.users primary key,
  full_name text not null,
  email text,
  role text not null check (role in ('admin', 'employee')),
  bonus_model jsonb,
  hours_category_enabled boolean default false,
  created_at timestamptz default now()
);

-- ============================================
-- CLIENTS
-- ============================================
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  phone text,
  email text,
  status text default 'פעיל',
  created_at timestamptz default now()
);

-- ============================================
-- AGREEMENTS
-- ============================================
create table if not exists agreements (
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

-- ============================================
-- TRANSACTIONS
-- ============================================
create table if not exists transactions (
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

-- ============================================
-- TEAM MEMBERS
-- ============================================
create table if not exists team_members (
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

-- ============================================
-- HOURS LOG
-- ============================================
create table if not exists hours_log (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid references team_members(id),
  client_name text,
  visit_date date,
  hours numeric,
  description text,
  hours_category text,
  month integer,
  year integer,
  created_at timestamptz default now()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
alter table profiles enable row level security;
alter table clients enable row level security;
alter table agreements enable row level security;
alter table transactions enable row level security;
alter table team_members enable row level security;
alter table hours_log enable row level security;

-- Profiles: users can read their own profile, admins can read all
create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Admins have full access to profiles"
  on profiles for all
  using (
    exists (
      select 1 from profiles where id = auth.uid() and role = 'admin'
    )
  );

-- Clients: admins have full access
create policy "Admins have full access to clients"
  on clients for all
  using (
    exists (
      select 1 from profiles where id = auth.uid() and role = 'admin'
    )
  );

-- Agreements: admins have full access
create policy "Admins have full access to agreements"
  on agreements for all
  using (
    exists (
      select 1 from profiles where id = auth.uid() and role = 'admin'
    )
  );

-- Transactions: admins have full access, employees can read (for bonus calculation)
create policy "Admins have full access to transactions"
  on transactions for all
  using (
    exists (
      select 1 from profiles where id = auth.uid() and role = 'admin'
    )
  );

create policy "Employees can read transactions"
  on transactions for select
  using (
    exists (
      select 1 from profiles where id = auth.uid() and role = 'employee'
    )
  );

-- Team members: admins have full access, public read for portal token lookup
create policy "Admins have full access to team_members"
  on team_members for all
  using (
    exists (
      select 1 from profiles where id = auth.uid() and role = 'admin'
    )
  );

create policy "Anyone can read team_members by portal_token"
  on team_members for select
  using (true);

-- Hours log: admins have full access, anyone can insert (portal), read own
create policy "Admins have full access to hours_log"
  on hours_log for all
  using (
    exists (
      select 1 from profiles where id = auth.uid() and role = 'admin'
    )
  );

create policy "Anyone can insert hours_log"
  on hours_log for insert
  with check (true);

create policy "Anyone can read hours_log"
  on hours_log for select
  using (true);

-- ============================================
-- INDEXES
-- ============================================
create index if not exists idx_transactions_billing on transactions (billing_year, billing_month);
create index if not exists idx_transactions_closing on transactions (closing_year, closing_month);
create index if not exists idx_transactions_service_lead on transactions (service_lead);
create index if not exists idx_hours_log_member on hours_log (team_member_id, year, month);
create index if not exists idx_team_members_token on team_members (portal_token);
create index if not exists idx_agreements_client on agreements (client_id);
