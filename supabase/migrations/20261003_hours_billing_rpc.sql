-- Repair 15: save_transaction_with_events() never learned about the four
-- hours-billing columns (period_start, period_end, hours_total,
-- hourly_rate_used), so every hours (kind = 'time_period') transaction saved
-- through TransactionDialog/the RPC silently lost them — see
-- prompts/repair15-hours-billing-transaction.md for the full diagnosis.
--
-- This migration:
--   1. Re-replaces save_transaction_with_events with the same four columns
--      added to both the UPDATE CASE-list and the INSERT column list, using
--      the same key-presence semantics (`p_payload ? 'x'`) as every other
--      column, so an existing good row is never wiped on edit.
--   2. Retroactively reconstructs what is reconstructable on already-live
--      time_period transactions (D3): net_invoice_amount from the linked
--      billing_events total, and period/hours from linked hours_log rows.
--      Rows that can't be reconstructed this way are left for Oren to fix by
--      hand (see the leftovers query run alongside this migration).

begin;

create or replace function public.save_transaction_with_events(
  p_mode text,              -- 'insert' | 'update'
  p_id uuid,                -- required for 'update', ignored for 'insert'
  p_payload jsonb,          -- transactions row fields to set (only keys present are touched, matching supabase-js .update() semantics)
  p_events jsonb,           -- array of billing_events drafts to upsert (may be an empty array)
  p_flip_to_bill boolean,   -- whether to flip past-due pending billing_events to to_bill
  p_work_end_date date      -- if not null, cancel future billing_events past this date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_txn_id uuid;
  v_my_name text;
  v_my_role text;
  v_new_service_lead text;
  v_old_service_lead text;
  v_authorized boolean;
begin
  if p_mode not in ('insert', 'update') then
    raise exception 'invalid mode: %', p_mode using errcode = '22023';
  end if;

  v_my_role := public.current_user_role();
  v_my_name := public.current_user_full_name();
  v_new_service_lead := p_payload->>'service_lead';

  if p_mode = 'update' then
    if p_id is null then
      raise exception 'p_id is required for update mode' using errcode = '22023';
    end if;

    select service_lead into v_old_service_lead
      from transactions where id = p_id;
    if not found then
      raise exception 'transaction % not found', p_id using errcode = 'P0002';
    end if;

    -- Mirrors transactions_full_access: USING (old row) AND WITH CHECK (new row).
    v_authorized :=
      (v_my_role in ('admin', 'administration') or v_old_service_lead = v_my_name)
      and (v_my_role in ('admin', 'administration') or v_new_service_lead = v_my_name);
  else
    -- Mirrors transactions_full_access WITH CHECK for a freshly inserted row.
    v_authorized := v_my_role in ('admin', 'administration') or v_new_service_lead = v_my_name;
  end if;

  if not v_authorized then
    raise exception 'not authorized to save this transaction' using errcode = '42501';
  end if;

  if p_mode = 'update' then
    v_txn_id := p_id;

    update transactions set
      kind               = case when p_payload ? 'kind' then p_payload->>'kind' else kind end,
      client_id          = case when p_payload ? 'client_id' then nullif(p_payload->>'client_id','')::uuid else client_id end,
      client_name        = case when p_payload ? 'client_name' then p_payload->>'client_name' else client_name end,
      service_type       = case when p_payload ? 'service_type' then p_payload->>'service_type' else service_type end,
      service_type_id    = case when p_payload ? 'service_type_id' then nullif(p_payload->>'service_type_id','')::uuid else service_type_id end,
      service_lead       = case when p_payload ? 'service_lead' then p_payload->>'service_lead' else service_lead end,
      entry_date         = case when p_payload ? 'entry_date' then nullif(p_payload->>'entry_date','')::date else entry_date end,
      billing_month      = case when p_payload ? 'billing_month' then (p_payload->>'billing_month')::int else billing_month end,
      billing_year       = case when p_payload ? 'billing_year' then (p_payload->>'billing_year')::int else billing_year end,
      close_date         = case when p_payload ? 'close_date' then nullif(p_payload->>'close_date','')::date else close_date end,
      closing_month      = case when p_payload ? 'closing_month' then (p_payload->>'closing_month')::int else closing_month end,
      closing_year       = case when p_payload ? 'closing_year' then (p_payload->>'closing_year')::int else closing_year end,
      work_start_date    = case when p_payload ? 'work_start_date' then nullif(p_payload->>'work_start_date','')::date else work_start_date end,
      work_end_date      = case when p_payload ? 'work_end_date' then nullif(p_payload->>'work_end_date','')::date else work_end_date end,
      warranty_end_date  = case when p_payload ? 'warranty_end_date' then nullif(p_payload->>'warranty_end_date','')::date else warranty_end_date end,
      notes              = case when p_payload ? 'notes' then p_payload->>'notes' else notes end,
      custom_fields      = case when p_payload ? 'custom_fields' then p_payload->'custom_fields' else custom_fields end,
      supplier_id        = case when p_payload ? 'supplier_id' then nullif(p_payload->>'supplier_id','')::uuid else supplier_id end,
      supplier_percent   = case when p_payload ? 'supplier_percent' then (p_payload->>'supplier_percent')::numeric else supplier_percent end,
      position_name      = case when p_payload ? 'position_name' then p_payload->>'position_name' else position_name end,
      candidate_name     = case when p_payload ? 'candidate_name' then p_payload->>'candidate_name' else candidate_name end,
      commission_percent = case when p_payload ? 'commission_percent' then (p_payload->>'commission_percent')::numeric else commission_percent end,
      salary             = case when p_payload ? 'salary' then (p_payload->>'salary')::numeric else salary end,
      net_invoice_amount = case when p_payload ? 'net_invoice_amount' then (p_payload->>'net_invoice_amount')::numeric else net_invoice_amount end,
      commission_amount  = case when p_payload ? 'commission_amount' then (p_payload->>'commission_amount')::numeric else commission_amount end,
      needs_approval     = case when p_payload ? 'needs_approval' then (p_payload->>'needs_approval')::boolean else needs_approval end,
      created_by         = case when p_payload ? 'created_by' then nullif(p_payload->>'created_by','')::uuid else created_by end,
      approved_by        = case when p_payload ? 'approved_by' then nullif(p_payload->>'approved_by','')::uuid else approved_by end,
      approved_at        = case when p_payload ? 'approved_at' then nullif(p_payload->>'approved_at','')::timestamptz else approved_at end,
      period_start       = case when p_payload ? 'period_start' then nullif(p_payload->>'period_start','')::date else period_start end,
      period_end         = case when p_payload ? 'period_end' then nullif(p_payload->>'period_end','')::date else period_end end,
      hours_total        = case when p_payload ? 'hours_total' then (p_payload->>'hours_total')::numeric else hours_total end,
      hourly_rate_used   = case when p_payload ? 'hourly_rate_used' then (p_payload->>'hourly_rate_used')::numeric else hourly_rate_used end
    where id = v_txn_id;
  else
    insert into transactions (
      kind, client_id, client_name, service_type, service_type_id, service_lead,
      entry_date, billing_month, billing_year, close_date, closing_month, closing_year,
      work_start_date, work_end_date, warranty_end_date, notes, custom_fields,
      supplier_id, supplier_percent, position_name, candidate_name,
      commission_percent, salary, net_invoice_amount, commission_amount,
      needs_approval, created_by, approved_by, approved_at,
      period_start, period_end, hours_total, hourly_rate_used
    ) values (
      p_payload->>'kind',
      nullif(p_payload->>'client_id','')::uuid,
      p_payload->>'client_name',
      p_payload->>'service_type',
      nullif(p_payload->>'service_type_id','')::uuid,
      p_payload->>'service_lead',
      nullif(p_payload->>'entry_date','')::date,
      (p_payload->>'billing_month')::int,
      (p_payload->>'billing_year')::int,
      nullif(p_payload->>'close_date','')::date,
      (p_payload->>'closing_month')::int,
      (p_payload->>'closing_year')::int,
      nullif(p_payload->>'work_start_date','')::date,
      nullif(p_payload->>'work_end_date','')::date,
      nullif(p_payload->>'warranty_end_date','')::date,
      p_payload->>'notes',
      coalesce(p_payload->'custom_fields', '{}'::jsonb),
      nullif(p_payload->>'supplier_id','')::uuid,
      (p_payload->>'supplier_percent')::numeric,
      p_payload->>'position_name',
      p_payload->>'candidate_name',
      (p_payload->>'commission_percent')::numeric,
      (p_payload->>'salary')::numeric,
      (p_payload->>'net_invoice_amount')::numeric,
      (p_payload->>'commission_amount')::numeric,
      coalesce((p_payload->>'needs_approval')::boolean, false),
      nullif(p_payload->>'created_by','')::uuid,
      nullif(p_payload->>'approved_by','')::uuid,
      nullif(p_payload->>'approved_at','')::timestamptz,
      nullif(p_payload->>'period_start','')::date,
      nullif(p_payload->>'period_end','')::date,
      (p_payload->>'hours_total')::numeric,
      (p_payload->>'hourly_rate_used')::numeric
    )
    returning id into v_txn_id;
  end if;

  -- Billing events: mirrors upsertBillingEvents() in billingEvents.ts —
  -- delete only events that haven't progressed (pending/to_bill), then
  -- insert the provided drafts except any event_index a billed/paid/
  -- cancelled row already occupies (so locked events are never touched).
  delete from billing_events
    where transaction_id = v_txn_id
      and status in ('pending', 'to_bill');

  if jsonb_array_length(coalesce(p_events, '[]'::jsonb)) > 0 then
    insert into billing_events (
      transaction_id, event_index, amount, description, billing_date,
      status, invoice_number, payment_date, receipt_number,
      advance_applied, supplier_amount
    )
    select
      v_txn_id,
      (e->>'event_index')::int,
      (e->>'amount')::numeric,
      e->>'description',
      nullif(e->>'billing_date','')::date,
      coalesce(e->>'status', 'pending'),
      nullif(e->>'invoice_number',''),
      nullif(e->>'payment_date','')::date,
      nullif(e->>'receipt_number',''),
      coalesce((e->>'advance_applied')::numeric, 0),
      coalesce((e->>'supplier_amount')::numeric, 0)
    from jsonb_array_elements(p_events) as e
    where not exists (
      select 1 from billing_events be
      where be.transaction_id = v_txn_id
        and be.event_index = (e->>'event_index')::int
    );
  end if;

  -- Auto-flip pending -> to_bill for past-dated events when approved.
  if p_flip_to_bill then
    update billing_events
      set status = 'to_bill'
      where transaction_id = v_txn_id
        and status = 'pending'
        and billing_date <= current_date;
  end if;

  -- Cancel future billing events when work_end_date is set.
  if p_work_end_date is not null then
    update billing_events
      set status = 'cancelled'
      where transaction_id = v_txn_id
        and status in ('pending', 'to_bill')
        and billing_date > p_work_end_date;
  end if;

  return v_txn_id;
end;
$func$;

grant execute on function public.save_transaction_with_events(text, uuid, jsonb, jsonb, boolean, date) to authenticated;

-- ============================================================================
-- Retroactive repair (D3) — reconstruct what's reconstructable on already-
-- live time_period transactions that were silently stripped by the old RPC.
-- ============================================================================

-- (a) net_invoice_amount from the transaction's billing-event total.
update transactions t
set net_invoice_amount = sub.total
from (
  select transaction_id, sum(amount) as total
  from billing_events
  where status <> 'cancelled'
  group by transaction_id
) sub
where t.id = sub.transaction_id
  and t.kind = 'time_period'
  and coalesce(t.net_invoice_amount, 0) = 0
  and sub.total > 0;

-- (b) period + hours from hours_log rows that are actually linked to the transaction.
update transactions t
set period_start = sub.ps,
    period_end   = sub.pe,
    hours_total  = sub.h
from (
  select billed_transaction_id as txn_id,
         min(visit_date) as ps, max(visit_date) as pe, sum(hours) as h
  from hours_log
  where billed_transaction_id is not null
  group by billed_transaction_id
) sub
where t.id = sub.txn_id
  and t.kind = 'time_period'
  and (t.period_start is null or t.period_end is null or coalesce(t.hours_total,0) = 0);

-- (c) hourly_rate_used, only where it can be derived unambiguously from the client.
update transactions t
set hourly_rate_used = c.hourly_rate
from clients c
where c.id = t.client_id
  and t.kind = 'time_period'
  and t.hourly_rate_used is null
  and c.hourly_rate is not null;

commit;
