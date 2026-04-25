# CRITICAL: Close the invite-link auth bypass and implement three-role access control

This task fixes a **production security vulnerability**. Oren invited himself as an
`employee`, opened the invite link on a second device, and gained full admin access
to the entire app without ever signing in. Work this task to completion as the top
priority. Do not stop, do not summarize mid-run, do not ask questions. Report in
`SECURITY_FIX_REPORT.md` when finished.

## Read first

1. `BHR_CONSOLE_PROJECT.md` (spec — source of truth).
2. `BHR_CONSOLE_CHECKLIST.md` (existing acceptance state).
3. This file in full.

## Root cause (for your reference)

1. **Supabase invite link = auth token.** The `invite-user` edge function calls
   `auth.admin.generateLink({ type: 'invite' })`, which produces a link that, when
   opened, sets a Supabase session cookie for the invited user **before any password
   is set**. There is no forced password-creation step.
2. **`ProtectedRoute` only checks `!!user`.** It does not check `user.role`. Any
   authenticated Supabase user — admin or employee — gets into every admin page
   that is wrapped in `ProtectedRoute` rather than `AdminRoute`. Most admin pages
   are wrapped in `ProtectedRoute`.
3. **RLS is permissive.** The `authenticated` role has `ALL` access on `profiles`,
   `clients`, `agreements`, `transactions`, `hours_log`. Any logged-in user can
   read and write everyone's data at the database level, which means even fixing
   the routes alone is not sufficient.
4. **`portal_token` is an unauthenticated bypass.** Anyone holding the token URL
   can read the associated employee's data with no login. It's a URL-as-password
   with no expiry, no scope, no rotation — remove it.

## Target design — three-role model

### Schema

Replace `profiles.role` with the three-role enum.

```sql
-- Migration: expand profiles.role from {admin, employee} to {admin, recruiter, administration}
alter table profiles drop constraint if exists profiles_role_check;

-- Map existing rows. Rule: admins stay admin; existing employees with
-- hours_category_enabled become administration; everyone else becomes recruiter.
-- The admin can re-classify from /users afterwards.
update profiles set role = 'administration'
  where role = 'employee' and hours_category_enabled = true;
update profiles set role = 'recruiter'
  where role = 'employee';

alter table profiles
  add constraint profiles_role_check
  check (role in ('admin', 'recruiter', 'administration'));
```

Also update the `handle_new_user` trigger default from `'employee'` to `'recruiter'`
(safer-by-default — lowest privilege for newly invited users until the admin
confirms their role).

**Remove `portal_token`** from active use. Either drop the column or leave it in the
schema but stop reading from it in any code path. The `/portal` route is deleted.

### Access matrix (enforce in both the route layer AND RLS)

| Page / resource       | admin | administration | recruiter |
|-----------------------|:-----:|:--------------:|:---------:|
| `/` (Dashboard)       |  ✅   |       ❌       |    ❌     |
| `/clients`            |  ✅   |       ✅       |    ❌     |
| `/transactions` (list, all rows) | ✅ | ✅       |    ❌     |
| `/transactions` (list, own rows only — filtered by `service_lead = my full_name`) | —  | — | ✅ |
| `/hours` (all rows)   |  ✅   |       ❌       |    ❌     |
| `/hours` (own rows only — filtered by `profile_id = auth.uid()`) | — | ✅ | ✅ |
| `/team`               |  ✅   |       ❌       |    ❌     |
| `/users`              |  ✅   |       ❌       |    ❌     |
| `/portal*`            |  ❌ (removed) |   ❌   |    ❌     |
| Invite / reset pw / delete user | admin | ❌ | ❌ |

Default landing page after login:

- `admin` → `/`
- `administration` → `/transactions`
- `recruiter` → `/transactions` (will be filtered to own rows)

### RLS — defense in depth

Route guards alone are not enough. Add RLS so a compromised frontend or direct API
access cannot read more than the role allows.

```sql
-- profiles: users see own row; admins see all
drop policy if exists "auth_full_profiles" on profiles;
drop policy if exists "anon_read_profiles" on profiles;

create policy "profiles_self_read"   on profiles for select to authenticated
  using ( id = auth.uid() or (select role from profiles where id = auth.uid()) = 'admin' );
create policy "profiles_self_update" on profiles for update to authenticated
  using ( id = auth.uid() or (select role from profiles where id = auth.uid()) = 'admin' );
create policy "profiles_admin_insert" on profiles for insert to authenticated
  with check ( (select role from profiles where id = auth.uid()) = 'admin' );
create policy "profiles_admin_delete" on profiles for delete to authenticated
  using ( (select role from profiles where id = auth.uid()) = 'admin' );

-- clients: admin + administration full; recruiter no access
drop policy if exists "Authenticated full access" on clients;
create policy "clients_admin_admin_full" on clients for all to authenticated
  using ( (select role from profiles where id = auth.uid()) in ('admin','administration') )
  with check ( (select role from profiles where id = auth.uid()) in ('admin','administration') );

-- transactions: admin + administration full; recruiter only rows where service_lead matches their full_name
drop policy if exists "Authenticated full access" on transactions;
create policy "transactions_full_access" on transactions for all to authenticated
  using (
    (select role from profiles where id = auth.uid()) in ('admin','administration')
    or service_lead = (select full_name from profiles where id = auth.uid())
  )
  with check (
    (select role from profiles where id = auth.uid()) in ('admin','administration')
    or service_lead = (select full_name from profiles where id = auth.uid())
  );

-- hours_log: admin all; everyone else own rows only
drop policy if exists "auth_full_hours" on hours_log;
drop policy if exists "anon_read_hours" on hours_log;
drop policy if exists "anon_insert_hours" on hours_log;
create policy "hours_self_access" on hours_log for all to authenticated
  using (
    profile_id = auth.uid()
    or (select role from profiles where id = auth.uid()) = 'admin'
  )
  with check (
    profile_id = auth.uid()
    or (select role from profiles where id = auth.uid()) = 'admin'
  );

-- No anon policies remain on any of these tables. The portal is gone.
```

If the anon role previously had access to any table (portal lookup used to read
`profiles` and `hours_log` anonymously), remove those policies completely.

### Invite flow — close the bypass

1. The edge function continues to generate an invite link via
   `auth.admin.generateLink({ type: 'invite' })`, but:
   - The invite link's redirect target becomes `/set-password` (a new route).
   - `/set-password` loads the session but **does not render the app chrome**. It
     only renders a password-creation form.
   - On submit it calls `supabase.auth.updateUser({ password })`, then
     **signs the user out** and navigates to `/login`. The user must log in
     with email + password to actually access the app.
   - Until the user has set a password, their `profiles.password_set = true`
     flag is false (add this boolean column, default false, set to true on
     password submit). `ProtectedRoute` refuses to render the app for any user
     whose `password_set` is false — it force-redirects to `/set-password`.
2. Remove `/portal` entirely (delete the route, the file, and the nav). Remove
   `portal_token` from any frontend reads; stop setting it in the edge function.
3. The existing `resetPasswordForEmail` flow continues to work.

### Route guards

Replace `ProtectedRoute` and `AdminRoute` with a single `RequireRole` component:

```tsx
<RequireRole allow={['admin']}>                   ...  /* /users, /team, / */
<RequireRole allow={['admin','administration']}>  ...  /* /clients */
<RequireRole allow={['admin','administration','recruiter']}> ... /* /transactions, /hours */
```

`RequireRole` must:
- Redirect to `/login` if no session.
- Redirect to `/set-password` if session exists but `profiles.password_set` is false.
- Redirect to the role's default landing page if the role is not in `allow`.

### UI filtering (defense after RLS)

- Sidebar: hide nav items the current role cannot access.
- Transactions page: for `recruiter`, the query is already filtered by RLS; also
  hide bulk-edit / delete affordances that aren't theirs (safety).
- Hours page: for `administration` and `recruiter`, render only the employee's own
  entries. Do not show the "tabs per client" admin variant — a single personal
  view is sufficient.
- Dashboard KPI cards: admin only.

## Hard rules

1. **Read `.env.local`** for `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_ACCESS_TOKEN`. Never print, log, or commit these.
2. **English only** for reasoning and commit messages.
3. **Every change must be live-verified in Chrome against
   https://bhr-console.vercel.app** after deploy, not in `npm run dev`.
4. **No deferrals.** If a check requires a role-X test user, create one via
   service role and clean it up at the end.

## Execution plan

Work sections in this order. Each section ends with a live check in Chrome.

### A. Stop the bleeding (same commit, deployed within 5 minutes)

Before building the full role model, deploy a narrow hotfix that makes every
currently-`ProtectedRoute`-wrapped admin page require `role === 'admin'`. This
closes the invite-link bypass immediately even though the three-role split hasn't
landed yet.

1. Read `src/App.tsx`, `src/components/*` for the current route guards.
2. Change every non-portal admin route to use `AdminRoute` (not `ProtectedRoute`),
   or inline `role === 'admin'` into `ProtectedRoute`.
3. Leave `/portal` as-is for now (it's gone in step C, this is the hotfix only).
4. `npm run build`, commit
   `security(A): block non-admin sessions from admin pages (hotfix)`, push.
5. Wait 90s. In Chrome, generate an invite link for a brand-new test email via
   the edge function, open it, and confirm:
   - Landing on `/`, `/clients`, `/transactions`, `/hours`, `/team`, or `/users`
     now redirects to `/login` or shows a forbidden state.
   - The previous behavior (session-granted admin access) is gone.
   Delete the test user.

### B. Schema + RLS migration

1. Compose the migration SQL from the "Schema" and "RLS — defense in depth"
   sections above into a single `supabase/migrations/<timestamp>_roles_and_rls.sql`.
2. Apply via the Supabase CLI (export `SUPABASE_ACCESS_TOKEN` from `.env.local`):
   ```bash
   npx supabase db push --project-ref szunbwkmldepkwpxojma
   ```
   If the CLI path doesn't work in this repo's setup, apply the SQL via the
   Management API `query` endpoint instead — but apply it once, atomically.
3. Verify with a service-role query that the check constraint accepts the three
   roles and rejects `'employee'`; that every existing profile row has one of
   the three roles; that no anon policies remain on `profiles`, `clients`,
   `transactions`, `hours_log`.
4. Update the schema snippet in `BHR_CONSOLE_PROJECT.md` to reflect the new
   role values and RLS policies.

### C. Frontend: new guards, new invite flow, portal removal

1. Add `profiles.password_set boolean default false` (migration). Backfill
   `true` for the existing admin. Update `handle_new_user` to keep it `false`
   for new users.
2. Build `<RequireRole allow={[...]}>`. Replace `ProtectedRoute` and
   `AdminRoute` usages throughout `src/App.tsx`.
3. Create `src/pages/SetPassword.tsx`: reads the session, forces password entry,
   on submit calls `supabase.auth.updateUser({ password })` + sets
   `profiles.password_set=true` + `supabase.auth.signOut()` + navigates to
   `/login`.
4. Update `invite-user` edge function so the invite link's `redirect_to` is
   `/set-password` on the site origin. Leave the email content otherwise the
   same (verified `banani-hr.com` sender from the previous task).
5. **Delete `src/pages/Portal.tsx`**, remove its route from `App.tsx`, remove
   the portal-link UI from `/team`, and remove all `portal_token` reads from
   the codebase. Optionally drop the column in the schema migration — but at
   minimum stop reading it.
6. Sidebar: filter nav items by role. Administration sees
   [לקוחות, עסקאות, יומן שעות]; Recruiter sees [עסקאות, יומן שעות]; Admin sees
   all six as today.
7. Transactions page: same component, but queries respect RLS. Verify a
   recruiter session only returns own rows. Hide bulk/destructive admin
   actions for non-admins.
8. Hours page: render a single personal view for recruiter and administration
   (no client-tabs layout). Admin still sees the full tabs variant.
9. Default landing: after `/login`, redirect to the role's default page (admin
   → `/`, administration → `/transactions`, recruiter → `/transactions`).

Build, commit `security(C): three-role guards, set-password flow, remove portal`,
push, wait 90s.

### D. Live verification — every role, every boundary

Create three test users via service role with a known password each, emails
`qa.admin+rolefix@banani-hr.test`, `qa.admin+admnfix@banani-hr.test`,
`qa.recruiter+rolefix@banani-hr.test`. Set `password_set=true` and `role` via
service role to skip the set-password flow for the test accounts.

For each role, in a fresh Chrome profile / incognito window:

1. **Admin test:**
   - Log in. Land on `/`. All six nav items visible. Every page loads.
2. **Administration test:**
   - Log in. Land on `/transactions`. Nav shows only [לקוחות, עסקאות, יומן שעות].
   - `/clients` loads; can edit a client. `/transactions` loads and shows all
     transactions (not filtered). `/hours` loads and shows ONLY this user's
     rows (seed two rows — one with `profile_id = this user`, one with a
     different `profile_id` — confirm only one appears).
   - Directly visit `/`, `/team`, `/users` → each must redirect away (to
     `/transactions`).
   - Open the browser console. Call `supabase.from('profiles').select('*')`
     directly: must return only this user's row plus any admins' rows they
     have legitimate access to — NOT every row.
3. **Recruiter test:**
   - Log in. Land on `/transactions`. Nav shows only [עסקאות, יומן שעות].
   - Seed a transaction with `service_lead = 'QA Recruiter'` (their full_name)
     and another with a different `service_lead`. `/transactions` must show
     ONLY the first one.
   - `/hours` shows only their own entries.
   - Directly visit `/`, `/clients`, `/team`, `/users` → redirect away.
   - Via browser console: `supabase.from('clients').select('*')` must return
     `[]` or `401`. `supabase.from('transactions').select('*')` must return
     only their own rows.
4. **Invite-bypass regression test:**
   - Generate an invite link for a brand-new email via the edge function.
   - Open the link in a fresh incognito window. You must land on
     `/set-password`, NOT on `/` or any admin page.
   - Before setting a password, manually navigate to `/`, `/clients`, etc. —
     each must redirect back to `/set-password`.
   - Set the password. Confirm it signs you out and lands on `/login`.
   - Log in. Confirm the role-appropriate landing page.
5. **Portal regression test:**
   - Visit `/portal`, `/portal?token=x`, and any previously-valid portal URL.
     Each must 404 or redirect to `/login`.
6. **Cleanup:** delete all `qa.` test users.

## Git & safety

- Never commit `.env.local` or anything in `.gitignore`.
- Never print or echo secret values.
- Never `git reset --hard` or amend pushed commits.
- If a push is rejected non-fast-forward: `git pull --rebase origin main`, resolve, push.

## Termination

When all of A, B, C, D pass:

1. Update `BHR_CONSOLE_PROJECT.md` to reflect the new role model, RLS policies,
   removal of `portal_token`/`/portal`, and the `/set-password` flow.
2. Mark the affected items in `BHR_CONSOLE_CHECKLIST.md` with live evidence.
   Add a new §14 "Security & role-based access" block with the role matrix and
   the five regression tests above, each checked off with the evidence from D.
3. Write `SECURITY_FIX_REPORT.md`:
   - Commit SHAs for A, B, C.
   - Migration file path.
   - The final RLS policy list (copy the output of
     `select schemaname, tablename, policyname, permissive, roles, cmd from pg_policies where tablename in ('profiles','clients','transactions','hours_log','agreements') order by tablename, policyname;`).
   - Outcome of each of the six verification tests (A.5, D.1–D.5 + cleanup).
4. Print `SECURITY FIX COMPLETE` and stop.

Start now. Begin with step A (the hotfix) — it closes the bypass within minutes
even before the full refactor lands.
