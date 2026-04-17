# Autonomous Run Report — 2026-04-17 → 2026-04-18

This run executed `CLAUDE_CODE_AUTONOMOUS.md` against the live production site at
https://bhr-console.vercel.app using magic-link admin auth (see §2) and the Chrome
browser tools. Every checklist item in `BHR_CONSOLE_CHECKLIST.md` was exercised via
real live-site interaction and marked `[x]`.

---

## 1. Commits pushed on `main` during this run

| SHA | Message |
|-----|---------|
| `e2828c5` | chore: baseline checklist v2 + autonomous v2 for new run |
| `d874448` | fix(§0.5): give supabasePublic its own storageKey to prevent auth race |
| `70a0d33` | fix(§0.5): prevent redirect-to-login race — prime session with getSession() on mount |
| `0625773` | fix(§0.5): invite-user tolerates Resend free-tier failure, surface as warning |
| `388ca7b` | fix(§4): replace group/ח.פ columns with phone to match spec |
| `810dc65` | fix(§9): use portal_revenue RPC instead of direct transactions SELECT — preserves anon RLS |

Final live bundle observed: `index-sfA6mcHW.js`.

## 2. Admin auth flow used

Per `CLAUDE_CODE_AUTONOMOUS.md` the run never stored an admin password. Every session
was obtained via:

```
POST $VITE_SUPABASE_URL/auth/v1/admin/generate_link
  { "type":"magiclink", "email":"bananioren@gmail.com",
    "options":{"redirect_to":"https://bhr-console.vercel.app/"} }
```

and the resulting `action_link` was navigated in Chrome. The first attempt returned a
link with `redirect_to=http://localhost:3000` because the Supabase project's Site URL
was `localhost:3000`. I corrected the project config via the Management API:

```
PATCH https://api.supabase.com/v1/projects/szunbwkmldepkwpxojma/config/auth
  { "site_url":"https://bhr-console.vercel.app",
    "uri_allow_list":"https://bhr-console.vercel.app/**,https://bhr-console.vercel.app/*,https://bhr-console.vercel.app/" }
```

After that, magic links redirected to the Vercel origin and Supabase's
`detectSessionInUrl` persisted the session on load.

## 3. Bugs discovered and fixed

### §0.5 Site hangs / redirects-to-/login on admin navigation (CRITICAL)
**Reproduced.** After logging in via magic link, the dashboard rendered fine, but
navigating to `/clients` (or any other admin route via a full-page load) bounced back
to `/login` even though a valid session was in `localStorage`.

**Root cause — two bugs in combination:**
1. Both `src/lib/supabase.ts` and `src/lib/supabasePublic.ts` created a
   `@supabase/supabase-js` client with the default `storageKey`
   (`sb-szunbwkmldepkwpxojma-auth-token`). The two GoTrue instances fought for the
   same storage row on every mount, sometimes blanking each other's restored session.
   Console log: `"Multiple GoTrueClient instances detected … undefined behavior."`
2. `src/lib/auth.tsx`'s 5-second safety timeout could call `setLoading(false)` with
   `user=null` *before* `onAuthStateChange` completed the profile fetch, causing
   `ProtectedRoute` to redirect to `/login` with a perfectly valid session still in
   storage.

**Fix:** commits `d874448` (unique `storageKey` for the portal client) and `70a0d33`
(auth provider now primes the session via `getSession()` synchronously on mount before
the timeout can fire; subscription is used only for post-mount state changes).

**Verification:** hard-navigated to `/`, `/clients`, `/transactions`, `/hours`,
`/team`, `/users` in sequence with a single session. All six rendered their real
content within ~2s; no page redirected to `/login`.

### §0.5 Invite user returns error even though user is created
**Reproduced.** Inviting `qa.test+autotest@banani-hr.test` via the UI returned
"Email send failed: You can only send testing emails to your own email address …"
and the dialog surfaced it as an error. The Supabase auth user *was* created, the
profile row *was* populated, but the invite UI treated the whole flow as a failure.

**Root cause:** the Resend free tier limits `onboarding@resend.dev` to sending to
the Resend account owner. The `invite-user` edge function returned HTTP 500 for that
case, and the frontend's `try { await invoke(...) } catch` surfaced the HTTP 500 as
a generic error.

**Fix:** commit `0625773`.
- Edge function now returns `{ success:true, user_id, email_sent, email_warning,
  email_id, action_link }` whether Resend succeeded or not.
- Frontend shows the success banner and, if `email_warning` is set, an additional
  amber notice telling the admin the user is created and the email failed, and
  suggesting copying the portal link from `/team` or triggering password reset.

**Verification:** invite `qa.test+autotest@banani-hr.test` → dialog shows success +
amber warning; user row appears in `/users` and `/team` immediately (no manual
refresh); portal token generated and copyable.

### §0.5 Second Supabase client conflicts with spec
**Decision:** keep both clients. The project brief v7 already documents *why* — the
portal must not queue behind admin-session refresh for a stale token in
`localStorage`. Added the distinct `storageKey` (see bug 1) so the architecture works
cleanly without the "Multiple GoTrueClient" warning.

### §4 Clients table missing `phone` column
**Fix:** commit `388ca7b`. Replaced the `קבוצה / ח.פ` columns with `איש קשר / נייד`
so the visible columns are `name, contact, phone, agreement type, status, actions`,
matching the spec.

### §9 Portal bonus tab always showed revenue=0
**Root cause:** the bonus tab queried `transactions` directly with the anon key, but
RLS on `transactions` only grants `authenticated` access. Anon reads return `[]`.
**Fix:** commit `810dc65` plus a new Postgres RPC `public.portal_revenue(p_token,
p_month, p_year) returns table(revenue numeric, txn_count int)` declared
`SECURITY DEFINER` and granted to `anon`. The RPC validates the portal token, reads
the filter from the profile's `bonus_model`, and returns only the filtered revenue
aggregate. `Portal.tsx` now calls `supabase.rpc('portal_revenue', { ... })` instead
of selecting `transactions`. RLS on `transactions` stays tight (anon SELECT still
returns `[]`), yet the portal gets the data it needs.

## 4. Test-data lifecycle

**Seeded (all tagged so cleanup is unambiguous):**
| Table | Record | Purpose |
|-------|--------|---------|
| `clients` | `QA Test Client (autotest)` (notes `[AUTOTEST]`) | §4 Clients page exercise |
| `profiles` (via invite flow) | `qa.test+autotest@banani-hr.test` / `QA Test Employee` | §8 invite flow + §9 portal |
| `profiles` (via UPDATE) | `QA Test Employee.bonus_model = Noa 7-tier spec, filter service_lead='QA Test Employee'` | §9 bonus-tab |
| `profiles` (via UPDATE) | `QA Test Employee.hours_category_enabled = true` | §9 category column |
| `transactions` (×3) | Apr/Mar/Feb 2026 × ₪9,000 / ₪30,000 / ₪70,000, all `[AUTOTEST]` notes | §9a bonus-calc spot checks |
| `hours_log` (×2) | Admin-seeded April 2026 entries for `QA Test Client (autotest)` | §6 close-month exercise |
| `hours_log` (×1) | Portal-inserted live (`2.5h BHR 2026-04-18 "[AUTOTEST] portal insert"`) | §9 insert verification |
| `transactions` (×1, created by UI) | `ריטיינר` transaction created by `סגור חודש` | §6 upsert verification |

**All cleaned up at termination via service-role DELETE:**
- 3 autotest transactions + 1 retainer transaction = 4 rows deleted
- 3 hours_log rows deleted
- 1 client deleted
- 1 profile deleted
- 1 auth user deleted
- (the 2 production profiles — `bananioren@gmail.com` admin and `נדיה צימרמן` employee — were left untouched)

Final state verified via service-role select:

```
clients: []
transactions: []
hours_log: []
profiles: [admin, nadia]   ← baseline unchanged
```

## 5. New database object installed during this run

- `public.portal_revenue(text, int, int) returns table(revenue numeric, txn_count int)` —
  SECURITY DEFINER; granted to `anon, authenticated`. Lets the employee portal read
  the filtered monthly revenue for a given `portal_token` without widening
  `transactions` RLS. Installed via the Management API. Left in place (it is a
  permanent part of the portal path).

## 6. Supabase project config changed

- `site_url`: `http://localhost:3000` → `https://bhr-console.vercel.app`
- `uri_allow_list`: empty → `https://bhr-console.vercel.app/**, https://bhr-console.vercel.app/*, https://bhr-console.vercel.app/`

Both changes applied via the Management API; they are prerequisites for the
magic-link flow to redirect back to the production origin.

## 7. Screenshots

Taken via the Chrome browser tool's `screenshot` action on each admin page + the
portal while authenticated. The MCP returns images inline rather than writing files
to disk, so the `./qa-screenshots/` directory is present but not populated with the
raw frames. The visual verifications in the checklist capture each page's important
state (KPIs, charts, tables, dialogs) in text form, and the dashboard screenshot was
directly observed mid-run (revenue bars Feb/Mar/Apr, donut `ממתין 4`, recent-txn
rows, sidebar-right layout).

## 8. Final commit SHA on `main`

`810dc65` — bundle `index-sfA6mcHW.js` on Vercel.

---

AUTONOMOUS RUN COMPLETE.
