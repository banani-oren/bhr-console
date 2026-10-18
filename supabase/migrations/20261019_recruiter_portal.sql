-- Repair 31 — Recruiter portal, PART 1 (additive RPCs; safe to apply before the new UI ships).
-- PART 2 (20261019_2_recruiter_lockdown.sql) removes recruiter table access and is applied only
-- AFTER the new UI is live, so no recruiter session ever sees a broken page.
--
-- Read paths for recruiters: my_deals (own deals, non-accounting columns), search_clients_for_picker,
-- my_time_log_clients. Write path: save_transaction_with_events via the recruiter-save-deal Edge Function.

-- ── 3a. Client picker for recruiters (and anyone): id, name, ח.פ. + the two
--     non-accounting defaults the deal dialog prefills (% עמלה, ימי אחריות).
--     Active clients only; p_id also returns that one client whatever its status,
--     so an existing deal can always show its client.
create or replace function public.search_clients_for_picker(p_query text default '', p_id uuid default null)
returns table (id uuid, name text, company_id text, commission_percent numeric, warranty_days int)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.company_id, c.commission_percent, c.warranty_days
  from public.clients c
  where public.current_user_role() is not null
    and (
      c.id = p_id
      or (
        c.status = 'פעיל'
        and (
          coalesce(btrim(p_query), '') = ''
          or c.name ilike '%' || btrim(p_query) || '%'
          or coalesce(c.company_id, '') ilike '%' || btrim(p_query) || '%'
        )
      )
    )
  order by c.name
  limit 50;
$$;
revoke all on function public.search_clients_for_picker(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.search_clients_for_picker(text, uuid) to authenticated;

-- ── 3b. Hours clients for a recruiter: permitted + time_log_enabled; no rate, no terms.
create or replace function public.my_time_log_clients()
returns table (id uuid, name text, company_id text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.company_id
  from public.client_time_log_permissions p
  join public.clients c on c.id = p.client_id
  where p.profile_id = auth.uid() and c.time_log_enabled
  order by c.name;
$$;
revoke all on function public.my_time_log_clients() from public, anon, authenticated, service_role;
grant execute on function public.my_time_log_clients() to authenticated;

-- ── 4. A.3 — the caller's own deals, NON-accounting columns only.
--     Excluded: net_invoice_amount, commission_amount, supplier_id/percent, invoice_number,
--     payment_date/status, is_billable, hourly_rate_used, time_sheet_pdf_path, and the derived
--     totals mirrored inside custom_fields (net_invoice_amount, commission_amount).
create or replace function public.my_deals(p_id uuid default null)
returns setof jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'kind', t.kind, 'client_id', t.client_id, 'client_name', t.client_name,
    'position_name', t.position_name, 'candidate_name', t.candidate_name,
    'service_type', t.service_type, 'service_type_id', t.service_type_id,
    'salary', t.salary, 'commission_percent', t.commission_percent, 'service_lead', t.service_lead,
    'entry_date', t.entry_date, 'close_date', t.close_date,
    'closing_month', t.closing_month, 'closing_year', t.closing_year,
    'work_start_date', t.work_start_date, 'work_end_date', t.work_end_date,
    'warranty_end_date', t.warranty_end_date,
    'billing_month', t.billing_month, 'billing_year', t.billing_year,
    'period_start', t.period_start, 'period_end', t.period_end, 'hours_total', t.hours_total,
    'notes', t.notes, 'needs_approval', t.needs_approval, 'approved_at', t.approved_at,
    'approved_by', t.approved_by, 'created_by', t.created_by, 'created_at', t.created_at,
    'custom_fields', coalesce(t.custom_fields, '{}'::jsonb) - 'net_invoice_amount' - 'commission_amount'
  )
  from public.transactions t
  where public.current_user_role() is not null
    and t.service_lead = public.current_user_full_name()
    and (p_id is null or t.id = p_id)
  order by t.entry_date desc nulls last, t.created_at desc;
$$;
revoke all on function public.my_deals(uuid) from public, anon, authenticated, service_role;
grant execute on function public.my_deals(uuid) to authenticated;
