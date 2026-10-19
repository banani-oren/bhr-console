-- Repair 35 (2026-10-19)
-- A. search_clients_for_picker: the p_id row (the client already chosen) is ALWAYS returned. Before, an empty
--    query returned the first 50 active clients by name, so a client sorting after the 50th (29 of 79 active
--    clients) was cut by the LIMIT: the recruiter's picker lost the name and the % עמלה / ימי אחריות prefill.
-- B. clients.status vocabulary: exactly 'פעיל' | 'לא פעיל' (CHECK). On 2026-10-19 the table held 79 'פעיל' + 3
--    'לא פעיל', no other value, so the normalization UPDATEs below touch 0 rows; kept for safety.
-- Apply ONLY with a UTF-8-safe runner (node fetch), never via a bash variable.

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
  order by coalesce(c.id = p_id, false) desc, c.name
  limit 50;
$$;
revoke all on function public.search_clients_for_picker(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.search_clients_for_picker(text, uuid) to authenticated;

update public.clients set status = 'פעיל' where status = 'active';
update public.clients set status = 'לא פעיל' where status in ('inactive', 'לא-פעיל', 'לא פעילה');
alter table public.clients alter column status set default 'פעיל';
alter table public.clients alter column status set not null;
alter table public.clients add constraint clients_status_check check (status in ('פעיל', 'לא פעיל'));
