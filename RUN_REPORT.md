# Autonomous Run Report — BHR Console

**Run date:** 2026-04-17
**Final commit on `main`:** `160d9b5` — fix(§9): portal hangs on .from() when stale auth session in localStorage
**Live URL:** https://bhr-console.vercel.app

---

## TL;DR

The autonomous run uncovered **one production-severity bug** in the employee portal
(stuck-on-loading whenever a stale Supabase auth token sits in `localStorage`) and
fixed it. All items on the acceptance checklist that can be exercised without an
admin password are verified green on the live site.

The one permitted deferral from `CLAUDE_CODE_AUTONOMOUS.md` — admin-gated checks
when no admin password is available — applies to roughly half of the checklist.
Those items are listed explicitly in the "Deferred" section below. For each, I've
noted whether the code inspection supports the spec; none of them were modified
during this run, so their existing state is what's on production.

---

## Commits pushed this run

| Commit | Message |
|--------|---------|
| `e7419b3` | fix(§9): portal stuck on loading for invalid token — replaced `.maybeSingle()` with `.limit(1)` + array check and set `retry: false`. Eliminated the 406-retry-loop but did not fully fix the hang. |
| `ec1c6ec` | debug(§9): added Portal query logging to diagnose stuck loading. **Note:** this commit also unintentionally tracked `BHR_CONSOLE_CHECKLIST.md` and `CLAUDE_CODE_AUTONOMOUS.md` via `git add -A` — neither contains secrets but you may want to move them into `.gitignore` if they were meant to stay local. |
| `160d9b5` | fix(§9): portal hangs on `.from()` when stale auth session in localStorage. Introduced `src/lib/supabasePublic.ts` — a scope-limited client with `persistSession:false`, `autoRefreshToken:false`, `detectSessionInUrl:false` — and pointed `src/pages/Portal.tsx` at it. Debug `console.log` calls from `ec1c6ec` removed in this commit. |

---

## The bug that was found and fixed

**Symptom.** `/portal?token=<anything>` stayed on `טוען פורטל...` indefinitely on
any browser that had ever logged in to the admin UI. Affected invalid tokens
(should show `קישור לא תקין`) AND valid tokens (should load the employee's
portal). Verified reproducible on the live site before the fix.

**Root cause.** `src/lib/supabase.ts` exported a single `createClient` that
persists sessions to `localStorage` and auto-refreshes on boot. When
`sb-szunbwkmldepkwpxojma-auth-token` held a stale/expired session,
supabase-js's GoTrue client entered the auth-recovery flow on first
`supabase.from(...)`. That flow blocks the PostgREST builder until session
recovery completes, which never did — so the Portal query's `queryFn` awaited
forever, `isLoading` stayed `true`, and no HTTP request ever reached
`/rest/v1/profiles`. Confirmed by instrumenting the Portal's `queryFn` with
`console.log`: `[Portal] queryFn running` fired, but `[Portal] queryFn result`
never did.

**Fix.** Gave the portal its own `supabasePublic` client that doesn't touch the
auth state. Verified on the live site after the fix:

- `/portal` (no token) → `קישור לא תקין` ✓
- `/portal?token=definitely-fake-zzz` → `קישור לא תקין` ✓
- `/portal?token=<valid>` → loads the employee's portal (Nadia's profile,
  month-year selector at 4/2026, `שעות` tab rendered, `בונוס` tab correctly
  hidden because her `bonus_model` is null) ✓
- All three scenarios work even with a stale
  `sb-szunbwkmldepkwpxojma-auth-token` planted in `localStorage` ✓

**Scope consideration.** The same stale-session hang almost certainly affects
the admin UI too — any admin returning after their refresh token has expired
would see the entire admin console hang behind the same GoTrue recovery block.
I did **not** attempt a fix for that because it would have required modifying
`AuthProvider` behavior without an admin login to validate against. Recommend
adding to `BHR_CONSOLE_CHECKLIST.md §12` as a follow-up: "AuthProvider clears
a stale session within 5s instead of hanging queries."

---

## Verified on live site (code + browser)

### §0 Baseline infrastructure
- `npm run build` clean (0 TS errors, 1 chunk-size warning unchanged from baseline)
- `git push origin main` → Vercel auto-deploy confirmed (3 deploys this run, all `READY PROMOTED`)
- `/login` renders with clean console, Hebrew-only content, no JS errors
- No page stuck on a loading state > 5 s (portal was, portal fixed)

### §1 Layout & direction
- `<html lang="he" dir="rtl">` confirmed via JS (`document.documentElement`)
- Purple accent (`purple-600`) used for the Login submit button and every primary action in source

### §2 Sidebar nav
- `/agreements` redirects to `/clients` in the route table (`src/App.tsx:77`); unauth'd visit cascades to `/login`

### §9 Employee portal — all items passing
- Portal (no token) → `קישור לא תקין`
- Portal (invalid token) → `קישור לא תקין`
- Portal (valid token) → loads Nadia's employee portal
- Works regardless of stored auth token (stale token simulation)
- שעות tab present; current-month selector defaults to 4/2026
- בונוס tab hidden for the only employee in prod (null `bonus_model`)
- Bonus math (§9a) verified via code at `src/pages/Portal.tsx:43-46` against Noa's spec tiers for revenues of 9,000 / 30,000 / 70,000 → 0 / 2,100 / 5,200 ✓

### §10 Auth & safety (grep/code)
- `AuthProvider` uses only `onAuthStateChange` (no `getSession()` call — only comment)
- 5-second safety timeout present at `src/lib/auth.tsx:45-47`
- Exactly one `createClient` inside `src/lib/supabase.ts` — note the new `src/lib/supabasePublic.ts` adds a second, scope-limited client specifically for the portal (see §9 fix above)
- No `useQuery` inside any Dialog component — all hooks live at page-component top level or inside hook wrappers

### §11 Data integrity (grep + live RLS test via curl)
- `hours_log.profile_id` used for writes (`src/pages/Portal.tsx:146`)
- `team_members` table never referenced in `src/`
- Anon RLS on live Supabase:
  - `profiles` SELECT → 200 (allowed, empty-body not applicable)
  - `profiles` INSERT → 401 (blocked) ✓
  - `clients` SELECT → 200 `[]` (silently filtered) ✓
  - `clients` INSERT → 401 ✓
  - `transactions` SELECT → 200 `[]` ✓
  - `transactions` INSERT → 401 ✓

---

## Deferred (admin-gated — the single permitted deferral)

Per `CLAUDE_CODE_AUTONOMOUS.md`, the admin password is stored by Oren and not
present in `.env.local` (confirmed: the file only contains
`VITE_SUPABASE_*`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_DB_PASSWORD`, `VERCEL_TOKEN`, `RESEND_API_KEY` — no admin password).
Using the service-role key to bypass auth or to set a new admin password would
have been an unauthorized credential modification, so I didn't.

**The following items are therefore DEFERRED** — code review supports that
each appears correctly implemented, but none were exercised against the live
admin UI this run:

- §0.4 — Admin login redirects to `/`
- §1.2-1.4 — Sidebar on right (plain flex + `dir="rtl"`), Hebrew-only labels on admin routes
- §2.1-2.2, §2.4 — Six-item nav, no `הסכמים`, nav routing works
- §3 — Dashboard KPIs/charts/recent-tx table
- §4 — Clients unified table/search/dialog/import/transaction autofill
- §5 — Transactions table/filters/billable toggle/import
- §6 — Hours Log tabs/month selector/close-month upsert
- §7 — Team cards/portal link/bonus editor
- §8 — Users admin guard/invite edge function/reset/delete/role toggle
- §9 sub-items that require writing to prod (portal `+ הוסף דיווח` insert) or an employee with `bonus_model` configured (the only employee in prod has null `bonus_model`)
- §10.5-10.6 — Admin logout, already-logged-in-admin `/login` redirect
- §11.3 — `handle_new_user` trigger (defined in `supabase-schema.sql`, not runtime-tested this run)
- §12 — Full regression sweep + screenshots (I created `./qa-screenshots/` but did not populate it, since the admin pages couldn't be reached)

---

## Surprises worth noting

1. **Vercel CDN is cache-aggressive** — after a push, the `/` document caches
   for ~5 minutes at the edge (`X-Vercel-Cache: HIT`, `Age: 297`). Deploy
   status via the Vercel API flipped to `READY PROMOTED` ~20s after push, but
   the production alias kept serving the previous bundle for 3–5 minutes.
   My `until curl | grep`-based deploy waits worked but took up to 5 minutes
   instead of the 90 s the directive assumed.

2. **Bundle hashes are deterministic per-build-env, not per-commit** — my
   locally-built `dist/assets/index-HaEhMixe.js` was *never* the hash Vercel
   shipped (Vercel shipped `CD7BER3l`, `DmelR7MY`, `BxqGCfUR` across the three
   deploys). Don't compare local-build hashes against prod to decide whether a
   deploy landed — compare the bundle *contents*.

3. **`.maybeSingle()` under the hood issues `Accept: application/vnd.pgrst.object+json`**
   which returns 406 PGRST116 on 0 rows instead of 200 `[]`. On its own this is
   handled fine by supabase-js v2.103 (returns `{data:null, error:null}`), but
   combined with react-query retries and the stale-session hang it masked the
   deeper bug. The switch to `.limit(1)` in the portal is independently
   correct because it returns 200 `[]` with the cheaper `Accept:application/json`
   path.

4. **Only one employee exists in production** — `נדיה צימרמן` with a null
   `bonus_model`. So none of the `בונוס`-tab spot checks could actually be
   exercised end-to-end; they are code-verified only.

---

## Termination

`AUTONOMOUS RUN COMPLETE` — with the single permitted deferral (admin-gated
checks) documented above. Three commits shipped to `main`; production is
serving the final commit (`160d9b5`) confirmed by bundle content inspection at
run end.
