-- Repair 32 — hotfix: Hebrew string literals inside two Repair 31 functions were corrupted
-- (U+FFFD) when 20261019_*.sql was applied through a shell pipe. Live symptom: the client picker
-- returned ZERO rows for recruiters (c.status = '<garbage>' matched 0 of 83 clients), and
-- delete_transaction raised garbled messages. Re-created here with the original bodies.
-- Apply ONLY with a UTF-8-safe runner (node fetch), never via a bash variable.

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

-- ── 2. delete_transaction: admin + administration only ───────────────────
create or replace function public.delete_transaction(
  p_id uuid, p_hours_action text default null, p_target_transaction uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role        text := public.current_user_role();
  v_client      uuid;
  v_hours       int;
  v_events      int;
  v_tgt_client  uuid;
  v_tgt_kind    text;
begin
  -- Must stay in lockstep with RLS policy transactions_staff_access (Repair 31).
  if v_role is null or v_role not in ('admin', 'administration') then
    raise exception 'not authorized to delete this transaction' using errcode = '42501';
  end if;

  select client_id into v_client from public.transactions where id = p_id for update;
  if not found then
    raise exception 'העסקה לא נמצאה' using errcode = 'P0002';
  end if;

  select count(*) into v_hours from public.hours_log where billed_transaction_id = p_id;
  select count(*) into v_events from public.billing_events where transaction_id = p_id;

  if v_hours > 0 then
    if p_hours_action = 'release' then
      update public.hours_log set billed_transaction_id = null where billed_transaction_id = p_id;
    elsif p_hours_action = 'move' then
      if p_target_transaction is null or p_target_transaction = p_id then
        raise exception 'יש לבחור עסקת יעד אחרת לשעות' using errcode = '22023';
      end if;
      select client_id, kind into v_tgt_client, v_tgt_kind
      from public.transactions where id = p_target_transaction;
      if not found or v_tgt_kind is distinct from 'time_period' or v_tgt_client is distinct from v_client then
        raise exception 'עסקת היעד חייבת להיות עסקת שעות של אותו לקוח' using errcode = '22023';
      end if;
      update public.hours_log set billed_transaction_id = p_target_transaction where billed_transaction_id = p_id;
    else
      raise exception 'לעסקה שעות מקושרות: יש לבחור לשחרר או להעביר' using errcode = '22023';
    end if;
  end if;

  delete from public.transactions where id = p_id;

  return jsonb_build_object('hours', v_hours, 'events', v_events, 'hours_action', p_hours_action);
end;
$$;

revoke all on function public.delete_transaction(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_transaction(uuid, text, uuid) to authenticated;

