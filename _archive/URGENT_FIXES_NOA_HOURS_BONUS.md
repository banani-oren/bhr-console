# Urgent fixes — Noa invite, hours UX (real this time), bonus admin view with filters

Three high-priority fixes that previous batches claimed to land but did
not. Each phase requires **scenario-based evidence**, not "I clicked
and it looked fine." Phase reports must include actual values observed
(counts, names, IDs, screenshot references). Do not stop, do not ask,
do not summarize mid-run. Produce `URGENT_FIXES_REPORT.md`.

## Read first

1. `BHR_CONSOLE_PROJECT.md`
2. `BHR_CONSOLE_CHECKLIST.md`
3. `IMPROVEMENTS_BATCH_2.md` Phase A — the original (failed) Noa fix.
4. `REFINEMENTS_BATCH_5.md` — claimed to fix hours and add bonus dashboard.
5. `CLAUDE_CODE_AUTONOMOUS.md` — build-status verification rule.
6. This file.

## CRITICAL: real data integrity

- **Read-only on real rows.** No updates, no deletes, no toggles
  unless tagged `[TEST-…]`.
- For all CRUD scenarios: insert tagged → exercise → delete in same
  session.
- End-of-run verification: zero rows tagged `[TEST-…]` remaining.

## Hard rules

- English only for commits.
- Build-state polling per `CLAUDE_CODE_AUTONOMOUS.md` — no "wait 90s".
- Never print or commit secrets.
- **Evidence rule:** every `[x]` mark in the checklist must be
  accompanied by a quote from the live page, a screenshot path, or a
  DB query result with actual values. "Looks correct" is not evidence.

---

## Phase A — Diagnose and permanently fix the Noa invite bug

**Symptom:** Oren has invited `noa@banani-hr.com` many times. She still
doesn't appear in `/users`. The previous Phase A in batch 2 was a
one-shot reconciliation, not a root-cause fix. Repeat invites are still
broken.

### A1. Forensic audit (write findings to `NOA_AUDIT.md`)

```bash
SUPA_URL="$(grep '^VITE_SUPABASE_URL=' .env.local | cut -d= -f2-)"
SUPA_KEY="$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)"
SUPA_TOKEN="$(grep '^SUPABASE_ACCESS_TOKEN=' .env.local | cut -d= -f2-)"

# 1. Every auth.users row with this email (could be multiple after retries):
curl -sS "${SUPA_URL}/auth/v1/admin/users?per_page=200" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" \
  | jq '.users[] | select(.email == "noa@banani-hr.com") | {id, email, created_at, email_confirmed_at, invited_at, last_sign_in_at, raw_user_meta_data}'

# 2. Every profiles row that could be Noa (by email OR by full_name):
curl -sS "${SUPA_URL}/rest/v1/profiles?or=(email.eq.noa@banani-hr.com,full_name.ilike.%25נועה%25,full_name.ilike.%25Noa%25)&select=*" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY"

# 3. The handle_new_user trigger — is it installed and is it correct?
curl -sS -X POST "https://api.supabase.com/v1/projects/szunbwkmldepkwpxojma/database/query" \
  -H "Authorization: Bearer $SUPA_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "select trigger_name, event_manipulation, action_statement from information_schema.triggers where trigger_name = '\''on_auth_user_created'\''"}'

# 4. Any recent edge-function logs for invite-user:
npx supabase functions logs invite-user --project-ref szunbwkmldepkwpxojma | tail -100
```

Capture all four results in `NOA_AUDIT.md`. Identify which of these
applies (more than one is possible):

- **A.1 — orphan auth user, no profile.** Auth row exists, profile row
  doesn't. Trigger silently failed (likely `ON CONFLICT DO NOTHING`
  on a `profiles.id` collision from a previous orphan).
- **A.2 — profile exists with wrong role.** A `profiles` row exists
  but its `role` is not in `('admin','administration','recruiter')`,
  so the `/users` query (per the new role model) filters her out.
- **A.3 — profile exists but `/users` query has a hidden filter.**
  e.g., a stale `WHERE password_set = true` or a residual `WHERE
  role = 'employee'` from before the role refactor.
- **A.4 — trigger never fires.** `handle_new_user` not installed in
  prod, or installed but disabled.
- **A.5 — duplicate auth users.** Multiple auth.users rows for the
  same email (Supabase usually prevents this; investigate if observed).
- **A.6 — RLS blocks the SELECT.** `/users` query uses the anon or
  authenticated role and an RLS policy hides Noa's row from the admin.

### A2. Code investigation

For whichever cause(s) the audit confirms:

- Inspect `src/pages/Users.tsx` to find the EXACT query used to
  populate `/users`. Run that exact query against the live DB via
  service role and confirm what it returns vs what it should.
- Inspect `supabase/functions/invite-user/index.ts` end-to-end. If the
  trigger isn't wired correctly, the edge function should explicitly
  upsert the profile row instead of relying on the trigger:
  ```ts
  await admin.from('profiles').upsert({
    id: userId,
    full_name,
    email,
    role: role ?? 'recruiter',
    password_set: false,
  }, { onConflict: 'id' })
  ```
  This makes the flow self-healing — even if the trigger fails, the
  profile row is guaranteed to land.

### A3. Permanent fix

Apply whichever code/SQL changes the audit indicates. The bar is
"the next invite of any email creates a working user with no
intervention," not "this specific Noa is fixed."

If `handle_new_user` is broken or unreliable, REPLACE its role with
explicit upserts in `invite-user` — defense-in-depth. The trigger can
stay as a fallback for users created outside the edge function (e.g.,
direct signup), but the edge function no longer depends on it.

### A4. Live verification — ALL of these scenarios must pass

Each scenario uses a fresh test email and ends with cleanup.

1. **Fresh invite of a never-before-seen email** —
   `qa.test+noasim1@banani-hr.test` invited via `/users` →
   appears in `/users` within 5 seconds → appears in `/team`
   automatically → portal/login link works.
2. **Re-invite of an existing-but-deleted email** — invite
   `qa.test+noasim2@banani-hr.test`, delete via `/users`, re-invite
   the same email → appears cleanly with a new auth ID, no orphan
   from the previous attempt.
3. **Multi-invite spam test** — invite
   `qa.test+noasim3@banani-hr.test` 5 times in a row → no
   duplicates in `auth.users` or `profiles`; the existing record is
   reused (Supabase admin API behavior); UI shows the user once;
   email_sent reflects the latest attempt.
4. **Special-character email test** — invite
   `qa.test+noasim4+space@banani-hr.test` (a `+` already in the local
   part) → handles correctly.
5. **The actual Noa fix.** `noa@banani-hr.com` — perform the audit
   from A1, run the fix from A3, then invite her one more time → she
   appears in `/users` AND `/team` with role `recruiter` (or whichever
   Oren wants). Do NOT delete her; she's a real user. Document her
   final auth ID and profile ID in the report.

Cleanup: delete all `qa.test+noasim*` users + their profiles at end.

Commit: `fix(invite): root-cause invite flow + always-upsert profile (Phase A)`.

---

## Phase B — Hours module: rebuild from the user's perspective

**Symptom:** Oren says hours is "still bad" and "wasn't properly QA'd" —
"can't operate it." Previous batch 5 phase D claimed to ship `<ClientCombobox>`
everywhere and filter to time-logged clients. Reality says otherwise.

### B1. Inventory: what's actually live

Visit `/hours` as Oren in Chrome. Capture in `HOURS_AUDIT.md`:

- Screenshot at 1440×900 desktop and 390×844 mobile.
- For each interactive element on the page, what it is (Combobox?
  native Select? plain input?) and what data it lists.
- The DOM HTML of the client-picker element (`outerHTML`).
- Open the "+ הוסף דיווח" dialog. Capture its DOM and screenshot.
- The "+ הוסף דיווח" dialog opens with a client picker — confirm it
  is `<ClientCombobox>` (search input visible, type-ahead filters)
  and not a `<select>`.
- The "ניהול שעות" tab — does it use a horizontal tab bar of clients,
  a Combobox, or something else? Document.
- The "הפק דוח שעות" client picker — list its options. Are
  non-`time_log_enabled` clients in the list?

### B2. Required behavior — verify each, fix any that fail

For each, document the exact passing scenario in the report:

1. `/hours` top filter is a `<ClientCombobox>` with the
   `time_log_enabled = true` predicate. Typing 3 characters of any
   such client filters within 200ms. A client that does NOT have
   time-log enabled does NOT appear in the search results — verify
   by attempting to type a known non-time-logged client's name.
2. "+ הוסף דיווח" dialog opens WITHOUT a pre-selected client. The
   first field is the searchable client picker, same predicate.
3. "ניהול שעות" tab uses the same searchable picker, NOT a tab bar.
   Verify by counting tabs: should be zero (`document.querySelectorAll('[role=tab]').length === 0`
   on this view).
4. "הפק דוח שעות" client picker is filtered to `time_log_enabled`.
   Confirm a known non-time-logged client is NOT in its list.
5. Date inputs: full `dd/mm/yy` visible, no clipping at 1440×900.
6. Time inputs (`משעה`, `עד שעה`): on mobile, fields are wide
   enough to show `HH:MM`. Verify at 390×844.
7. Save flow uses `useSafeMutation` — 15s timeout if no response.
   Verify by simulating a stalled request (DevTools Network tab,
   "Offline"); the dialog times out and surfaces a red toast within
   ~15s rather than hanging.
8. Total at the bottom (`סה"כ שעות — אפריל 2026: X`) updates when
   entries are added/edited/deleted. Verify by adding a `[TEST-…]`
   entry and watching the total update.
9. Mobile `/m/hours` uses the same picker. Verify at 390×844.

### B3. Fix anything that fails

For each failing item, modify the relevant component and reverify.
Each fix is a separate commit with the section number. Do not bundle
fixes — small commits make rollback easier.

### B4. Concrete user scenario test

Run this exact scenario end-to-end and document each step:

> As Oren, navigate to `/hours`. Type "קסטרו" in the client picker.
> See `קסטרו אבטחת תנועה...` highlighted. Select it. The table below
> shows my logged hours for that client this month. Click "+ הוסף
> דיווח". Dialog opens; client picker is empty. Type "שיבומי", select
> the result. Set date to today. Set start `09:00`, end `10:30`,
> description `[TEST-…] תיאור בדיקה`. Click שמור. Toast appears
> within 3 seconds. Dialog closes. Table refreshes; new entry
> appears. Total at the bottom incremented by 1.5. Click the trash
> icon on the new entry to delete. Confirm dialog. Total decrements.

Record each step's actual observation. If any step deviates from the
script, that's a bug to fix.

Commit: `fix(hours): client combobox + scenario verified end-to-end (Phase B)`.

---

## Phase C — Bonus admin view: every employee, filterable

**Symptom:** Oren wants to see bonuses for ALL employees, filter and
search by employee name, filter by period.

### C1. Audit current `/bonuses` (built in batch 5 Phase B)

Visit `/bonuses`. Document in `BONUS_AUDIT.md`:

- Number of cards rendered.
- Which employees are included (only those with `bonus_model IS NOT
  NULL`? everyone?).
- Is there a search? A period filter? Sort?
- Take a screenshot.

### C2. Required improvements

The page must have:

1. **A filter bar at the top:**
   - Searchable text input: matches employee `full_name` (case-insensitive).
   - Period selector: month + year, default current month, can go
     back 24 months.
   - Sort: by name, by current revenue desc, by current bonus desc.
2. **All employees listed**, not just those with `bonus_model`.
   Employees without a model show a card with `מודל בונוס לא הוגדר`
   and a button `הגדר מודל` that deep-links to their `/team` row.
3. **Per-card data**, computed against the SELECTED period (not just
   current month):
   - Period revenue (per `bonus_model.filter`).
   - Achieved tier and bonus amount.
   - Distance to next tier, or `מדרגה מקסימלית` if at top.
4. **Aggregate footer:**
   - Total bonuses across all employees for the period.
   - Number of employees who reached at least one tier.
5. **Mini-widget on `/`** (already built) updated to use the same
   computation logic, scoped to the current month.

### C3. Implementation

- Move the bonus calculation into `src/lib/bonus.ts` (already
  proposed in batch 5). All consumers — `/bonuses`, `/`, the portal,
  the recruiter dashboard — call the same function. One source of
  truth. Verify there's no duplicate implementation.
- The period selector drives a server-side filter on transactions.
  Computation happens on the client over the filtered set.

### C4. Live verification scenarios

1. Open `/bonuses` for the current month. Total card count = total
   number of employees in `profiles` where `role` is in
   `('admin','administration','recruiter')`.
2. Type "נועה" in the search → only matching cards visible. Empty
   the search → all back.
3. Change period to last month → revenue/bonus values update.
4. Sort by bonus desc → top earner is first.
5. For an employee without a `bonus_model`, click "הגדר מודל" → land
   on `/team` with that employee's edit dialog open.
6. The `/` mini-widget shows the same totals as the `/bonuses`
   footer for the current month.

Commit: `feat(bonus): all-employee view with search + period filter (Phase C)`.

---

## Phase D — Cleanup verification

End-of-run integrity check (must all return `0` counts):

```bash
# No leftover [TEST-…] tagged data:
curl -sS "$VITE_SUPABASE_URL/rest/v1/transactions?notes=ilike.%5BTEST-%25" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" | jq 'length'

curl -sS "$VITE_SUPABASE_URL/rest/v1/clients?name=ilike.%5BTEST-%25" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" | jq 'length'

curl -sS "$VITE_SUPABASE_URL/rest/v1/hours_log?description=ilike.%5BTEST-%25" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" | jq 'length'

# No leftover qa.test users (other than the real noa@banani-hr.com):
curl -sS "$VITE_SUPABASE_URL/auth/v1/admin/users?per_page=200" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" \
  | jq '[.users[] | select(.email | startswith("qa.test+"))] | length'
```

Real-data integrity:
- Count `transactions`, `clients`, `hours_log`, `profiles` (excluding
  test) before and after. Each must match.
- Spot-check 5 random real `transactions` rows — column values
  unchanged from the start-of-run snapshot.

If anything drifted, refuse to mark the run complete.

## Termination

1. Write `URGENT_FIXES_REPORT.md`:
   - Phase A: forensic findings, exact root cause, code changes,
     scenario-by-scenario evidence including Noa's final IDs.
   - Phase B: hours audit observations + each scenario step's
     actual outcome + screenshot path.
   - Phase C: bonus audit + scenario evidence.
   - Phase D: integrity check counts.
2. Print `URGENT FIXES COMPLETE` and stop.
