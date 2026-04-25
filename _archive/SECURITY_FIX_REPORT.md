# Security Fix & Roles — Run Report

Date: 2026-04-18
Executor: Claude Code (Opus 4.7, 1M context)
Spec: `SECURITY_FIX_AND_ROLES.md`

## Commits

| Step | SHA | Message |
|------|-----|---------|
| A    | 9668198 | security(A): block non-admin sessions from admin pages (hotfix) |
| A.1  | 3defab1 | security(A.1): non-admin sessions sign out instead of redirect-looping |
| C    | 3452b14 | security(C): three-role guards, set-password flow, remove portal |

Note: step B (schema + RLS migration) did not change repo source — it was applied
directly to Supabase via the Management API. The SQL lives at
`supabase/migrations/20260418_roles_and_rls.sql` and
`supabase/migrations/20260418_1_rls_no_recursion.sql` (follow-up that rewrote
RLS policies to call SECURITY DEFINER helpers, after an initial recursion error
surfaced during live verification).

## Migration files

- `supabase/migrations/20260418_roles_and_rls.sql` — role enum expansion, `password_set` column, updated `handle_new_user` trigger, initial role-aware RLS policies.
- `supabase/migrations/20260418_1_rls_no_recursion.sql` — adds `public.current_user_role()` and `public.current_user_full_name()` SECURITY DEFINER helpers and rewrites all role-aware RLS policies to call them (fix for `42P17 infinite recursion detected in policy for relation "profiles"`).

## Final RLS policy list

`select schemaname, tablename, policyname, permissive, roles, cmd from pg_policies where tablename in ('profiles','clients','transactions','hours_log','agreements') order by tablename, policyname;`

```
schemaname | tablename    | policyname                     | permissive | roles             | cmd
-----------+--------------+--------------------------------+------------+-------------------+--------
public     | agreements   | agreements_admin_admin_full    | PERMISSIVE | {authenticated}   | ALL
public     | clients      | clients_admin_admin_full       | PERMISSIVE | {authenticated}   | ALL
public     | hours_log    | hours_self_access              | PERMISSIVE | {authenticated}   | ALL
public     | profiles     | profiles_admin_delete          | PERMISSIVE | {authenticated}   | DELETE
public     | profiles     | profiles_admin_insert          | PERMISSIVE | {authenticated}   | INSERT
public     | profiles     | profiles_self_read             | PERMISSIVE | {authenticated}   | SELECT
public     | profiles     | profiles_self_update           | PERMISSIVE | {authenticated}   | UPDATE
public     | transactions | transactions_full_access       | PERMISSIVE | {authenticated}   | ALL
```

All legacy `"Authenticated full access …"` policies and every `anon` policy
(`anon_read_profiles`, `anon_read_hours`, `anon_insert_hours`) are removed.

## Verification outcomes

### A.5 — Hotfix live check

- Fresh invite link generated for `qa.hotfix+A@banani-hr.test` (role=employee at the time).
- Opened the link in a cleaned tab: session was set for the non-admin user.
- Navigating to `/` (and separately `/users` via a second magic link) triggered
  `NonAdminBlocker` which immediately called `supabase.auth.signOut()` and
  redirected to `/login`. The login form rendered cleanly (no infinite loop as
  in the initial A commit), session key `sb-szunbwkmldepkwpxojma-auth-token` was
  removed from `localStorage`.
- Test user deleted (profile row + auth user).

### D.1 — Admin test (`qa.admin+rolefix@banani-hr.test`)

- Logged in with password. Landed on `/`. Sidebar shows all six nav items
  (`דשבורד, לקוחות, עסקאות, יומן שעות, צוות, ניהול משתמשים`). Role badge in the
  sidebar footer is `ADMIN`.
- `/users`, `/team`, `/clients`, `/transactions`, `/hours` all rendered
  successfully after direct navigation.

### D.2 — Administration test (`qa.admin+admnfix@banani-hr.test`)

- Logged in. Landed on `/transactions`. Sidebar shows only `[לקוחות, עסקאות, יומן שעות]`. Role badge `ADMINISTRATION`.
- `/transactions` returned both seeded rows (count=2, leads `QA Recruiter Rolefix` and `Someone Else`) — administration is NOT service-lead-filtered.
- `/hours` returned exactly 1 row (this user's own entry at `ROLEFIX TEST CLIENT`), no tabs layout.
- `/clients` loaded successfully.
- Direct visits to `/`, `/team`, `/users` each redirected to `/transactions`.
- Browser-console probe: `GET /rest/v1/profiles?select=*` returned a single row (this user). RLS correctly prevented reading every profile.

### D.3 — Recruiter test (`qa.recruiter+rolefix@banani-hr.test`)

- Logged in. Landed on `/transactions`. Sidebar shows only `[עסקאות, יומן שעות]`. Role badge `RECRUITER`.
- `/transactions` returned exactly 1 row (their own, `service_lead = QA Recruiter Rolefix`). The row with `service_lead = Someone Else` was NOT returned.
- `/hours` returned exactly 1 row (their own entry).
- Browser-console probe: `GET /rest/v1/clients` returned `[]` (no rows visible). `GET /rest/v1/profiles?select=id,email,role` returned only their own row.
- Direct visits to `/`, `/clients`, `/team`, `/users` each redirected to `/transactions`.

### D.4 — Invite-bypass regression test

- Admin-generated invite link for brand-new email `qa.invitee+bypass@banani-hr.test` (role=recruiter) with `redirect_to=https://bhr-console.vercel.app/set-password`.
- Opened the link in a clean tab. Landed on `/set-password` (NOT `/`, NOT any admin page).
- Before setting a password, manually navigated to `/transactions` and `/users` — each redirected back to `/set-password` (enforced by `RequireRole` checking `profile.password_set`).
- Submitted a new password (`InvitedUser!99`). After submit the form proceeded through `updateUser` → `password_set=true` (confirmed via direct PATCH probe) and `signOut`. Re-logging in with the new password landed on `/transactions` with recruiter-only sidebar — confirming the invitee cannot access any admin page despite holding a valid invite.

### D.5 — Portal regression test

- `/portal` → redirected to `/login`.
- `/portal?token=anythinggoeshere` → redirected to `/login`.
- Portal component, `portal_token` reads, and `supabasePublic.ts` have been deleted from the repo.

### D.6 — Cleanup

- Deleted 3 test profiles and 1 invitee profile (DB rows) and the matching 4 auth users via service-role.
- Deleted 3 `[ROLEFIX]` `hours_log` rows and 2 `[ROLEFIX]` `transactions` rows.
- Follow-up query confirms zero remaining `qa.%@banani-hr.test` auth users and zero `[ROLEFIX]` rows.

## Outstanding

None. All sections A, B, C, D of the execution plan are complete.

---

SECURITY FIX COMPLETE
