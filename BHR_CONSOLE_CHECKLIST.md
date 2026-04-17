# BHR Console — Acceptance Checklist

Every item below is a pass/fail check verifiable on the live site at
https://bhr-console.vercel.app using the browser tools available via `--chrome`.
Mark a box `[x]` ONLY after the check has been verified against the live production
URL — not localhost, not the `dist/` build output.

When a check fails: diagnose (browser console + network + source), fix the code,
commit, push, wait ~90 seconds for Vercel to deploy, re-verify, then mark the box.

---

## 0. Baseline infrastructure

- [ ] `npm run build` completes with zero TypeScript errors
- [ ] `git push origin main` triggers a Vercel deploy (live site reflects latest commit SHA within ~90 seconds)
- [ ] https://bhr-console.vercel.app/login loads with a clean console (no JS errors)
- [ ] Admin login (`bananioren@gmail.com`) succeeds and redirects to `/`
- [ ] No "stuck on loading" state longer than 5 seconds anywhere in the app

## 1. Layout & direction (global)

- [ ] `<html>` tag has `lang="he"` and `dir="rtl"` on every page
- [ ] Sidebar element's bounding box has `left > viewport_width / 2` on every admin route — i.e., the sidebar is on the RIGHT of the screen
- [ ] Main layout uses `flex-row-reverse` behavior — sidebar on right, content on left
- [ ] All labels are in Hebrew; no English leaks into admin UI
- [ ] Purple accent (`purple-600`) used for primary buttons / active nav items

## 2. Sidebar nav (admin)

- [ ] Exactly six nav items, in order: דשבורד, לקוחות, עסקאות, יומן שעות, צוות, ניהול משתמשים
- [ ] There is NO "הסכמים" nav item
- [ ] There is NO `/agreements` route — navigating there either 404s or redirects to `/clients`
- [ ] Each nav item routes to the correct page when clicked

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

- [ ] `/portal` without token shows "קישור לא תקין"
- [ ] `/portal?token=<valid>` loads the employee's personal portal
- [ ] `/portal?token=<invalid>` shows "קישור לא תקין"
- [ ] Portal is NOT behind auth — works in an incognito window
- [ ] שעות tab renders for every employee
  - [ ] Month/year selector defaults to current month
  - [ ] Table: date, hours, (category if enabled), description, total footer
  - [ ] "+ הוסף דיווח" inserts an `hours_log` row with the correct `profile_id`
- [ ] בונוס tab renders ONLY if the employee has a non-null `bonus_model`
  - [ ] Revenue card: current-month revenue filtered by `bonus_model.filter`
  - [ ] Bonus card: flat ₪ amount for the highest tier reached (NOT progressive sum)
  - [ ] Current-tier indicator shows the ₪ min threshold reached
  - [ ] "עוד ₪X למדרגה הבאה" shown when not at max tier
  - [ ] Tiers table has only ₪ min and ₪ bonus columns, current tier highlighted

### 9a. Bonus-calc spot checks (Noa's model from the spec)

- [ ] Seeded revenue 9,000 → bonus shown = ₪0
- [ ] Seeded revenue 30,000 → bonus shown = ₪2,100 (25k tier)
- [ ] Seeded revenue 70,000 → bonus shown = ₪5,200 (70k tier)

## 10. Auth & safety

- [ ] `AuthProvider` uses `onAuthStateChange` only — no separate `getSession()` call (grep)
- [ ] 5-second safety timeout prevents infinite loading
- [ ] Exactly one `createClient()` call in `src/lib/supabase.ts` (grep)
- [ ] No `useQuery` inside any Dialog component (grep)
- [ ] Admin logout clears the session and redirects to `/login`
- [ ] Already-logged-in admin visiting `/login` auto-redirects to `/`

## 11. Data integrity

- [ ] `hours_log.profile_id` (not `team_member_id`) used in all new writes
- [ ] `team_members` table is not referenced in any frontend code (grep)
- [ ] `handle_new_user` trigger auto-creates a `profiles` row on invite
- [ ] RLS: anon cannot read/write `profiles` beyond SELECT; anon cannot read/write clients or transactions

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
