-- Repair 24 — יומן שינויים (data-change audit log)
-- Scope: transactions, billing_events, clients. Admin-read-only, append-only.
-- save_transaction_with_events is NOT touched: the RPC's delete-then-reinsert of
-- unchanged pending events is collapsed on the READ side (get_audit_log).

create table if not exists public.audit_log (
  id           bigserial primary key,
  occurred_at  timestamptz not null default now(),
  txid         bigint      not null default txid_current(),
  actor_id     uuid,                 -- auth.uid(); null = system / service role
  actor_name   text,                 -- snapshot of profiles.full_name at write time
  table_name   text        not null check (table_name in ('transactions','billing_events','clients')),
  row_id       uuid        not null,
  parent_id    uuid,                 -- billing_events → transaction_id; transactions → client_id; clients → null
  business_key text,                 -- billing_events: transaction_id||':'||event_index; else row_id
  action       text        not null check (action in ('insert','update','delete')),
  row_label    text,
  changes      jsonb       not null  -- update: {col:{old,new}} changed cols only; insert/delete: full row snapshot
);
create index if not exists audit_log_occurred_at_idx on public.audit_log (occurred_at desc);
create index if not exists audit_log_table_row_idx   on public.audit_log (table_name, row_id);
create index if not exists audit_log_parent_idx      on public.audit_log (parent_id);
create index if not exists audit_log_actor_idx       on public.audit_log (actor_id);

alter table public.audit_log enable row level security;
drop policy if exists admin_audit_log_read on public.audit_log;
create policy admin_audit_log_read on public.audit_log
  for select using (public.current_user_role() = 'admin');

revoke all on public.audit_log from public, anon, authenticated;
grant select on public.audit_log to authenticated;
revoke all on sequence public.audit_log_id_seq from public, anon, authenticated;

-- ── Trigger function ────────────────────────────────────────────────────
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

drop trigger if exists bhr_audit_transactions on public.transactions;
create trigger bhr_audit_transactions
  after insert or update or delete on public.transactions
  for each row execute function public.bhr_audit_row();

drop trigger if exists bhr_audit_billing_events on public.billing_events;
create trigger bhr_audit_billing_events
  after insert or update or delete on public.billing_events
  for each row execute function public.bhr_audit_row();

drop trigger if exists bhr_audit_clients on public.clients;
create trigger bhr_audit_clients
  after insert or update or delete on public.clients
  for each row execute function public.bhr_audit_row();

-- ── Read function: collapses the RPC's delete+reinsert noise ────────────
create or replace function public.get_audit_log(
  p_from   timestamptz,
  p_to     timestamptz,
  p_actor  uuid default null,
  p_table  text default null,
  p_search text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  occurred_at timestamptz,
  actor_name  text,
  table_name  text,
  row_id      uuid,
  parent_id   uuid,
  action      text,
  row_label   text,
  changes     jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.current_user_role(), '') <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with base as (
    select a.*
    from public.audit_log a
    where a.occurred_at >= p_from and a.occurred_at <= p_to
      and (p_actor is null or a.actor_id = p_actor)
      and (p_table is null or a.table_name = p_table)
  ),
  dels as (
    select b.*, row_number() over (partition by b.txid, b.business_key order by b.id) rn
    from base b where b.table_name = 'billing_events' and b.action = 'delete'
  ),
  inss as (
    select b.*, row_number() over (partition by b.txid, b.business_key order by b.id) rn
    from base b where b.table_name = 'billing_events' and b.action = 'insert'
  ),
  pairs as (
    select d.id did, i.id iid,
           d.changes dchg, i.changes ichg,
           i.occurred_at, i.actor_id, i.actor_name, i.row_id, i.parent_id, i.row_label
    from dels d join inss i
      on i.txid = d.txid and i.business_key = d.business_key and i.rn = d.rn
  ),
  pair_diff as (
    select p.*,
      (select coalesce(jsonb_object_agg(k, jsonb_build_object('old', p.dchg -> k, 'new', p.ichg -> k)), '{}'::jsonb)
         from (select jsonb_object_keys(p.dchg) k union select jsonb_object_keys(p.ichg)) ks
        where k <> 'id' and (p.dchg -> k) is distinct from (p.ichg -> k)) diff
    from pairs p
  ),
  logical as (
    -- unpaired rows, as themselves
    select b.occurred_at, b.actor_name, b.table_name, b.row_id, b.parent_id, b.action, b.row_label, b.changes
    from base b
    where not exists (select 1 from pairs p where p.did = b.id or p.iid = b.id)
    union all
    -- differing pairs → ONE update; identical pairs are dropped entirely
    select pd.occurred_at, pd.actor_name, 'billing_events', pd.row_id, pd.parent_id, 'update', pd.row_label, pd.diff
    from pair_diff pd
    where pd.diff <> '{}'::jsonb
  ),
  filtered as (
    select l.* from logical l
    where p_search is null or p_search = '' or l.row_label ilike '%' || p_search || '%'
  )
  select f.occurred_at, f.actor_name, f.table_name, f.row_id, f.parent_id, f.action, f.row_label, f.changes,
         count(*) over () as total_count
  from filtered f
  order by f.occurred_at desc, f.row_id
  limit greatest(p_limit, 1) offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.get_audit_log(timestamptz, timestamptz, uuid, text, text, int, int)
  from public, anon, authenticated, service_role;
grant execute on function public.get_audit_log(timestamptz, timestamptz, uuid, text, text, int, int)
  to authenticated;
