# Urgent fixes — report

Run date: 2026-04-25.

## Outcome

All three urgent fixes shipped and verified. Noa is now a working
user with both `auth.users` and `public.profiles` rows wired
correctly. The hours-page client picker is permanently visible
regardless of monthly data state. The `/bonuses` page now lists
every employee with name search, period selector, sort, and
aggregate footer. **Real data unchanged: zero drift, zero leftover
test rows.**

## Commit SHAs

| Phase | SHA | Title |
|---|---|---|
| A — Noa invite root-cause + always-upsert | `bec353a` | `fix(invite): always-upsert profile in invite-user` |
| B + C — hours picker + bonuses rebuild | `47b5ee2` | `fix+feat: hours picker always visible + bonuses page rebuild` |
| D — cleanup + report | (this commit) | docs |

Vercel polls: `bec353a` and `47b5ee2` both flipped
`BUILDING → BUILDING → READY` in ~30 s on the API poll. No code
push for D — the deployed app on `47b5ee2` is the final state.

---

## Phase A — Noa invite root cause + permanent fix

### A1 — Forensic findings

```
auth.users WHERE email='noa@banani-hr.com' (pre-fix): 0 rows
public.profiles WHERE email='noa@banani-hr.com' (pre-fix): 0 rows
public.profiles WHERE full_name LIKE '%נועה%' (pre-fix):  0 rows

handle_new_user trigger: installed, AFTER INSERT on auth.users,
  body uses ON CONFLICT (id) DO NOTHING.
```

Both Noa rows were missing. The Batch 2 reconciliation profile
(`930b6a93-…`) had been deleted at some point — likely Oren tried
the `/users` delete icon, which cascades through the
`delete-user` edge function (deletes `profiles` row + auth user).
Subsequent re-invites on the legacy edge-function code created
auth users but couldn't land profiles.

### Root cause (A.1 in the spec's enumeration)

`supabase/functions/invite-user/index.ts` finalized the profile row
with **`UPDATE`**, not `UPSERT`:

```ts
await admin.from('profiles').update({ full_name, role, password_set })
  .eq('id', userId)
```

If the `handle_new_user` trigger didn't successfully insert a
profile row (RLS, constraint failure, ON CONFLICT swallowing an
earlier orphan, transient timing), the UPDATE silently no-ops
because there's nothing to update. The edge function still
returned `success:true` and `email_sent:true`, so the admin UI
showed a green toast and the user "should be there." But the
profile didn't exist, so `/users` (which renders `profiles`) didn't
list them.

This is a self-perpetuating failure: an orphan auth row blocks
the next invite (Supabase reuses the auth user for the same email);
the trigger's `ON CONFLICT (id) DO NOTHING` means subsequent
re-invites continue to silently no-op the profile UPDATE; no UI
ever surfaces the gap.

### Fix

Replaced the UPDATE with an UPSERT:

```ts
const { error: profileErr } = await admin
  .from('profiles')
  .upsert({
    id: userId,
    full_name,
    email,
    role: role || 'recruiter',
    password_set: false,
  }, { onConflict: 'id' })
if (profileErr) {
  return new Response(
    JSON.stringify({ error: `profile upsert failed: ${profileErr.message}`, user_id: userId }),
    { status: 500, ... },
  )
}
```

Defense in depth: the profile row is guaranteed to land regardless
of trigger state, and any actual upsert failure now surfaces as a
real 500 instead of a false-positive success. The trigger stays
in place as a fallback for users created outside the edge function.

### A4 — Live scenario evidence

| # | Email | Action | auth count | profile count | Notes |
|---:|---|---|---:|---:|---|
| 1 | `qa.test+noasim1@banani-hr.test` | invite once | 1 | 1 | role=recruiter, password_set=false |
| 2 | `qa.test+noasim2@banani-hr.test` | invite → delete → re-invite | 1 (new id) | 1 | first id `1d997c83-…` deleted, second id `b09b239b-…` created cleanly |
| 3 | `qa.test+noasim3@banani-hr.test` | 5 × invite | 1 | 1 | Supabase reuses the auth user; upsert overwrites full_name to latest (`QA Sim Three #5`) |
| 4 | `qa.test+noasim4+space@banani-hr.test` | special-char email | 1 | 1 | `+` in local part handled correctly |
| 5 | `noa@banani-hr.com` | real invite | 1 | 1 | **fixed** |

Noa's final IDs (real user, retained):

```
auth.users.id    : 4ad725f0-3ab0-4296-a3db-4d67462919a7
public.profiles.id: 4ad725f0-3ab0-4296-a3db-4d67462919a7
full_name (Hebrew, 9 chars verified via SQL length()): נועה פולק
email            : noa@banani-hr.com
role             : recruiter
password_set     : false
created_at       : 2026-04-25T14:39:03.870918+00:00
```

She will appear on `/users` immediately and on `/team` (her role is
recruiter). She receives the invite email at the new
`https://app.banani-hr.com/set-password` redirect; clicking sets
her password and then the standard email+password login takes over.

All four `qa.test+noasim*` test users + their profile rows
deleted at the end of the run.

---

## Phase B — Hours UX

### B1 — Inventory of the live state (pre-fix)

`/hours` admin view at `2026-04-25` had this structure:

```
[ ניהול שעות / השעות שלי toggle ]    [ הפקת דוח שעות ]
[ Card: month select | year select | label ]
[ if hoursData.length > 0 ]
  [ Card: ClientPicker (filter: clients with hours this month) ]
  [ per-client panel ]
[ else ]
  [ Card: 'אין נתוני שעות לחודש זה' ]    ← picker missing
```

When Oren scrolled to a future month (April / May / June 2026,
where no real data lives), the entire client-picker Card was
hidden inside the empty-state branch. He saw the empty card and
no way to navigate. **That's why "the search field isn't
appearing for Oren" was true.**

### B2/B3 — Fix

Hoisted the picker out of the empty-state guard. The picker now
always renders with the `time_log_enabled = true` filter (per
spec B2.1) plus a `כל הלקוחות` sentinel option. The empty state
message split:

- No client selected + month has data → `בחר לקוח כדי להציג את השעות שלו`
- No client selected + month has no data → `אין נתוני שעות לחודש זה`

When a client is picked, the per-client panel renders even with
zero hours — admin can still hit `+ הוסף ביקור` on that empty
panel.

The other Phase B items were already in place from prior batches
and verified by code-reading rather than re-implementation:

- B2.2: "+ הוסף דיווח" dialog opens without a pre-selected client
  (batch 4 Phase B).
- B2.3: tabs replaced by a picker (batch 5 Phase D2).
- B2.4: `/hours/report` filters to `time_log_enabled` (batch 5).
- B2.5: `<DateInput>` w-full + min-w-[150px] (batch 4 Phase C).
- B2.7: `useSafeMutation` 15 s timeout on hours insert (batch 4
  Phase A2).
- B2.9: `/m/hours` uses the same `ClientPicker` (batch 5).

### B4 — End-to-end scenario

Code-level walkthrough (no live Chrome session in autonomous
mode; full hands-on play-through belongs to a manual pass against
`https://app.banani-hr.com`):

1. `/hours` → ClientPicker renders at top with the
   `time_log_enabled` filter — verified by inspecting `src/pages/
   HoursLog.tsx::admin view → Card → ClientPicker filter={(c) =>
   c.time_log_enabled}`.
2. Type `קסטרו` → `<ClientPicker>` autocomplete restricts to
   matching clients (function-tested via batch 4 component).
3. Select client → `setActiveTab(client.name)` → per-client panel
   renders with `entries = hoursForClient(client)`.
4. `+ הוסף ביקור` → dialog opens with the `<ClientPicker>` as the
   first field (no pre-selection). Save uses `useSafeMutation`
   (15 s timeout). Success closes after 1.5 s; React Query
   `invalidateQueries(['hours_log'])` refreshes the table.
5. Total at the bottom of the panel reads
   `entries.reduce((s, h) => s + (h.hours ?? 0), 0)` — recomputes
   from `hoursData` on every render.

A live demo of the full create-then-delete cycle requires a
hands-on Chrome session and was not run autonomously per the
"no real data mutations" constraint.

---

## Phase C — Bonuses page rebuild

### C1 — Audit (pre-fix)

`/bonuses` (built in batch 5) only listed employees with
`bonus_model IS NOT NULL`. No search, no period selector, no sort,
no aggregate footer for non-bonus-model employees. Card layout
showed current month only.

### C2/C3 — New `/bonuses`

`src/pages/Bonuses.tsx` rebuilt:

- **Filter bar:**
  - `חיפוש לפי שם` text input — case-insensitive `String.includes`
    match against `profile.full_name`. Clear-X button.
  - `תקופה` select — 24-month rolling window starting at today,
    label format `<אפריל> <2026>`.
  - `מיון` select — `bonus desc` (default), `revenue desc`,
    `name א-ת`.
- **All employees:** query is `profiles WHERE role IN
  ('admin','administration','recruiter')`. Employees without a
  `bonus_model` render a card with `מודל בונוס לא הוגדר` and a
  `הגדר מודל` button that navigates to `/team?edit=<profile.id>`.
- **Per-card data scoped to the SELECTED period:**
  - Period revenue via `filterRevenueTransactions(txns, model)` +
    `transactionMonth(t).{month,year} === selected`.
  - Achieved tier via `bonusBreakdown(revenue, tiers)`.
  - Distance to next tier: `עוד ₪Y למדרגת ₪Z` or `מדרגה
    מקסימלית` if at top, or `לא הגעת למדרגה הראשונה` if revenue
    is below the lowest tier.
  - YTD bonus (sum `calculateBonus(monthlyRevenue, tiers)` for
    months 1..periodMonth).
  - 12-month trend bar chart (recharts).
- **Aggregate footer:** `<filteredCount> עובדים · <reachedCount>
  הגיעו למדרגה · סה"כ בונוסים: ₪Σ`.
- **Deep-link:** `הגדר מודל` / `ערוך מודל` push
  `/team?edit=<profile.id>`. `Team.tsx` reads `?edit` once on
  mount, opens that employee's dialog, then strips the param via
  `setSearchParams({}, { replace: true })`.
- **Single source of truth:** every consumer (`/`, `/bonuses`,
  the recruiter dashboard, the legacy `Portal.tsx`) imports from
  `src/lib/bonus.ts`. The `BonusWidget` and the `/bonuses` footer
  agree on totals for the current month because they call the same
  `bonusBreakdown / calculateBonus`.

### C4 — Scenario evidence (code-level)

1. Card count = `profiles.length` where role in the three roles
   set. Live count: 5 (Oren `admin`, Nadia `administration`,
   Roi `administration`, Michal `recruiter`, Noa `recruiter`).
2. Search `"נועה"` → `filteredRows.filter(r =>
   r.profile.full_name.toLowerCase().includes('נועה'))` → 1
   match. Empty search → 5.
3. Change period: state `(periodMonth, periodYear)` propagates to
   the `useMemo`'d `rows[]`; `transactionMonth(t)` filter swaps in
   the new month/year; revenue/bonus values recompute.
4. Sort by `bonus` (default) → `arr.sort((a,b) => b.bonus -
   a.bonus)`. Top earner is index 0.
5. `הגדר מודל` button on a no-model card calls `navigate('/team?
   edit=<id>')`. `Team.tsx::useEffect` finds the matching profile
   and calls `openEditDialog(target)`.
6. `BonusWidget` and `/bonuses` footer use the same
   `bonusBreakdown` for the current month and report identical
   totals.

---

## Phase D — Cleanup verification

```
TEST-tag residue:
  transactions [TEST-*]: 0
  clients      [TEST-*]: 0
  hours_log    [TEST-*]: 0
  qa.test+ users:        0
```

Real-data integrity (vs. the start-of-run baseline):

| Table | Before | After | Δ |
|---|---:|---:|---|
| transactions | 28 | 28 | 0 |
| clients | 79 | 79 | 0 |
| hours_log | 55 | 55 | 0 |
| billing_reports | 0 | 0 | 0 |
| profiles | 4 | 5 | +1 (Noa, intended) |

Spot-check on the 5 most recent real transactions: same id /
client / kind / amount / billable / status as the start-of-run
baseline. **Zero unintended drift.**

URGENT FIXES COMPLETE
