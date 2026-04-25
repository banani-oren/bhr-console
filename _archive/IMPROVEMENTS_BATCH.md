# Improvements batch — profile menu, users-table cleanup, Excel client import, role dashboards

Four independent features. Execute them sequentially, each end-to-end: implement →
`npm run build` → commit → push → wait ~90 s → verify on the live site via Chrome
using the magic-link admin login from `CLAUDE_CODE_AUTONOMOUS.md`. Do not stop, do
not ask, do not summarize mid-run. Produce `IMPROVEMENTS_REPORT.md` at the end.

## Read first

1. `BHR_CONSOLE_PROJECT.md`
2. `BHR_CONSOLE_CHECKLIST.md`
3. `SECURITY_FIX_AND_ROLES.md` — the three-role model is the source of truth for
   role names (`admin`, `administration`, `recruiter`) and what each can see.
4. This file.

## Hard rules

- English only for reasoning and commit messages.
- No deferrals. Every change is live-verified in Chrome on the production URL.
- Never print or commit secrets.
- For changes that touch the spec, also update `BHR_CONSOLE_PROJECT.md` in the same commit.

---

## Feature 1 — Replace sidebar-footer email with name; click opens editable profile

**Current state:** the sidebar footer shows the logged-in user's email and an "ADMIN"
role pill (see `src/components/Layout.tsx`).

**Target state:**

- Sidebar footer shows `profiles.full_name` (fallback: email if `full_name` is empty)
  and the role pill in Hebrew (`מנהל` / `מנהלה` / `רכז/ת גיוס`).
- The whole footer block is clickable. Clicking opens a profile screen — build it as a
  dedicated route `/profile` (a dialog is an acceptable alternative if it fits the
  design, but a route is preferred so it's shareable and refresh-stable).
- On `/profile` the user can edit their own `full_name` and `phone`. A separate
  "שנה סיסמה" button opens a password-change flow using
  `supabase.auth.updateUser({ password })` with a confirmation prompt; on success, show
  "הסיסמה עודכנה ✓". Email is NOT editable here (Supabase email change requires
  verification — out of scope).
- Save uses the existing save-state pattern: `שומר...` → `המידע נשמר ✓` (green) → or
  `שגיאה בשמירה, נסה שנית` (red), with `queryClient.invalidateQueries(['profile'])`
  on success so the sidebar footer updates immediately.
- The `/profile` route is wrapped in `RequireRole allow={['admin','administration','recruiter']}`
  (any logged-in user may edit their own profile).
- RLS already restricts writes to the caller's own row; do not loosen it.

**Live checks:**

- Sidebar footer shows the admin's `full_name` (e.g. "Oren Banani"), not the email.
- Click → lands on `/profile` with the form pre-filled.
- Edit `phone`, save → sidebar footer reflects the change on next render; DB value
  confirmed via service-role query.
- Change password → sign out, sign back in with the new password.
- Revert phone to the original value at the end of the run.

---

## Feature 2 — `/users` table: drop the "פעולות" column, Hebrew role dropdown inline

**Current state (see attached screenshot and `src/pages/Users.tsx`):** columns are
`אימייל | שם | תפקיד | פעולות`. `תפקיד` shows a role badge; `פעולות` contains
(trash, key, role-dropdown-with-English-labels). The role label and the dropdown are
duplicated.

**Target state:**

- Columns become: `אימייל | שם | תפקיד | ` (last column has no header).
- `תפקיד` column: inline role dropdown (shadcn `Select`) showing the current role in
  Hebrew. Options:
  - `admin` → `מנהל`
  - `administration` → `מנהלה`
  - `recruiter` → `רכז/ת גיוס`
  Changing the select value immediately updates `profiles.role` via Supabase and shows
  a transient success toast. The row's data refreshes via
  `queryClient.invalidateQueries(['users'])`.
- Trailing column (no header) holds the two icon buttons in this order:
  1. 🔑 reset-password icon — triggers `supabase.auth.resetPasswordForEmail(email)`,
     confirmation toast.
  2. 🗑 delete icon — opens a confirmation dialog; on confirm deletes the auth user
     via the `invite-user`/service-role pathway (you may need a small new edge
     function `delete-user` if one does not exist — if so, create it, deploy it,
     document it in the spec).
- Guard: the admin cannot delete themselves or demote themselves. The trash icon is
  disabled on the row where `profile.id === auth.uid()`; the role dropdown on the
  self-row is read-only.
- Hebrew role label in the sidebar footer (Feature 1) uses the same Hebrew map.

**Live checks:**

- Open `/users`, confirm the column headers are exactly: `אימייל`, `שם`, `תפקיד`, (blank).
- Change a test user's role via the dropdown from `רכז/ת גיוס` to `מנהלה`; confirm
  the change persists after reload and the `profiles.role` value is `administration`.
- Click the reset-password icon on a test user; confirm the email is sent (Resend logs).
- Click the delete icon on the test user; confirm they disappear from `/users` and
  `/team` and the `profiles`/`auth.users` rows are gone.
- On the self-row, verify the delete icon is disabled and the role dropdown is disabled.

---

## Feature 3 — Excel import of clients on `/clients`

Oren needs to re-import his master client list from his accounting platform
periodically without creating duplicates.

**Reference file:** `test-fixtures/clients-sample.xlsx` (copied into the repo — 80
rows, one sheet `רשימת לקוחות - קבועים`, six columns).

**Column mapping (case- and whitespace-tolerant; match by header text):**

| Excel header    | `clients` column  | Notes |
|-----------------|-------------------|-------|
| `שם העסק`        | `name`            | Required. Trim whitespace. |
| `שם איש הקשר`    | `contact_name`    | Nullable. |
| `דואל`           | `email`           | Nullable. Lowercase, trim. |
| `נייד`           | `phone`           | Nullable. Strip non-digits, preserve leading `0`. |
| `מספר עסק`       | `company_id`      | Nullable. Strip whitespace. |
| `כתובת`          | `address`         | Nullable. Trim. |

Rows where `name` is empty after trimming are skipped with a warning in the preview.

**Duplicate detection (in this order):**

1. If row has non-empty `company_id`: match against existing
   `clients.company_id` (exact, case-insensitive). If found → it's an update.
2. Else: match against existing `clients.name` (exact, case-insensitive, after
   collapsing internal whitespace). If found → update.
3. Else → new client.

**Update semantics:**

- Never overwrite a populated field in the DB with an empty value from the Excel.
  If Excel has a value and DB differs, overwrite. If Excel is empty, keep DB value.
- Never touch the agreement-term fields (`agreement_type`, `commission_percent`,
  `salary_basis`, `warranty_days`, `payment_terms`, `payment_split`, `advance`,
  `exclusivity`, `agreement_file`) — the Excel has no data for those and they are
  maintained through the client edit dialog.
- Preserve `created_at` on updates.

**UX:**

- `/clients` has an "ייבוא Excel" button (already exists — extend it).
- On upload: parse the sheet (use `xlsx` or `papaparse` library, already present).
- Show a preview dialog with three sections:
  - **חדשים** (new rows, green): count + sample list.
  - **עדכונים** (updates, amber): count + a tabular diff showing only the fields
    that would change.
  - **שגיאות** (skipped, red): rows with no name, malformed values, etc.
- Two buttons: `ביטול` (cancel) and `אשר ייבוא של N רשומות` (confirm). Confirm
  commits everything in a single logical operation; if any insert/update fails,
  roll back or at least report per-row success/failure in the final toast.
- After commit: invalidate `['clients']`, show summary toast:
  `נוספו X • עודכנו Y • דולגו Z`.

**Live check:**

1. Upload `test-fixtures/clients-sample.xlsx` in a fresh admin session.
2. Preview shows ~80 new rows (possibly a few updates if existing test clients overlap).
3. Confirm. All 80 clients appear in `/clients` with correct `name`, `contact_name`,
   `email`, `phone`, `company_id`, `address`.
4. Edit one imported client to set a custom `agreement_type = 'השמה'`,
   `commission_percent = 100`.
5. Re-upload the same Excel. Preview shows 80 updates with **no diff** for the edited
   client (the agreement fields are not touched). Confirm. Verify the edited client
   still has `agreement_type = 'השמה'` and `commission_percent = 100`.
6. Add a duplicate row in the Excel (edit the fixture to duplicate one business name
   with a tweaked address), upload — preview correctly shows it as an update, not a new.
7. Clean up any `[AUTOTEST]`-tagged records at the end, but keep the 80 imported
   real clients if Oren wants them (ASK via a new `[ ]` line in §13 of the checklist
   before deleting — actually, DO NOT auto-delete the 80 real clients; leave them
   imported and note this in the report).

---

## Feature 4 — Role dashboards at `/`

Currently `/` is admin-only and shows KPI cards + charts. Keep that for admins.
For the other two roles, render a role-specific productivity view.

### Recruiter dashboard (`role === 'recruiter'`)

Purpose: "how close am I to the next bonus?" — motivational, a single big visual.

Data source: `transactions` filtered by `service_lead = profiles.full_name` (RLS
already enforces this server-side; the frontend can still query normally).

Compute for the **current calendar month**:

- `monthRevenue` = sum of `net_invoice_amount` for my transactions where the
  current month is in scope. Use `closing_month/closing_year` if set, otherwise
  `billing_month/billing_year`, otherwise `entry_date`.
- `currentTier`, `nextTier` from `profiles.bonus_model.tiers` using the same logic
  as the existing portal (flat-tier, `[...tiers].reverse().find(t => rev >= t.min)`).
- `progressToNext` = `(monthRevenue − currentTier.min) / (nextTier.min − currentTier.min)`.

Render (RTL):

- A large hero card with the current bonus amount (`₪X`) and below it a horizontal
  progress bar from `currentTier.min` to `nextTier.min`, a marker at `monthRevenue`,
  and the label `עוד ₪Y למדרגת ₪Z` if not at max tier, or `הגעת למדרגה המקסימלית!`
  if at max.
- Three secondary KPI cards below: `הכנסה החודש` (₪), `עסקאות שנסגרו החודש` (count),
  `עסקאות פתוחות` (count where `payment_status='ממתין'`).
- A 6-month revenue bar chart (monthly sum of own revenue).
- Bottom: recent 5 of my transactions.

Empty-state: if `bonus_model` is null, show the progress hero with a copy like
`המנהל עדיין לא הגדיר מודל בונוס` and skip the progress bar; keep the KPI cards.

### Administration dashboard (`role === 'administration'`)

Purpose: "how close are we to collecting everything due this month?"

Data source: `transactions` (administration sees all rows per RLS).

Helpers needed:

- `parsePaymentTerms(termsText): number` — extracts the net-days from strings like
  `שוטף+30`, `שוטף +30`, `שוטף`, `שוטף+45`, `שוטף+60`. Returns `30`/`45`/`60`, and
  `0` for bare `שוטף`. Returns `null` if unparseable.
- `dueDate(txn)` = `close_date + parsePaymentTerms(payment_terms) days`. If either
  is missing, row has no due date.
- An "overdue" transaction is one where `dueDate < today AND payment_date IS NULL`.

Render (RTL):

- Hero: a radial/linear progress showing `collectedThisMonth / billedThisMonth`
  with percentage label. Subtitle: `₪A נגבו מתוך ₪B החודש — עוד ₪C לגבייה`.
- KPI cards: `סכום לגבייה כעת` (sum of open invoices),
  `שחרגו מתאריך פירעון` (sum overdue), `נגבה החודש` (sum with `payment_date` in
  current month), `ממתינים לחשבונית` (count where `invoice_number IS NULL AND
  is_billable`).
- Aging buckets chart (stacked bars or donut): `0-30 / 31-60 / 61-90 / 90+` of
  overdue amount.
- Top-10 overdue table sorted by `dueDate ASC`: client, amount, days overdue,
  contact phone/email (from the joined `clients` row), "סמן כנגבה" inline action
  that opens the edit dialog focused on `payment_date`.
- 6-month collections bar chart.

### Admin dashboard

Keep current behavior. Optionally add a role-switcher at the top
(`דשבורד מנהל / רכז/ת / מנהלה`) so Oren can preview the other dashboards without
switching accounts. This is nice-to-have — do it only if time permits.

### Routing

- `/` → if admin, render `AdminDashboard`; if administration, render
  `AdministrationDashboard`; if recruiter, render `RecruiterDashboard`. No redirect,
  just conditional render inside a single `DashboardPage` shell so the nav position
  stays the same.
- Update `RequireRole` on `/` accordingly: `allow: ['admin','administration','recruiter']`.
- Sidebar: `דשבורד` item is visible for all three roles now.

### Live checks

- Log in as the admin → `/` renders the existing KPI dashboard unchanged.
- Seed a recruiter (`qa.recruiter+dash@banani-hr.test`) with `role='recruiter'` and
  `bonus_model` copied from the spec (Noa's 6-tier model). Seed transactions with
  `service_lead` = this recruiter's `full_name` that total ₪30,000 this month.
  Log in as this recruiter → `/` shows bonus hero "₪2,100 • עוד ₪7,000 למדרגת
  ₪37,000", the 3 KPI cards, and the 6-month chart. Confirm they cannot access
  `/clients`, `/team`, or `/users`.
- Seed an administration user (`qa.admin+dash@banani-hr.test`) with
  `role='administration'`. Seed transactions with realistic `close_date` values
  across the last 4 months, some paid, some unpaid, some overdue. Log in → `/`
  shows the collections hero, aging chart, top-10 overdue table. Click
  "סמן כנגבה" on one row, set `payment_date=today`, confirm it disappears from
  the overdue list on refresh.
- Clean up the seeded users and their seeded transactions at the end.

---

## Checklist updates

Extend `BHR_CONSOLE_CHECKLIST.md`:

- Add a new §15 "Profile menu" with 5 checks (sidebar name, click-opens-profile,
  edit name, edit phone, change password).
- Add §16 "Users-table cleanup" with 5 checks (columns, dropdown, reset, delete,
  self-guard).
- Add §17 "Clients Excel import" with the 7 steps from Feature 3 live check.
- Add §18 "Role dashboards" with the three role-specific checks from Feature 4
  live check.

All checks require live browser evidence per the file's existing rules.

## Termination

When all four features are live-verified and their checklist sections are green:

1. Update `BHR_CONSOLE_PROJECT.md`:
   - Document the `/profile` route and the password-change flow.
   - Document the new `/users` layout (columns, inline role dropdown, trailing
     actions) and the self-guard rule.
   - Document the Excel import (mapping table, duplicate rule, non-overwrite rule).
   - Document the role-specific dashboards and their data sources.
2. Write `IMPROVEMENTS_REPORT.md` with:
   - Commit SHAs for each of the four features.
   - Screenshots (saved to `./qa-screenshots/`) of: sidebar footer pre/post,
     `/users` new layout, Excel import preview dialog, each of the three
     dashboards.
   - Counts from the live import run (new / updated / skipped).
   - A short "ideas not implemented" section listing any dashboard extensions
     deferred for a future batch, in case Oren wants to pick them up next.
3. Print `IMPROVEMENTS BATCH COMPLETE` and stop.
