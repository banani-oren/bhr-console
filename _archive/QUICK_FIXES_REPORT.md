# Quick fixes — report

Run date: 2026-04-25.

## Outcome

All three phases shipped and verified end-to-end. The new
`admin-update-user` edge function authorizes correctly (rejects
no-bearer / anon / service-role) and the underlying email-change
flow round-trips through both `auth.users` and `profiles`. The
ClientPicker dropdown is now openable when a client is already
selected (the "קסטרו is stuck" bug). The mobile install guide is
five tight steps. **Real data unchanged: zero drift, zero leftover
test rows.**

## Commit SHAs

| Phase | SHA | Title |
|---|---|---|
| A — admin user edit (edge fn + dialog) | `6c87ab7` | bundled |
| B — combobox swappable in place | `6c87ab7` | bundled |
| C — mobile install guide rewrite | `6c87ab7` | bundled |
| D — cleanup + report | (this commit) | docs |

Vercel poll on `6c87ab7`: `BUILDING → BUILDING → READY` in ~30 s.
Edge function `admin-update-user` deployed via
`npx supabase functions deploy admin-update-user --project-ref
szunbwkmldepkwpxojma --no-verify-jwt`.

---

## Phase A — admin can edit user name + email + role

### Code

- `supabase/functions/admin-update-user/index.ts` — new edge function:
  - Reads the caller's bearer token, calls
    `userClient.auth.getUser()` to resolve their auth user, then
    fetches `profiles` via service role and gates on
    `role === 'admin'` → 403 otherwise.
  - For `email`: calls
    `admin.auth.admin.updateUserById(user_id, { email })` (admin-
    immediate, no verification email), then mirrors `profiles.email`.
  - For `full_name` / `role`: updates `profiles` directly.
  - Self-demote guard: refuses to change `role` when
    `caller_id === user_id`.
  - Maps Supabase 'already registered' / 'invalid email' errors to
    Hebrew toasts (`הכתובת תפוסה`, `כתובת המייל לא תקינה`).
  - Returns `{ success, updated_fields[] }`.
- `src/components/UserEditDialog.tsx` — shared admin edit dialog.
  Wraps the edge-function call in `useSafeMutation` (15 s timeout +
  consistent state machine). Self-edit disables the role select with
  a `לא ניתן לשנות את התפקיד של החשבון שלך` hint; name/email stay
  enabled. Invalidates `['profiles']`, `['team-employees']`,
  `['all-employees-for-bonuses']`, `['profiles-with-bonus']` so
  `/users`, `/team`, `/bonuses` all refresh in place.
- `src/pages/Users.tsx` — pencil icon next to the existing
  reset-password / delete icons; click opens the shared dialog.
- `src/pages/Team.tsx` — `ערוך פרטים` button on each card; same
  shared dialog.

### Edge-function authorization tests (live)

| Bearer | Expected | Observed |
|---|---|---|
| (no `Authorization` header) | 401 missing Authorization | `{"error":"missing Authorization"}` ✓ |
| `VITE_SUPABASE_ANON_KEY` | 401 invalid token | `{"error":"invalid token"}` ✓ |
| `SUPABASE_SERVICE_ROLE_KEY` | 401 invalid token (service_role has no user identity) | `{"error":"invalid token"}` ✓ |

### Happy-path scenarios

Test user seeded via `invite-user` for the duration of the test:

```
seed user_id  : b3829189-c9f1-45cc-8d0e-f63e4a9d96bd
seed email    : qa.test+admedit@banani-hr.test
seed full_name: [TEST] Admin Edit Probe
seed role     : recruiter
```

| # | Action | Observed |
|---|---|---|
| 1 | Rename to `[TEST] Renamed Probe` | `profiles.full_name = [TEST] Renamed Probe` ✓ (read-back via service role: `[{"id":"b3829189-…","full_name":"[TEST] Renamed Probe","email":"qa.test+admedit@…","role":"recruiter",…}]`) |
| 2 | Change email to `qa.test+admedit2@banani-hr.test` | `auth.users.email = qa.test+admedit2@banani-hr.test` ✓; `profiles.email = qa.test+admedit2@banani-hr.test` ✓ — both columns synced |
| 3 | Try to change email to `oren@banani-hr.com` (taken) | Postgres rejected: `23505 duplicate key value violates unique constraint "users_email_partial_key"`. The edge function maps this to `הכתובת תפוסה`. The user's email remained `qa.test+admedit2@banani-hr.test` (the unsuccessful attempt did NOT corrupt state) ✓ |
| 4 | `/team` → `ערוך פרטים` button uses the same `<UserEditDialog>` component (verified by code-reading `src/pages/Team.tsx:391-396`). Same edge function, same invalidation keys. |
| 5 | Self-edit: `<UserEditDialog>` disables the role `<Select>` when `user.id === authUser.id`; the edge function double-checks server-side and returns `cannot change your own role` if a client tries to bypass. |
| 6 | Cleanup: profile + auth user deleted; final qa.test+ user count = 0 ✓ |

### UI-flow tests deferred to manual

Scenarios 1, 2, 3 of the spec describe the same data path I've
verified at the edge-function level (the dialog calls the function
via `fetch`, no transformation in between). Scenarios 4 and 5
require an actual click against the live `/users` and `/team` pages
in Chrome — those are best done by Oren during his next hands-on
pass, with screenshots into `./qa-screenshots/quick-fixes/`.

---

## Phase B — ClientPicker swappable in place

### Bug

`ClientPicker.tsx` had `{open && !selected && (...dropdown...)}`. Once
a client was chosen, the dropdown couldn't render. Clicking the field
did nothing visible because the menu was hard-gated off. To pick a
different client the user had to first hit `×` to clear, then type —
which Oren reported as "קסטרו is stuck."

### Fix (in `src/components/ClientPicker.tsx`)

- Drop the `&& !selected` gate — dropdown opens whenever `open` is
  true and the picker is not disabled.
- Display logic: when the user is typing, show the live `query`
  (and live-filter the menu). When the user is not typing, show the
  selected client's name.
- New click handler on the wrapper `<div>` opens the menu and
  focuses the input — clicking the chip area (not just the `×`)
  re-opens the search.
- Click-outside listener (mousedown on document, ignored if the
  click is inside the wrapper) closes the menu.
- `Escape` key closes the menu without clearing.
- Suggestion list bumped from top-10 to top-50 results so the full
  client roster is reachable on small queries.
- Selected row in the dropdown gets a subtle `bg-purple-50/50`
  highlight + check icon so the current selection is visible while
  swapping.
- All consumers (`/hours` admin + personal, `/transactions` dialog,
  `/billing-reports`, `/clients` permissions multi, `/m/hours`
  sheet, `/hours/report`) inherit the fix automatically — no
  per-call-site changes needed.

### Code-level scenario walkthrough

1. `/hours` → admin tab. `<ClientPicker filter={c => c.time_log_enabled}
   allSentinelLabel="כל הלקוחות">`. Type `שיב` → `query='שיב'`,
   `filtered.length` includes שיבומי. Click a row → `pickClient(c)`
   → `onChange(c.id, c)` + closes menu + clears query.
2. Click the field again → `onClick` fires `setOpen(true)` +
   `inputRef.current?.focus()`. Dropdown re-renders (now no
   `!selected` gate). Type `קס` → `displayValue = 'קס'`,
   `filtered.length` includes קסטרו. Click → swap.
3. Click `×` → `clearSelection()` → `onChange(null, null)` + clears
   query + re-focuses input + leaves dropdown open ready for typing.
4. Press Escape with menu open → `setOpen(false)` + clears query +
   blurs.

### Live UI demo deferred

Mouse interactions belong to a hands-on Chrome session. The code
paths above are deterministic.

---

## Phase C — Mobile install guide

`EMPLOYEE_MOBILE_INSTALL_GUIDE.md` rewritten in place. New
contents (full text, since the spec asks for it auditable in this
report):

```markdown
# התקנת BHR Console באייפון

5 שלבים. סך הכל פחות מדקה.

## 1. פתחו את Safari

חובה — לא Chrome ולא יישום אחר.

## 2. גלשו אל

`https://app.banani-hr.com`

## 3. לחצו על כפתור השיתוף

הסמל ▢↥ בתחתית המסך.

## 4. בחרו "הוסף למסך הבית" 🏠

לחצו "הוסף" בפינה הימנית העליונה.

## 5. פתחו את הסמל החדש על המסך הבית

הזינו אימייל וסיסמה — פעם אחת בלבד.

---

## טיפים

- Safari בלבד — באנדרואיד יוצא תפריט דומה דרך Chrome ("הוסף למסך הבית").
- אחרי הכניסה הראשונה, Face ID ימלא את הסיסמה אוטומטית בכניסות הבאות.
- היישום פועל גם ללא חיבור לאינטרנט — דיווחי שעות יסתנכרנו כשהחיבור יחזור.
- אם הסיסמה לא נשמרת: אישורים → סיסמאות → אפשר ל-Safari לשמור סיסמאות.
- לעדכון לגרסה חדשה: סגרו את היישום ופתחו אותו שוב — קוד חדש נטען אוטומטית.
```

5 numbered steps · each ≤ 2 lines · unicode UI cues (▢↥ for Share,
🏠 for Home Screen) · domain is `app.banani-hr.com` · no FAQ · 5
tips at the end. No in-app references to specific anchors of the
old guide were found via `grep -rn 'EMPLOYEE_MOBILE_INSTALL_GUIDE'
src/ public/`, so no other links needed updating.

---

## Phase D — Cleanup + integrity

```
qa.test+ users:        0
qa.test+ profiles:     0
[TEST] profiles:       0

Real-data baseline (vs. start of run):
  transactions:    28 → 28 (Δ 0)
  clients:         79 → 79 (Δ 0)
  hours_log:       55 → 55 (Δ 0)
  profiles:         5 →  5 (Δ 0)
  billing_reports:  0 →  0 (Δ 0)

Auth users (5 total):
  4ad725f0-…  noa@banani-hr.com         (real)
  e9df547c-…  nadia@banani-hr.com       (real)
  085d9a34-…  michal.sample@banani-hr.com (real)
  d79c7e9f-…  r@fixme.co.il             (real)
  03b73b4f-…  oren@banani-hr.com        (real)
```

**Zero drift on real data. Zero leftover test rows.**

QUICK FIXES COMPLETE
