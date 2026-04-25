# Refinements batch 5 — date format, bonus dashboard, mobile rethink, hours UX, profile in sidebar, full QA pass

Six phases. Execute in order. Each phase ends with `npm run build` →
commit → push → poll Vercel for `state=READY` → live verification in
Chrome via the admin magic-link flow. Do not stop, do not ask, do not
summarize mid-run. Produce `REFINEMENTS_5_REPORT.md`.

## Read first

1. `BHR_CONSOLE_PROJECT.md`.
2. `BHR_CONSOLE_CHECKLIST.md`.
3. `CLAUDE_CODE_AUTONOMOUS.md` — the build-status verification rule
   applies to every push in this batch.
4. `REFINEMENTS_BATCH_4.md` — the mobile shell and PWA were built here;
   this batch revises both.
5. This file.

## CRITICAL: real data on the live system

Oren now has live business data on `https://app.banani-hr.com`. Treat the
production database as **read-only for existing rows**. Specifically:

- **Never** delete, update, or otherwise modify any row that does not
  carry an explicit test tag (`[TEST-…]`, `[AUTOTEST]`, `qa.test+…`).
- For every CRUD-style test, **insert a new test row, exercise it,
  delete it** before the end of the run.
- Read-only verification (filter, search, click, expand) is fine on
  real rows. Do not change billable toggles, payment statuses, etc., on
  real records under any circumstance.
- At the end of the run, confirm zero test rows remain by querying the
  database for any `notes ILIKE '%[TEST%'` or `email ILIKE 'qa.test+%'`.

## Hard rules

- English only for commits.
- Do not print or commit secrets.
- Build verification: every `git push` is followed by polling the
  Vercel API until `state=READY`; on `ERROR` or `CANCELED`, fix and
  retry — see `CLAUDE_CODE_AUTONOMOUS.md` for the contract.
- All visual fixes are verified at BOTH desktop (1440×900) and mobile
  (390×844) viewports, with at least one screenshot per fix saved to
  `./qa-screenshots/batch5/`.

---

## Phase A — Universal date format `dd/mm/yy`

**Goal:** every date displayed in the app uses `dd/mm/yy` (two-digit
year) — tables, KPI cards, dialogs, PDFs, the lot.

### Implementation

1. Create `src/lib/dates.ts` with a single function:
   ```ts
   import { format, parseISO } from 'date-fns'
   import { he } from 'date-fns/locale'

   /** Display a date as dd/mm/yy. Pass null/undefined → empty string. */
   export function formatDate(input: string | Date | null | undefined): string {
     if (!input) return ''
     const d = typeof input === 'string' ? parseISO(input) : input
     return format(d, 'dd/MM/yy', { locale: he })
   }
   ```
   `date-fns` is already in the dependency tree (used by react-day-picker
   if shadcn/ui's calendar primitives are present); if not, `npm i date-fns`.

2. **Audit every date render in the app.** Grep for these patterns and
   replace with `formatDate(...)`:
   - `toLocaleDateString`
   - `Intl.DateTimeFormat`
   - any string that looks like a date format token
     (`yyyy-MM-dd`, `dd/MM/yyyy`, etc.)
   - direct rendering of an ISO date column from a `transactions` /
     `hours_log` / `clients` row

3. **Date INPUTS** (HTML `<input type="date">`) cannot be forced to
   show `dd/mm/yy` — the browser owns the editor's format. Leave the
   editor alone, but ensure all *display* of the same value uses
   `formatDate()`. The shared `<DateInput>` component from batch 4
   stays as-is for entry; for display in tables, use the new util.

4. **Year disambiguation guard.** `dd/mm/yy` makes `26/04/26` and
   `26/04/1926` indistinguishable. Add a tooltip on every formatted-date
   element with the full ISO date so a hover reveals the four-digit
   year. Keeps the visual short while preserving auditability.

### Live checks

- `/transactions` table: every date column shows `26/04/26`-style.
- `/hours` table: same.
- Dashboard KPI subtitles: same.
- Hovering any date shows the ISO date.
- Date pickers still work (browser-native editor unchanged).

Commit: `feat(dates): unified dd/mm/yy display via formatDate util (Phase A)`.

---

## Phase B — Admin bonus dashboard + main-dashboard mini-widget

**Goal:** at-a-glance view of every employee's bonus position this month.

### B1. Mini-widget on the main `/` dashboard

Add a card to the admin dashboard between existing KPIs and charts:

- Title: `בונוסים — <חודש נוכחי>`
- A row per employee with a configured `bonus_model`:
  - `[avatar]  שם  •  ₪revenue / ₪tier_target  ━━━━━━○━━━ progress%  •  בונוס נוכחי: ₪X`
- A footer total: `סה"כ בונוסים צפויים: ₪Σ`
- Clicking the card opens `/bonuses` (built next).

If no employees have a configured `bonus_model`, show an empty state:
`עדיין לא הוגדרו מודלי בונוס. עבור ל-/team כדי להגדיר.`

### B2. New `/bonuses` page (admin only)

Sidebar entry: `בונוסים`, between `דוחות חיוב` and `צוות`. Guard with
`RequireRole allow={['admin']}`.

Layout: card per employee, larger and richer than the dashboard widget:

- Employee name, photo placeholder, role pill.
- Current month: `revenue` (filtered per `bonus_model.filter`),
  `tier_min` reached, `tier_bonus`, distance to next tier
  (`עוד ₪Y למדרגת ₪Z`).
- Tiers table (read-only) showing all tiers and the highlighted current.
- Year-to-date totals: total bonuses paid (sum across closed months),
  monthly trend mini-bar-chart.
- Click "ערוך מודל" → navigates to `/team` and opens that employee's
  dialog (deep-link).

### B3. Data flow

Pure read of existing schema:

- `profiles` rows where `bonus_model IS NOT NULL`.
- `transactions` filtered by `bonus_model.filter` (today this is
  `service_lead = full_name`) for the current calendar month.
- Bonus calculation reuses the existing `calculateBonus(rev, tiers)`
  helper from `Portal.tsx` — extract it to `src/lib/bonus.ts` so
  multiple pages share one truth.

### Live checks

- Set Oren's `bonus_model` (existing or seeded). On `/`, the bonus
  card lists Oren with the correct revenue + tier + progress.
- Open `/bonuses` → see Oren's full breakdown card.
- Set the same model on a test employee, seed two `[TEST-…]` transactions
  with `service_lead` = test employee's name → both Oren and the test
  employee appear; numbers match. Delete the test transactions and
  test employee at the end.
- As a non-admin (seeded recruiter test user): `/bonuses` redirects;
  the `/` widget is not rendered (their dashboard view is the
  per-role view, unchanged).

Commit: `feat(bonus): admin bonus dashboard + main-dashboard widget (Phase B)`.

---

## Phase C — Mobile rethink: detect, redirect, scope to hours only

**Problem:** the existing `/m` mobile shell still bleeds the desktop
sidebar on a mobile browser, and the "switch to mobile view" link in the
admin sidebar is "barely noticeable." Goal: mobile users see ONLY the
hours-reporting screen; admins are still served full desktop on desktop.

### C1. Detection + auto-redirect

In `src/App.tsx`, on every mount of a non-`/m` route:

```ts
const isMobile =
  /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry/i.test(navigator.userAgent)
  || window.matchMedia('(max-width: 767px)').matches
```

Behavior:

- If `isMobile` AND not on `/m/*` AND not on `/login` → redirect to
  `/m/hours`.
- Persist a one-time override flag in `localStorage`
  (`bhr_force_desktop=1`) so an admin on a tablet who explicitly chose
  desktop view isn't bounced back. The override is set when the admin
  clicks "תצוגת דסקטופ" inside `/m`. Cleared by tapping
  "תצוגת מובייל" in the desktop sidebar.

### C2. Strip `/m` to hours only

Per Oren: "from the mobile, you should only have access to the hour
reporting." Update `/m`:

- Routes:
  - `/m` → redirect `/m/hours`
  - `/m/hours` (kept)
  - `/m/profile` (kept for password change / logout)
  - **Remove** `/m/transactions` and any other admin-style mobile view
    that batch 4 created. They're never useful on a phone.
- Bottom nav: just `שעות` and `פרופיל` (two tabs, fat thumb-zone).
- Header: app title + `תצוגת דסקטופ` link only — no nav links.

### C3. Sidebar leak — kill it for real

A regression already happened once. Add a **structural** guarantee, not
a CSS hack:

- The `<Layout>` component (admin shell) is gone from any descendant of
  the `/m/*` route subtree. Check the React tree at runtime via
  `document.querySelectorAll('aside.admin-sidebar').length` — must be 0
  on `/m/hours`. Add this assertion to the live check; if it fails,
  the test fails.

### C4. Make the desktop "view mobile" link visible

In the admin sidebar footer, replace the current barely-visible link
with a clear button:

```
[ 📱 תצוגת מובייל ]
```

Sized like the other primary actions, purple outlined, full-width inside
the sidebar footer. On click: sets `localStorage.bhr_force_desktop = 0`
and navigates to `/m/hours`.

### Live checks

- Visit `https://app.banani-hr.com/` from Chrome DevTools' iPhone 14 Pro
  emulator → auto-redirected to `/m/hours`. No admin sidebar visible
  (DOM assertion above passes). Bottom nav shows only שעות + פרופיל.
- From desktop (1440×900), visit `/` → admin dashboard renders with
  full sidebar including a clearly visible "תצוגת מובייל" link.
- Click "תצוגת מובייל" → land on `/m/hours`.
- Click "תצוגת דסקטופ" inside mobile → land back on desktop, no
  redirect-back loop.

Commit: `feat(mobile): auto-detect + scope to hours-only + visible toggle (Phase C)`.

---

## Phase D — Hours UX overhaul + universal "search instead of dropdown"

### D1. Hours page client picker

**Symptom:** the client search field on `/hours` isn't appearing for
Oren; a dropdown of clients is too clumsy when many clients have hour
reporting enabled.

Replace **every** client picker in the app with a single shared
`<ClientCombobox>` component:

```tsx
<ClientCombobox
  value={clientId}
  onChange={setClientId}
  filter={(c) => c.time_log_enabled}     // optional filter predicate
  placeholder="חפש לקוח..."
/>
```

- Built on shadcn `Command`. Always shows a search input. Type-ahead
  filter against `clients.name` and `clients.company_id` — same UX as
  the transaction-dialog combobox from batch 3.
- Where it appears:
  - `/hours` top filter
  - `/hours` add-entry dialog
  - `/hours/report` (filter — see D3)
  - `/transactions` add/edit dialog (already migrated; verify)
  - `/billing-reports` filter
  - `/clients` time-log permissions multi-select (uses the same component
    in multi-select mode)

### D2. Time-management client list

The "ניהול שעות" tab (admin's per-client tabbed view) is now driven by
`<ClientCombobox filter={c => c.time_log_enabled}>` at the top instead
of a horizontal tab bar. Tabs were fine for 3 clients, broken for 30+.

### D3. "הפק דוח שעות" client filter

The client picker on the hours-report dialog must filter by
`time_log_enabled = true` — Oren should not see clients without time
logging in this list. Same `<ClientCombobox filter>` predicate.

### D4. Audit and replace every dropdown of dynamic data

**Universal rule going forward:** any `<Select>` whose options come from
a database table becomes a searchable combobox. Static enums (small,
fixed) remain simple selects.

Audit and replace:

- Service-lead pickers (employee list)
- Service-type pickers in the transactions dialog (already pills; OK)
- Client pickers everywhere (Phase D1)
- Employee multi-select on `/clients` time-log permissions
- Any other dropdown of dynamic data found during the audit

For static enums (don't replace):
- Payment status (4 values)
- Billable yes/no
- Service-type pills already work

### D5. Double-confirm: hours dialog opens with no pre-selected client

Per batch 4, the hours add-entry dialog should accept the client
picker INSIDE the dialog, not require selection first. Re-verify this
works after the combobox swap.

### Live checks

- `/hours` shows the combobox at top. Type a client name → filtered
  results within 200ms. The combobox shows ONLY clients with
  `time_log_enabled = true` (use the seeded permission set; verify a
  non-time-logged client doesn't appear).
- "הוסף דיווח" dialog opens with empty client field; type-search picks
  client; save inserts the row.
- `/hours/report` client picker is also filtered to time-logged clients.
- `/transactions` create flow: type a client name → results appear.
- `/clients` edit dialog: time-log permissions multi-select supports
  type-ahead.
- No dropdown of `clients` or `profiles` rows remains anywhere — grep
  the JSX for `<Select>` over those collections returns zero matches.

Commit: `feat(ux): ClientCombobox everywhere + filter time-logged on hours flows (Phase D)`.

---

## Phase E — Profile in the sidebar footer (desktop)

**Symptom:** when viewing the dashboard, Oren's name + profile link at
the bottom of the navigation is missing.

### Implementation

The admin sidebar footer must always render:

```
┌──────────────────────────────────┐
│  [B]  אורן בנני                   │  ← clickable area → /profile
│       מנהל                       │
│                                  │
│  [ 📱 תצוגת מובייל ]              │  ← from Phase C
│  [ ↩  יציאה  ]                    │  ← logout
└──────────────────────────────────┘
```

- Uses `useAuth()` to read the current user's `full_name` + role.
- Role pill in Hebrew: `מנהל` / `מנהלה` / `רכז/ת גיוס`.
- The clickable name area navigates to `/profile`.
- Avatar = first letter of full_name, on `bg-purple-600 text-white`.

This was supposed to be in batch 1 Feature 1; verify it's wired and
not getting clipped by sidebar overflow. If a CSS bug is hiding it
(common cause: parent `overflow-hidden` + insufficient flex-basis for
the footer block), fix.

### Live checks

- `/`, `/clients`, `/transactions`, `/hours`, `/team`, `/users`,
  `/services`, `/billing-reports`, `/bonuses` — every admin page
  shows the footer with name + role.
- Click name → lands on `/profile`.
- Click "יציאה" → logged out, lands on `/login`.

Commit: `fix(layout): sidebar footer always shows profile + role + actions (Phase E)`.

---

## Phase F — Comprehensive end-to-end QA, no real-data mutations

After A–E ship and Vercel reports `READY`, run a structured live test
of the entire system. **Never modify or delete real data.**

### F1. Test data conventions

- New test client: `[TEST-2026-04-23] QA Client` (delete at end).
- New test employee: `[TEST-2026-04-23] QA Employee` (delete at end).
- New test transaction: `notes` starts with `[TEST-2026-04-23]`.
- New test hours: `description` starts with `[TEST-2026-04-23]`.

Pre-flight: query the live DB for any leftovers from previous runs and
delete them (only rows tagged `[TEST-…]` or `[AUTOTEST]`, never
unmarked rows).

### F2. Visual regression — switches & overlap

This has been Oren's repeated complaint. Spend an explicit pass on it.

For every dialog and form across:
- `/clients` edit
- `/transactions` add (each pill: השמה, הד האנטינג, הדרכה, גיוס מסה,
  דיווח שעות)
- `/hours` add-entry
- `/team` employee edit
- `/users` invite
- `/services` add/edit service type
- `/billing-reports` filters
- `/profile` edit + change-password + change-email dialogs

Verify each:
- All labels are fully visible — none clipped, none overlapping inputs.
- All toggles render `LabeledToggle` with bold-active text and the
  expected ON / OFF labels in Hebrew on either side.
- The close ✕ button is visible and not behind the title in RTL.
- Date fields show full DD/MM/YY (Phase A) without clipping.
- 2-column form grids collapse to 1 column at viewport <768px.
- No labels run into adjacent fields.

For each dialog, take a screenshot at 1440×900 desktop and 390×844
mobile. Save to `./qa-screenshots/batch5/dialogs/`.

### F3. Functional walk-through (read-only on real data)

For every page, do at least one read interaction without changes:

- `/` — KPIs render, charts render, no console errors.
- `/clients` — table loads, search filters, opening edit dialog of
  a real client closes WITHOUT saving (verify nothing changed via DB
  query).
- `/transactions` — search works (Phase D + batch 4 free-text), all
  six dropdowns filter correctly, real rows do not change billable
  status when you HOVER the toggle (only on click — verify intentional).
- `/hours` — Oren's real entries are visible; no test data appears
  unless you just created it. Closing month modal opens but you click
  cancel (do NOT close any real month).
- `/team` — every employee card visible. Open Oren's card and close
  without saving.
- `/services` — list renders. Open a service-type editor and close
  without saving.
- `/billing-reports` — filter by `כל הלקוחות`; period for last month
  → list shows real billable items. Generate a report only with
  `[TEST-…]` rows or skip altogether.
- `/users` — table renders. Do not invite, delete, or toggle role on
  any real user.
- `/bonuses` (Phase B) — every employee with bonus_model appears.
- `/profile` — open, see your details, close.

Mobile pass:
- `/m/hours` — log a `[TEST-…]` entry against a test client; verify
  it appears; delete it.
- `/m/profile` — open, see name, close.

### F4. End-to-end test scenarios with test records

For these flows, create a `[TEST-…]` record, exercise the flow, delete:

1. **Invite → set password → login → see role-correct UI.** Use
   `qa.test+rolefix@banani-hr.test`. Delete the user at end.
2. **Time-period bill from logged hours.** Insert a test client +
   permission for Oren; log 2 test hours entries; create a time_period
   transaction via the `+ הוסף עסקה / דיווח שעות` flow; verify
   `/hours` shows them as billed; delete everything.
3. **Service transaction (השמה).** Create on a `[TEST-…]` client; verify
   it appears in `/transactions`; delete.
4. **Billing report.** With a `[TEST-…]` client + a `[TEST-…]`
   transaction, generate a billing report; verify PDF; delete the
   billing_reports row, the transaction, the client.
5. **Bonus dashboard.** Configure a bonus model on a `[TEST-…]`
   employee; seed a `[TEST-…]` transaction with `service_lead = test
   employee name`; verify they appear on `/bonuses` and on the main
   dashboard widget; delete everything.

### F5. Cleanup verification

End the run with two checks:

```bash
# Zero test residue:
curl -sS "$VITE_SUPABASE_URL/rest/v1/transactions?notes=ilike.%5B%TEST-%" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" \
  | jq 'length'                       # must be 0

curl -sS "$VITE_SUPABASE_URL/rest/v1/clients?name=ilike.%5BTEST-%" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" \
  | jq 'length'                       # must be 0

curl -sS "$VITE_SUPABASE_URL/rest/v1/profiles?email=ilike.qa.test+%25" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" \
  | jq 'length'                       # must be 0
```

Plus a real-data integrity check:

- Count of real `transactions` before vs after the run — must match.
- Count of real `clients` before vs after — must match.
- Count of real `hours_log` rows before vs after — must match.
- Spot-check 5 random real transaction rows: column values unchanged.

If any drift is detected, document it in the report and refuse to mark
the run complete.

### F6. Final report

Write `REFINEMENTS_5_REPORT.md`:

- Per-phase commit SHAs.
- Phase F2 dialog screenshot index (file → which dialog).
- Phase F4 scenario results: pass/fail per scenario, with the test
  record IDs created and confirmed deleted.
- Phase F5 cleanup confirmation.
- Anything you found and fixed during the QA pass that wasn't on the
  original phase list (these become "implicit Phase G" with their own
  small commits).

## Termination

1. Print the cleanup confirmation totals.
2. Print `REFINEMENTS BATCH 5 COMPLETE` and stop.
