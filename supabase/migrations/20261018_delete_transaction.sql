-- Repair 26 — deliberate deal deletion + hours_log audit.
--
-- hours_log.billed_transaction_id → transactions(id) has NO ON DELETE action, so
-- deleting any deal with linked hours fails with FK 23503; the UI swallowed the
-- error. The FK is intentionally NOT changed to SET NULL: silently releasing
-- billed hours invites double billing, so the caller must choose.
-- billing_events.transaction_id is ON DELETE CASCADE (paid events go with the deal).

-- ── 1. hours_log joins the audit log (standing rule, Repair 24) ─────────────
alter table public.audit_log drop constraint if exists audit_log_table_name_check;
alter table public.audit_log add constraint audit_log_table_name_check
  check (table_name in ('transactions','billing_events','clients','hours_log'));

create or replace function public.bhr_audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_ign     text[] := array['updated_at', 'created_at'];
  k         text;
  ck        text;
  v_row_id  uuid;
  v_parent  uuid;
  v_bkey    text;
  v_label   text;
  v_parent_name text;
  v_actor   uuid;
  v_actor_name text;
  v_base    jsonb;
begin
  -- A logging failure must never roll back business data.
  begin
    if TG_OP = 'DELETE' then
      v_old := to_jsonb(OLD);
    elsif TG_OP = 'INSERT' then
      v_new := to_jsonb(NEW);
    else
      v_old := to_jsonb(OLD);
      v_new := to_jsonb(NEW);
    end if;
    v_base := coalesce(v_new, v_old);

    if TG_OP = 'UPDATE' then
      for k in select jsonb_object_keys(v_new) loop
        continue when k = any (v_ign);
        if (v_old -> k) is distinct from (v_new -> k) then
          if k = 'custom_fields'
             and jsonb_typeof(v_old -> k) = 'object' and jsonb_typeof(v_new -> k) = 'object' then
            for ck in
              select x from (
                select jsonb_object_keys(v_old -> k) x
                union
                select jsonb_object_keys(v_new -> k)
              ) u
            loop
              if ((v_old -> k) -> ck) is distinct from ((v_new -> k) -> ck) then
                v_changes := v_changes || jsonb_build_object(
                  'custom_fields.' || ck,
                  jsonb_build_object('old', (v_old -> k) -> ck, 'new', (v_new -> k) -> ck));
              end if;
            end loop;
          else
            v_changes := v_changes || jsonb_build_object(
              k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k));
          end if;
        end if;
      end loop;
      if v_changes = '{}'::jsonb then
        return null;   -- no real change → no noise
      end if;
    else
      v_changes := v_base - v_ign;
    end if;

    v_row_id := (v_base ->> 'id')::uuid;
    if TG_TABLE_NAME = 'billing_events' then
      v_parent := (v_base ->> 'transaction_id')::uuid;
      v_bkey   := (v_base ->> 'transaction_id') || ':' || (v_base ->> 'event_index');
      select client_name into v_parent_name from public.transactions where id = v_parent;
      v_label  := coalesce(v_parent_name, '') || ' · ' || coalesce(v_base ->> 'description', '');
    elsif TG_TABLE_NAME = 'transactions' then
      v_parent := nullif(v_base ->> 'client_id', '')::uuid;
      v_bkey   := v_row_id::text;
      v_label  := coalesce(v_base ->> 'client_name', '') || ' · '
                  || coalesce(v_base ->> 'position_name', v_base ->> 'service_type', '');
    elsif TG_TABLE_NAME = 'hours_log' then
      v_parent := nullif(v_base ->> 'client_id', '')::uuid;
      v_bkey   := v_row_id::text;
      v_label  := coalesce(v_base ->> 'client_name', '') || ' · '
                  || coalesce(v_base ->> 'visit_date', '') || ' · ' || coalesce(v_base ->> 'hours', '') || ' ש׳';
    else
      v_parent := null;
      v_bkey   := v_row_id::text;
      v_label  := v_base ->> 'name';
    end if;

    v_actor := auth.uid();
    if v_actor is not null then
      select full_name into v_actor_name from public.profiles where id = v_actor;
    end if;

    insert into public.audit_log
      (actor_id, actor_name, table_name, row_id, parent_id, business_key, action, row_label, changes)
    values
      (v_actor, v_actor_name, TG_TABLE_NAME, v_row_id, v_parent, v_bkey, lower(TG_OP), v_label, v_changes);
  exception when others then
    raise warning 'bhr_audit_row failed (%): %', TG_TABLE_NAME, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.bhr_audit_row() from public, anon, authenticated, service_role;

drop trigger if exists bhr_audit_hours_log on public.hours_log;
create trigger bhr_audit_hours_log
  after insert or update or delete on public.hours_log
  for each row execute function public.bhr_audit_row();

-- ── 2. delete_transaction ───────────────────────────────────────────────────
-- Atomic: relink/release the deal's hours, then delete the deal (its billing
-- events cascade). SECURITY DEFINER because hours_log RLS only lets the hours'
-- own owner or an admin write, while administration / the deal's lead must be able
-- to delete the deal.
--
-- ⚠ LOCKSTEP: the authorization below re-implements the live policy
-- transactions_full_access (admin/administration, OR service_lead =
-- current_user_full_name()). Change both together (same discipline as
-- save_transaction_with_events).
create or replace function public.delete_transaction(
  p_id                 uuid,
  p_hours_action       text default null,   -- 'release' | 'move' (required only if hours are linked)
  p_target_transaction uuid default null    -- required when p_hours_action = 'move'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role        text := public.current_user_role();
  v_name        text := public.current_user_full_name();
  v_lead        text;
  v_client      uuid;
  v_hours       int;
  v_events      int;
  v_tgt_client  uuid;
  v_tgt_kind    text;
begin
  select service_lead, client_id into v_lead, v_client
  from public.transactions where id = p_id for update;
  if not found then
    raise exception 'העסקה לא נמצאה' using errcode = 'P0002';
  end if;

  if not (v_role in ('admin', 'administration') or v_lead = v_name) then
    raise exception 'not authorized to delete this transaction' using errcode = '42501';
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
