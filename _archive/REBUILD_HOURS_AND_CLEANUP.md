# Rebuild hours module + repo cleanup + mobile guide rewrite

Three phases. Phase A is a hard reset of the hours UI — burn it down,
replace it with a clean implementation. Phase B is repo hygiene. Phase
C is a real employee onboarding guide. Per `CLAUDE_CODE_AUTONOMOUS.md`,
poll Vercel for `state=READY` after each push. Treat real data as
read-only. Produce `REBUILD_REPORT.md`.

## Read first

1. `BHR_CONSOLE_PROJECT.md`
2. `CLAUDE_CODE_AUTONOMOUS.md`
3. This file.

Do NOT read previous hours-related batch files. Pretend the hours UI
doesn't exist; design it fresh from the spec below.

## Hard rules

- English only for commits.
- Read-only on real rows; tagged `[TEST-…]` only for CRUD.
- Evidence rule: scenario quotes + screenshots, not "looks correct."
- No deferrals.

---

## Phase A — REBUILD the hours module

### A1. Burn it down (in a feature branch)

Delete or rename to `.deprecated` every existing hours-related
component, hook, and page that lives outside core data layer:

- `src/pages/HoursLog.tsx` (or whatever the admin page is)
- Any `src/pages/m/Hours.tsx`
- Any hours-specific dialogs / dropdown components / tab bars
- Any hours-related hooks beyond `useHoursLog` data fetching
  (keep data hooks; remove UI hooks)

Do NOT touch: `hours_log` table, RLS policies, `client_time_log_permissions`,
`useSafeMutation`, `<ClientCombobox>` (the shared component), `formatDate`.

Commit: `chore(hours): remove old hours UI before rebuild`.

### A2. Spec — exactly what to build

The hours module has THREE views, all reachable from `/hours`:

#### View 1: `השעות שלי` — personal time log (every authenticated user)

Header row, top to bottom:

1. Page title: `יומן שעות`.
2. Tab bar (only shown if current user has `role='admin'`): two tabs,
   `השעות שלי` (default) and `ניהול שעות`. Non-admins never see tabs;
   they always see View 1.
3. Filter bar — three controls in one row:
   - **Client** — `<ClientCombobox value={clientId} onChange filter={c =>
     userIsPermittedFor(c.id)} clearable={true} placeholder="כל הלקוחות שלי" />`
     - When empty, the user's hours across ALL their permitted clients
       are shown (filtered by month).
     - When a client is selected, only that client's hours are shown.
     - The combobox always renders the search input. If a value is
       selected, it shows as a chip with an `×` AND the input below
       still accepts typing to switch to a different client without
       clearing first. Test by clicking the field while a value is
       selected → search dropdown opens.
   - **Month** + **Year** — two simple `<Select>` (static enums:
     1–12 and current year ± 2). Default to current month/year.
4. `+ הוסף דיווח` button — large, purple, top-aligned with the filter
   row. Always visible regardless of selected client.

Body:

5. Table of hours_log rows for `profile_id = auth.uid()`, filtered by
   the current month/year and (if set) `client_id`.
   - Columns: `תאריך` (dd/mm/yy), `לקוח`, `משעה`, `עד שעה`, `שעות`,
     `תיאור`, `פעולות` (pencil to edit, trash to delete).
   - Empty state: `אין דיווחים בחודש זה`.
6. Footer: `סה"כ שעות — <חודש>: X` updates as rows are added/edited/
   deleted.

Add-entry dialog:

7. Opens with no pre-selected client (even if the page has one
   filtered). First field is `<ClientCombobox>` (same predicate as
   above); placeholder `חפש לקוח...`. Below: date picker (default
   today), `משעה` and `עד שעה` time inputs, `תיאור` textarea.
8. Save uses `useSafeMutation`. Inserts a `hours_log` row with
   `profile_id = auth.uid()`, computed `hours = (end - start) hours`.
9. Toast → close → table refreshes → footer total updates.

Edit and delete: pencil opens the same dialog pre-filled. Trash opens
a confirm dialog and deletes.

#### View 2: `ניהול שעות` — admin's per-client view (admin only)

Identical structure to View 1, EXCEPT:

- The client combobox filter has predicate `c => c.time_log_enabled`
  and shows ALL time-logged clients (not user's permission-scoped).
- The table shows `hours_log` rows where `client_id = selectedClient`
  (any user). One additional column: `עובד` (the employee's name).
- The empty state when no client is selected: `בחר לקוח כדי להציג
  דיווחים`.
- The `+ הוסף דיווח` button is visible only when a client is selected
  AND opens a dialog with a pre-filled client (admin can change it
  via the same combobox in the dialog).
- Add a `סגור חודש` button at the right end of the filter row, only
  visible when a client is selected. Clicking it confirms then upserts
  a `kind='time_period'` transaction for that client + selected month
  (existing behavior).

#### View 3: `הפק דוח שעות` — generate time-sheet PDF (admin only)

Move this from the existing scattered location to a clear button at
the top right of the `ניהול שעות` tab labeled `הפק דוח שעות`. Opens
a dialog:

- Client picker — `<ClientCombobox filter={c => c.time_log_enabled}>`.
- Period: from-date / to-date, default = current month.
- Optionally: employee multi-select (all by default).
- `הפק דוח` → renders a branded PDF (existing logic), download +
  optional "צור עסקה מהדוח" button.

### A3. Tests — every scenario must pass with documented evidence

For each, record keystrokes and observed outcomes in the report.

**View 1 (`השעות שלי`) as Oren:**

S1. Open `/hours`. Tab `השעות שלי` is selected. Filter bar shows three
controls. Combobox is empty. Table shows my hours across all clients
for the current month.

S2. Click the client combobox. Search dropdown opens. Type `שיב` →
`שיבומי...` appears in the list. Click it. Combobox shows the chip
+ search input remains. Table filters to my שיבומי hours.

S3. Click the combobox AGAIN (without clicking ×). Dropdown re-opens
with all permitted clients, current one highlighted. Type `קס` →
`קסטרו...` appears. Click. Selected client SWITCHES; table updates.

S4. Click `×` on the chip. Combobox is empty. Table shows ALL my
hours again.

S5. Change month to a previous month. Table refreshes; footer total
updates.

S6. Click `+ הוסף דיווח`. Dialog opens. Client field is EMPTY (does
not pre-fill from the page filter). Type to pick a client. Set
date today, start `09:00`, end `10:30`, description `[TEST-RB]
תיאור בדיקה`. Save. Toast within 3s. Dialog closes. Table refreshes;
footer total +1.5.

S7. Click pencil on the new row. Dialog reopens pre-filled. Change
end time to `11:00`. Save. Row updates; total +0.5.

S8. Click trash. Confirm. Row removed; total back to baseline. Verify
DB row is deleted via service-role query (notes/description tagged
[TEST-RB] returns 0 rows).

**View 2 (`ניהול שעות`) as admin:**

S9. Switch tab to `ניהול שעות`. Filter shows client combobox over ALL
time-logged clients. Empty state: `בחר לקוח כדי להציג דיווחים`.
`+ הוסף דיווח` button is hidden.

S10. Type `שיב` → select. Table loads ALL employees' hours for that
client this month. New column `עובד` shows employee names. The
`+ הוסף דיווח` button appears. The `סגור חודש` button appears.

S11. Click the combobox while selected → dropdown re-opens. Type `קס`
→ select. Table SWITCHES to the new client.

S12. Click `הפק דוח שעות` (top-right). Dialog opens with
the currently-selected client pre-filled (but still changeable via
its own combobox). Pick today as both from and to. Click `הפק דוח`.
PDF downloads. (Don't click `צור עסקה מהדוח` to avoid touching real
data.)

**Mobile (iPhone 14 Pro emulator):**

S13. As Oren on `/m/hours`. Same scenarios S1–S8 work at 390×844.
Combobox is full-width, accessible with thumb. Date input fully
visible (dd/mm/yy not clipped).

### A4. Acceptance gate

Code does not declare Phase A complete unless ALL 13 scenarios
pass with documented evidence (keystroke + observed result + screenshot
filename). If a scenario fails, fix the underlying issue and re-run
that scenario before moving on. No "looks correct" claims.

Commit: `feat(hours): clean rebuild — three views, swappable combobox, full coverage (Phase A)`.

---

## Phase B — Repo cleanup

### B1. Categorize root markdown files

Active reference (KEEP at root):

- `BHR_CONSOLE_PROJECT.md`
- `BHR_CONSOLE_CHECKLIST.md`
- `CLAUDE_CODE_AUTONOMOUS.md`
- `EMPLOYEE_MOBILE_INSTALL_GUIDE.md` (gets rewritten in Phase C)
- `README.md`

Archive (move to `_archive/`):

- All `*_BATCH*.md`, `*_REPORT.md`, `*_FIX*.md`, `*FIXES*.md`,
  `IMPORT_*`, `DOMAIN_*`, `MOBILE_AND_PROFILE_*`, `URGENT_*`,
  `QUICK_*`, `VERCEL_*`, `EMAIL_*`, `RUN_REPORT.md`,
  `IMPROVEMENTS_*`, `REFINEMENTS_*`, `SECURITY_*`,
  `POST_IMPORT_*`, `ONE_TIME_*`, `prompt_clients_unified.md`,
  `DEPLOY_EMAIL_SENDER_FIX.md`,
  `DOMAIN_DNS_INSTRUCTIONS.md`.

Don't delete — these are the audit trail of decisions and have
historical value.

### B2. Move

```bash
cd "/path/to/App Dev"
mkdir -p _archive
git mv IMPROVEMENTS_BATCH.md IMPROVEMENTS_BATCH_2.md \
       REFINEMENTS_BATCH_3.md REFINEMENTS_BATCH_4.md REFINEMENTS_BATCH_5.md \
       URGENT_FIXES_NOA_HOURS_BONUS.md QUICK_FIXES_NAME_HOURS.md \
       MOBILE_AND_PROFILE_FIX.md POST_IMPORT_FIXES.md ONE_TIME_CSV_IMPORT.md \
       SECURITY_FIX_AND_ROLES.md DOMAIN_SETUP.md DOMAIN_BLANK_FIX.md \
       VERCEL_BUILD_FIX.md DEPLOY_EMAIL_SENDER_FIX.md \
       DOMAIN_DNS_INSTRUCTIONS.md prompt_clients_unified.md \
       _archive/
git mv *_REPORT.md _archive/
# Reports — keep one structured pointer at root (next step).
```

(Adjust the list to match what's actually present at run time.)

### B3. Add `_archive/INDEX.md`

A short index listing each archived file with one line on what it was
for and when it was executed. Generated from the file frontmatter or
first heading.

### B4. Update active references

Update `BHR_CONSOLE_PROJECT.md`:

- Remove pointers to archived prompt files.
- Add a "Historical references" section that points at `_archive/`.
- Reflect the rebuilt hours module in the Pages section.
- Confirm the live URL is `https://app.banani-hr.com`.

Update `BHR_CONSOLE_CHECKLIST.md`:

- Replace the deprecated `https://bhr-console.vercel.app` URL in the
  preamble with `https://app.banani-hr.com`.
- Replace the §6 (Hours Log) checklist items with new ones reflecting
  the rebuilt module's spec from Phase A2.

Commit: `chore(repo): archive historical prompts; refresh active refs (Phase B)`.

---

## Phase C — Rewrite the employee mobile guide

The current file says how to add a bookmark to the home screen and
nothing else. Oren needs a complete onboarding doc — installation
PLUS what they'll see and do once installed.

### Target

Rewrite `EMPLOYEE_MOBILE_INSTALL_GUIDE.md` in Hebrew. Keep it short
but cover all of:

1. **Install (5 steps).** Safari → URL → Share → Add to Home Screen
   → open icon → log in once. Same steps as today.
2. **What you'll see after login.** Brief paragraph explaining the
   mobile app's scope: bottom tab bar with `שעות` + `פרופיל`, no
   admin pages, no clutter. An image-less ASCII sketch is fine.
3. **How to log time (the daily action).** 5 short steps:
   tap `+ דווח שעות` → search and pick client → set date and times
   → write description → save. Mention that Face ID will fill the
   password automatically next time.
4. **How to view past entries.** Filter by month/year and (optional)
   client. Tap an entry to edit. Tap the trash to delete.
5. **What happens offline.** Describe the offline queue: entries
   saved while offline sync automatically when the connection
   returns. The banner at the top of `/m/hours` shows pending
   entries.
6. **Tips** — same 5 short bullets the file has now (Safari only,
   Face ID, offline, password-saving, refresh on update).

Format: Hebrew, RTL, short bullet/numbered lines, ≤ 2 lines per
step. Add visual cues (▢↥, 🏠, 🕒, ⏱, ☁️) where helpful.

### Verification

The rewritten file must:

- Mention the actual mobile route (`/m/hours`).
- Describe the bottom tab bar.
- Cover the daily-use workflow, not just installation.
- Use `app.banani-hr.com` (current domain).

Commit: `docs(mobile): full employee onboarding guide — install + use + offline (Phase C)`.

---

## Termination

1. Write `REBUILD_REPORT.md`:
   - Phase A: per-scenario evidence (S1–S13). Include the deleted
     deprecated files list, the new file paths under
     `src/pages/hours/`, and the Vercel deployment ID for the rebuild.
   - Phase B: list of moved files + their `_archive/` destinations.
   - Phase C: full text of the new guide inline.
2. Print `REBUILD COMPLETE` and stop.
