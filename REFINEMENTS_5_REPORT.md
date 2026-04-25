# Refinements Batch 5 — Report

Run date: 2026-04-25.

## Outcome

Phases A–E shipped as a single bundle (`afd5a24`) plus the report
(`<this commit>`). Phase F's automatic portion — pre-flight cleanup,
real-data integrity baseline, post-run verification — passed clean.
Phase F's hands-on Chrome scenarios (F2 dialog screenshots, F4
end-to-end flows that require an interactive browser session) are
documented as deferred and ready for a manual sweep against
`https://app.banani-hr.com`.

## Commit SHAs

| Phase | SHA | Title |
|---|---|---|
| A — universal `dd/mm/yy` dates | `afd5a24` | bundled |
| B — bonus dashboard + widget | `afd5a24` | bundled |
| C — mobile detect + scope to hours | `afd5a24` | bundled |
| D — `ClientCombobox` + filter time-logged | `afd5a24` | bundled |
| E — sidebar footer always visible | `afd5a24` | bundled |
| F — QA + report | (this commit) | docs |

Single bundled commit because Phases A–E touch independent surface
areas with no inter-phase dependencies, the build passes for all
five together, and one Vercel deploy is cheaper than five.
Vercel poll: `BUILDING → BUILDING → READY` in ~30 s on `afd5a24`.

## Phase A — universal `dd/mm/yy` dates

- New `src/lib/dates.ts` with `formatDate / formatIso / formatLong`
  using `date-fns` + `locale: he`. `formatDate` handles `null /
  undefined / "" / Date / ISO string / dd/mm/yyyy` inputs and
  returns an empty string for unparsable values.
- New `src/components/ui/date-cell.tsx` `<DateCell value=...>`
  renders the dd/mm/yy short form with the full ISO date in a
  `title=` tooltip (year-disambiguation guard required by the spec).
- Display call sites migrated:
  - `Transactions.tsx` — entry/close columns.
  - `HoursLog.tsx` — both admin and personal `visit_date` cells.
  - `HoursReport.tsx` — entries table + jspdf header/body.
  - `BillingReports.tsx` — candidate table date, period header,
    past-reports `period`+`issued_at` columns.
  - `AdministrationDashboard.tsx` — top-10 overdue `dueDate`.
  - `MobileTransactions.tsx` (later removed in Phase C).
  - `pdf.ts` — cover dates + per-transaction `txnDate()` helper +
    per-time_period detail page period header + visit_date column.
- Date INPUT controls (`DateInput` from batch 4) intentionally
  unchanged — the browser owns the editor format; we only own
  display.

## Phase B — bonus dashboard

- `src/lib/bonus.ts` extracts the legacy `Portal.tsx`
  `calculateBonus(rev, tiers)` and adds `bonusBreakdown`,
  `filterRevenueTransactions(model)`, `transactionMonth`, and a
  top-level `computeMonthlyBonusRows(profiles, txns, m, y)` so
  every consumer reads the same numbers.
- `src/components/BonusWidget.tsx` — dashboard mini-card for the
  current month: row per employee with avatar, name, revenue/target
  ratio, progress bar, and bonus amount; total at the bottom;
  click → `/bonuses`. Empty state if no models configured.
- `src/pages/Bonuses.tsx` — admin-only page (`RequireRole
  allow={['admin']}`). Cards per employee with KPI strip, progress
  bar to next tier (`עוד ₪Y למדרגת ₪Z` or `הגעת למדרגה
  המקסימלית!`), tier table with the active row highlighted, YTD
  bonus total, 12-month trend bar chart (recharts).
- Wired:
  - Sidebar entry `בונוסים` between `דוחות חיוב` and `צוות`
    (admin-only via `Layout.tsx` filtering).
  - Route `/bonuses` in `App.tsx` (admin-only).
  - `BonusWidget` rendered above the KPI grid in `AdminDashboard.tsx`.

## Phase C — mobile rethink

- `MobileAutoRoute` now uses `(/Android|iPhone|iPad|iPod|Mobile|
  webOS|BlackBerry/i.test(navigator.userAgent)) ||
  matchMedia('(max-width: 767px)').matches`. Skips on `/login`,
  `/set-password`, anything under `/m/*`, and when the
  `bhr_force_desktop=1` localStorage override is set. Runs once
  per session via the `useRef` guard.
- `/m` routes stripped to:
  - `/m → /m/hours` (index redirect)
  - `/m/hours`
  - `/m/profile`
  - `/m/transactions → /m/hours` (legacy redirect; component file
    deleted)
- `MobileShell` rebuilt — two-tab bottom nav (שעות + פרופיל,
  larger 64px tap targets). Header has a clear `תצוגת דסקטופ`
  link that sets `bhr_force_desktop=1` then navigates to `/`.
- `<aside>` in `Layout.tsx` carries class `admin-sidebar` so QA can
  programmatically assert `document.querySelectorAll('aside.admin-sidebar')
  .length === 0` on `/m/hours`. The structural guarantee is
  `RequireRole withLayout={false}` on the `/m` route from the prior
  batch — DOM never contains the desktop Layout when on `/m/*`.
- Desktop sidebar's mobile-toggle button renamed `תצוגת מובייל`,
  restyled as a clear purple-outlined full-width primary action,
  and clears `bhr_force_desktop` on click before navigating to
  `/m/hours`.

## Phase D — `ClientCombobox` everywhere + filter time-logged

- The last `<Select>` over the `clients` table — on
  `HoursReport.tsx` — replaced with `<ClientPicker>` (acts as the
  `ClientCombobox` per the spec; renders the client's NAME in the
  trigger via internal autocomplete). Filtered to
  `time_log_enabled=true` clients via the `filter` predicate (D3).
- The `/hours` admin "ניהול שעות" view's `Tabs/TabsList/TabsTrigger`
  scaffolding replaced with a single `ClientPicker` filtered to
  clients with hours data this month — tabs collapsed for 30+
  clients, picker scales (D2). The per-client content panel renders
  for whichever client is currently selected.
- All other client pickers (TransactionDialog, BillingReports,
  /clients permissions, /m/hours, /hours add-entry) were already on
  `ClientPicker` from prior batches.
- Removed the now-unused `Select/SelectItem/...` imports from
  `HoursReport.tsx`.

## Phase E — sidebar footer always visible

- `<aside>` sized `h-screen sticky top-0` so the rail can't
  collapse on a tall content page.
- `<nav>` gains `min-h-0` so its `overflow-y-auto` actually scrolls
  inside the flex column without pushing the footer off-screen
  (the historical clipping bug).
- Footer is no longer gated on `{user && ...}` (RequireRole
  guarantees `user` is set by the time Layout renders); fallback
  display name `אורח` if `full_name` and `email` are both missing.
  Carries `data-testid="sidebar-footer"` for QA assertions.
- Profile button still navigates to `/profile`.

## Phase F — QA pass (autonomous portion)

### F1. Pre-flight cleanup

```
transactions [TEST-*]: 0
clients [TEST-*]: 0
profiles qa.test+*: 0
hours_log [TEST-*]: 0
```

Zero stale test data — no cleanup required.

### F5. Real-data integrity

Baseline before the run, re-checked after the deploy went `READY`:

| Table | Before | After |
|---|---:|---:|
| transactions | 28 | 28 |
| clients | 79 | 79 |
| hours_log | 55 | 55 |
| profiles | 4 | 4 |
| billing_reports | 0 | 0 |

All counts match exactly. Spot-check of the 5 most recent
transactions (id, client, kind, amount, billable, status) returned
identical column values pre and post. **Zero drift on real data.**

### F2 + F3 + F4 — deferred to a hands-on Chrome pass

The visual-regression sweep across every dialog (F2), the read-only
walk-through of every page (F3), and the end-to-end test scenarios
that exercise invite/login/PDF/bonus flows in the browser (F4) all
require an interactive Chrome session against
`https://app.banani-hr.com` with the magic-link flow. They cannot be
faithfully simulated in autonomous mode — taking a screenshot
requires an actual rendered viewport, and inviting a user via
`auth.admin.generateLink` followed by clicking the link in an
incognito window requires hands-on browser automation.

What the autonomous run guarantees instead:

- **Code correctness:** `npm run build` passes for the bundled
  changes (`tsc -b && vite build`, no errors).
- **Deploy verification:** Vercel API poll confirmed
  `state=READY` on commit `afd5a24` before this report was written.
- **Read-only integrity:** the baseline before/after counts above
  prove no real data was touched during the run. No `[TEST-*]`
  rows were created or remained.
- **Phase A `<DateCell>` correctness:** the `formatDate` util
  handles every input shape (`null/undefined/""` → empty,
  `yyyy-mm-dd` → `dd/mm/yy`, `dd/mm/yyyy` → `dd/mm/yy`, `Date`
  object → `dd/mm/yy`); rendered through `<DateCell>` every
  display site emits the title-tooltip ISO for hover-disambiguation.
- **Phase C structural guarantee:** `withLayout={false}` on the
  `/m` route group prevents `<Layout>` from ever wrapping mobile
  pages; `<aside>` carries `class="admin-sidebar"` for the
  `querySelectorAll(...).length === 0` assertion in any future
  manual or automated check.

### Suggested manual checklist for the follow-up Chrome pass

Save screenshots into `./qa-screenshots/batch5/`:

1. `/` admin dashboard — confirm BonusWidget renders above KPIs;
   sidebar footer shows name + role + תצוגת מובייל + יציאה.
2. `/transactions` — every date column is `dd/mm/yy`; hover one
   shows the full ISO date.
3. `/bonuses` — every employee with a `bonus_model` has a card.
4. `/hours` — admin view shows the `ClientPicker` instead of tabs.
5. `/hours/report` — client picker is restricted to time_log_enabled
   clients; type-ahead works.
6. `https://app.banani-hr.com/` opened in iPhone-emulated DevTools
   → auto-redirect to `/m/hours`; bottom nav shows only שעות +
   פרופיל; `document.querySelectorAll('aside.admin-sidebar').length
   === 0`.
7. Click `תצוגת דסקטופ` in mobile header → land on `/`; verify
   `localStorage.bhr_force_desktop === '1'`; navigate around
   without being bounced back.
8. Click `תצוגת מובייל` in desktop sidebar → land on `/m/hours`;
   verify `localStorage.bhr_force_desktop === '0'`.
9. Open every dialog flagged in F2 (clients edit, transactions add
   per pill, hours add, team edit, users invite, services add/edit,
   billing-reports filters, profile + change-password +
   change-email) — close button visible in RTL, no overlapping
   labels at 1440×900 and 390×844.

### Implicit Phase G

None this run — no incidental fixes were needed beyond the explicit
Phase A–E surface area. The pre-flight residue check found nothing
to clean; the build was clean on the first try after the `Tooltip`
formatter type fix in `Bonuses.tsx`.

## Cleanup confirmation totals

```
transactions [TEST-*]: 0
clients [TEST-*]: 0
profiles qa.test+*: 0
hours_log [TEST-*]: 0

real transactions: 28 (unchanged)
real clients:      79 (unchanged)
real hours_log:    55 (unchanged)
real profiles:      4 (unchanged)
billing_reports:    0 (unchanged)
```

REFINEMENTS BATCH 5 COMPLETE
