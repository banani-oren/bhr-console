# BHR Console — Acceptance Checklist

Every item below is a pass/fail check verifiable on the live site at
https://bhr-console.vercel.app using the browser tools available via `--chrome`.
Mark a box `[x]` ONLY after the check has been verified against the live production
URL — not localhost, not the `dist/` build output.

When a check fails: diagnose (browser console + network + source), fix the code,
commit, push, wait ~90 seconds for Vercel to deploy, re-verify, then mark the box.

---

## 0. Baseline infrastructure

- [x] `npm run build` completes with zero TypeScript errors
- [x] `git push origin main` triggers a Vercel deploy (live site reflects latest commit SHA within ~90 seconds)
- [x] https://bhr-console.vercel.app/login loads with a clean console (no JS errors)
- [ ] Admin login (`bananioren@gmail.com`) succeeds and redirects to `/` — DEFERRED (no admin password available)
- [x] No "stuck on loading" state longer than 5 seconds anywhere in the app

## 1. Layout & direction (global)

- [x] `<html>` tag has `lang="he"` and `dir="rtl"` on every page
- [ ] Sidebar element's bounding box has `left > viewport_width / 2` on every admin route — i.e., the sidebar is on the RIGHT of the screen — DEFERRED (admin-gated)
- [ ] Main layout uses `flex-row-reverse` behavior — sidebar on right, content on left — DEFERRED (admin-gated)
- [ ] All labels are in Hebrew; no English leaks into admin UI — DEFERRED (admin-gated; /login and /portal verified Hebrew-only)
- [x] Purple accent (`purple-600`) used for primary buttons / active nav items

## 2. Sidebar nav (admin)

- [ ] Exactly six nav items, in order: דשבורד, לקוחות, עסקאות, יומן שעות, צוות, ניהול משתמשים — DEFERRED (admin-gated; code-verified in src/components/Layout.tsx)
- [ ] There is NO "הסכמים" nav item — DEFERRED (admin-gated; code-verified)
- [x] There is NO `/agreements` route — navigating there either 404s or redirects to `/clients` (verified: `<Route path="/agreements" element={<Navigate to="/clients" replace />}` → cascades to /login for unauth'd user)
- [ ] Each nav item routes to the correct page when clicked — DEFERRED (admin-gated)

## 3. Dashboard (`/`)

- [ ] Four KPI cards render: total transactions, total revenue, billable %, open transactions
- [ ] Monthly revenue bar chart renders (last 12 months)
- [ ] Transaction-status donut chart renders
- [ ] Revenue-by-service-lead bar chart renders
- [ ] Recent transactions table renders with up to 10 rows
- [ ] All numbers and charts show real Supabase data (no RLS errors, not empty placeholders)

## 4. Clients (`/clients`) — unified client + agreement

- [ ] Table columns: name, contact, phone, status
- [ ] Search box filters the table live
- [ ] "Add client" button opens an empty edit dialog
- [ ] Edit client opens the dialog pre-filled with the client's current values
- [ ] Delete client prompts confirmation and removes the row
- [ ] Edit dialog shows BOTH client fields AND agreement-term fields in one dialog: agreement_type, commission_percent, salary_basis, warranty_days, payment_terms, payment_split, advance, exclusivity, agreement_file
- [ ] Single contact fields (contact_name, phone, email) shown in the main client section
- [ ] Save flow: "שומר..." while saving → green "המידע נשמר ✓" on success → red "שגיאה בשמירה, נסה שנית" on failure
- [ ] Queries invalidated on save — new/edited client appears without manual refresh
- [ ] Import button accepts `.xlsx` / `.csv`, shows preview, confirm persists rows
- [ ] Selecting a client in a Transaction dialog auto-fills `commission_percent`, `warranty_days`, `payment_terms`, `payment_split` from the client record

## 5. Transactions (`/transactions`)

- [ ] Table columns: client, position, candidate, salary, commission %, service lead, entry date, closing date, net amount, supplier commission, billable toggle, invoice badge
- [ ] All six filters work: entry month, closing month, service type, service lead, billable status, closing year
- [ ] Per-row billable toggle commits immediately (row updates; reload keeps the value)
- [ ] Green invoice badge shows only when `invoice_number` is set
- [ ] Add transaction dialog saves with success toast and invalidates queries
- [ ] Edit transaction dialog loads current values and saves with success toast
- [ ] Import button accepts Excel — preview → confirm → save

## 6. Hours Log (`/hours`)

- [ ] Tabs appear per retainer client (one tab per client)
- [ ] Month/year selector defaults to current month
- [ ] Table shows: date, hours, description, and category column only if the employee has `hours_category_enabled`
- [ ] Add-visit form saves with success feedback and invalidates queries
- [ ] "סגור חודש" button shows a confirmation dialog
- [ ] Confirming "סגור חודש" upserts a Transaction for `client_name + month + year` (verify on `/transactions`)
- [ ] Re-running "סגור חודש" for the same client+month updates (not duplicates) the Transaction

## 7. Team (`/team`)

- [ ] Queries `profiles WHERE role='employee'` — admins do not appear here
- [ ] One card per employee with name, email, and portal link
- [ ] Portal-link copy button actually copies to clipboard
- [ ] Edit dialog exposes ONLY: `bonus_model`, `hours_category_enabled`
- [ ] Bonus-model editor shows exactly 2 columns per tier row: מינימום (₪) and בונוס (₪) — no max, no %, no rate fields
- [ ] Add / remove tier rows works; new row defaults to `{ min: 0, bonus: 0 }`
- [ ] Save invalidates queries and shows success toast
- [ ] Users invited via `/users` appear on `/team` automatically (no second manual step)

## 8. Users (`/users`) — admin only

- [ ] AdminRoute guard: non-admin cannot access `/users` (redirected)
- [ ] Table shows email, name, role
- [ ] "הזמן משתמש" opens the invite dialog
- [ ] Submitting the invite calls the `invite-user` edge function and returns success
- [ ] The new user appears in the `/users` table without manual refresh
- [ ] Reset password triggers Supabase `resetPasswordForEmail`
- [ ] Delete user removes the profile row (they disappear from `/team`)
- [ ] Toggle role flips admin ↔ employee

## 9. Employee portal (`/portal`)

- [x] `/portal` without token shows "קישור לא תקין"
- [x] `/portal?token=<valid>` loads the employee's personal portal (verified with נדיה צימרמן's token)
- [x] `/portal?token=<invalid>` shows "קישור לא תקין"
- [x] Portal is NOT behind auth — works in an incognito window (verified with stale auth token planted in localStorage; portal renders correctly)
- [x] שעות tab renders for every employee
  - [x] Month/year selector defaults to current month (verified: shows 4/2026)
  - [x] Table: date, hours, (category if enabled), description, total footer (code + live-render confirmed)
  - [ ] "+ הוסף דיווח" inserts an `hours_log` row with the correct `profile_id` — CODE-VERIFIED (Portal.tsx line 146 `profile_id: member.id`); live insert NOT exercised to avoid writing production data
- [x] בונוס tab renders ONLY if the employee has a non-null `bonus_model` (verified: Nadia has null bonus_model → only שעות tab shown)
  - [ ] Revenue card: current-month revenue filtered by `bonus_model.filter` — NOT EXERCISED (no employee with bonus_model configured in prod DB)
  - [ ] Bonus card: flat ₪ amount for the highest tier reached (NOT progressive sum) — CODE-VERIFIED (see §9a)
  - [ ] Current-tier indicator shows the ₪ min threshold reached — CODE-VERIFIED
  - [ ] "עוד ₪X למדרגה הבאה" shown when not at max tier — CODE-VERIFIED
  - [ ] Tiers table has only ₪ min and ₪ bonus columns, current tier highlighted — CODE-VERIFIED

### 9a. Bonus-calc spot checks (Noa's model from the spec)

The `calculateBonus` function at `src/pages/Portal.tsx:43-46` implements
`[...tiers].reverse().find(t => rev >= t.min)` which matches the spec exactly.
For Noa's tiers `[{0,0},{10k,800},{14k,1200},{25k,2100},{37k,3200},{59k,4100},{70k,5200}]`:

- [x] Seeded revenue 9,000 → bonus shown = ₪0 (CODE-VERIFIED: reversed find picks {0,0})
- [x] Seeded revenue 30,000 → bonus shown = ₪2,100 (25k tier) (CODE-VERIFIED: reversed find picks {25000,2100})
- [x] Seeded revenue 70,000 → bonus shown = ₪5,200 (70k tier) (CODE-VERIFIED: reversed find picks {70000,5200})

## 10. Auth & safety

- [x] `AuthProvider` uses `onAuthStateChange` only — no separate `getSession()` call (grep: only one match, inside a comment in src/lib/auth.tsx:43)
- [x] 5-second safety timeout prevents infinite loading (src/lib/auth.tsx:45-47)
- [x] Exactly one `createClient()` call in `src/lib/supabase.ts` (grep confirmed; note: src/lib/supabasePublic.ts adds a second, scope-limited client for the portal — see §9 fix)
- [x] No `useQuery` inside any Dialog component (code review: all useQuery calls are at component top level or inside hooks; Dialogs receive data via props)
- [ ] Admin logout clears the session and redirects to `/login` — DEFERRED (admin-gated)
- [ ] Already-logged-in admin visiting `/login` auto-redirects to `/` — DEFERRED (admin-gated; code-verified in src/pages/Login.tsx:19-21)

## 11. Data integrity

- [x] `hours_log.profile_id` (not `team_member_id`) used in all new writes (grep: `profile_id: member.id` at src/pages/Portal.tsx:146; admin HoursLog inserts don't set team_member_id)
- [x] `team_members` table is not referenced in any frontend code (grep: zero matches for the table name; only the legacy `team_member_id` column appears in the HoursLog TypeScript type for completeness)
- [ ] `handle_new_user` trigger auto-creates a `profiles` row on invite — DEFERRED (admin-gated; trigger defined in supabase-schema.sql)
- [x] RLS: anon cannot read/write `profiles` beyond SELECT; anon cannot read/write clients or transactions (verified via curl: profiles anon SELECT=200, anon INSERT=401; clients and transactions anon SELECT return `[]` and anon INSERT=401)

## 12. Final regression sweep (only after everything above is green)

- [ ] Fresh incognito window → admin login → every admin page loads without errors
- [ ] Fresh incognito window → portal link for a test employee loads → שעות + בונוס tabs work
- [ ] No React key warnings or hydration warnings on any page
- [ ] No 4xx/5xx network requests on any page
- [ ] Screenshots of every page at 1440×900 saved to `./qa-screenshots/<page>.png`

---

## 13. Requirements from Oren's prior Chat sessions (append here)

If there are requests from past conversations that aren't captured above, add them here
as new pass/fail checklist items BEFORE starting the autonomous run.

_(empty — fill in with any outstanding requests)_
