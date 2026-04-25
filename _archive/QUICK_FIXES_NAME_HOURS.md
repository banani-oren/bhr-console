# Quick fixes — admin user editing, hours combobox, mobile guide refresh

Three independent fixes. Execute in order. Per `CLAUDE_CODE_AUTONOMOUS.md`,
poll Vercel for `state=READY` after each push. Treat real data as
read-only — test data must be tagged `[TEST-...]` and cleaned up.
Produce `QUICK_FIXES_REPORT.md`.

## Read first

1. `BHR_CONSOLE_PROJECT.md`
2. `BHR_CONSOLE_CHECKLIST.md`
3. `URGENT_FIXES_NOA_HOURS_BONUS.md` — the bonus admin view that just
   shipped; this prompt extends, not regresses, what's there.
4. `EMPLOYEE_MOBILE_INSTALL_GUIDE.md` — gets refreshed in Phase C.

## Hard rules

- English only for commits. No secrets in output.
- Read-only on real rows; tagged `[TEST-…]` records only for CRUD.
- Evidence rule remains: every claimed fix needs scenario evidence,
  not "looks correct."

---

## Phase A — Admin can edit user name and email from `/users` and `/team`

**Goal:** as admin, click any user (in `/users` table or on a `/team`
card), open an edit dialog that allows changing `full_name` AND `email`,
plus the existing fields. Today only role/bonus_model/hours_category
are editable from admin views.

### A1. Backend — admin email change

Self-service email change (already shipped) uses `supabase.auth.updateUser({ email })`,
which sends a verification email. Admin-changing-someone-else uses a
different API: `supabase.auth.admin.updateUserById(userId, { email })`,
which updates immediately and does NOT require verification. This is
the correct flow because the admin has authority.

Wrap this in a small edge function `admin-update-user` so the service
role key isn't exposed to the browser:

- POST `{ user_id, full_name?, email?, role? }`
- Authorize: caller must be authenticated AND their `profiles.role` is
  `admin`. Reject with 403 otherwise.
- For each provided field:
  - `full_name`: update `profiles.full_name`.
  - `email`: call `auth.admin.updateUserById(userId, { email })`,
    then update `profiles.email` to keep them synced.
  - `role`: update `profiles.role` (already wired via the inline
    role dropdown — accept it here too for convenience).
- Return `{ success: true, updated_fields: [...] }`.
- Deploy and verify the function endpoint responds.

### A2. `/users` UI

Replace the inline role dropdown's "edit" affordance with a full edit
dialog. On each row:

- Column "פעולות" (or whatever it's called now) gets a pencil icon.
- Click → dialog opens pre-filled with: `שם`, `אימייל`, `תפקיד`.
- All three editable. Cancel/Save buttons. Save calls
  `admin-update-user` via `useSafeMutation`.
- Self-edit guard: editing your own row through this admin path is
  allowed but the role dropdown is disabled (matches the existing
  self-demote prevention rule). Email/name are fine.
- Email-already-in-use / invalid-format errors are surfaced as red
  toasts.
- Inline role dropdown stays — it's a quick-change shortcut. The new
  dialog is for fuller edits.

### A3. `/team` UI

Each employee card gets an additional menu / button: `ערוך פרטים`
(separate from the existing "configure bonus" / "toggle category"
controls).

- Click → opens the SAME dialog as `/users` (extract it as
  `<UserEditDialog user={...}>` so both pages share one component).
- Saving here also updates `/team`'s React Query cache.

### A4. Live verification scenarios

Tag a test user `[TEST-AAA] qa.test+admedit@banani-hr.test`,
`name = '[TEST] Admin Edit Probe'`, role `recruiter`. Then:

1. From `/users`, click pencil on this user's row → edit dialog opens
   pre-filled. Change name to `[TEST] Renamed`. Save → toast appears
   within 3s, table refreshes, name updated. Confirm via service-role
   query: `profiles.full_name` matches.
2. Open the dialog again. Change email to
   `qa.test+admedit2@banani-hr.test`. Save → both `auth.users.email`
   AND `profiles.email` match the new value. Service-role query
   confirms.
3. Try setting email to an existing email
   (`bananioren@gmail.com`) → red toast `הכתובת תפוסה`. Original
   value still in DB.
4. Navigate to `/team` (this user has role recruiter so they appear).
   Click "ערוך פרטים" on their card → SAME dialog opens (same component,
   same fields). Change name back to `[TEST] Admin Edit Probe`. Save.
5. Open Oren's own row in `/users`. Edit dialog opens; role dropdown is
   disabled; name and email inputs are enabled.
6. Cleanup: delete the test user.

Commit: `feat(admin): edit user name+email from /users + /team via shared dialog (Phase A)`.

---

## Phase B — Hours client picker: real combobox in both tabs

**Symptom (verified by Oren):**
- `השעות שלי` tab: client field shows the previously-selected value with
  no obvious path to switch.
- `ניהול שעות` tab: similar — `קסטרו` is stuck with no way to type-
  search a different client. (The X to clear is there, but after
  clearing there's no live searchable input.)

### B1. Required behavior — both tabs

The client filter is `<ClientCombobox>` in EVERY state, including
after a value is selected:

- **Empty state:** placeholder `חיפוש לקוח...` visible, focus opens
  the search dropdown.
- **Selected state:** the value is shown as a chip / pill in the input
  with an `×` to clear AND clicking elsewhere in the input area opens
  the search dropdown again so the user can pick a DIFFERENT client
  without first clearing. Selecting a new client REPLACES the old
  one.
- **Tab-specific filters:**
  - `השעות שלי`: only clients where the current user is in
    `client_time_log_permissions` AND `time_log_enabled = true`.
  - `ניהול שעות`: all clients with `time_log_enabled = true` (admin's
    view).

### B2. Implementation

Reuse `<ClientCombobox>` (the shared component from batch 5 D1). Two
likely root causes for the current broken behavior:

1. The combobox is rendered inside a controlled-by-tab layout that
   re-mounts it on every selection, leaving it in a "selected, no
   way to interact" state.
2. The component supports search-and-select but not "click while
   selected to re-open the dropdown." Common React combobox bug.

Fix:

- Make `<ClientCombobox>` always render the search input even when a
  value is selected. The selected value renders inside the input area
  as a chip; clicking anywhere on the input focuses the search and
  opens the dropdown.
- Hitting Escape in the dropdown closes it WITHOUT clearing.
- The `onChange(null)` path (clear via ×) leaves the dropdown closed
  and the input empty, ready for typing.

Add a `clearable={true}` prop default so callers don't have to opt in.

### B3. Live verification scenarios

For each scenario, document keystrokes and observed states.

1. As Oren on `/hours` → `השעות שלי`. Type `שיב` in the client field.
   Dropdown shows `שיבומי...`. Select. Table updates to that client's
   rows. Click the input again. Dropdown re-opens with all eligible
   clients listed and the current one marked. Type `קס`. Dropdown
   filters. Select `קסטרו...`. Table updates. Click ×. Field clears.
   Table shows ALL my hours for the period.
2. As Oren on `/hours` → `ניהול שעות`. Same scenario across the
   admin's broader client set.
3. Mobile `/m/hours` (if it has a client picker): same scenario at
   390×844 viewport. Combobox usable with thumb.
4. Add-entry dialog client picker: opens empty (no pre-selection),
   type-search picks a client, save inserts the row with the right
   `client_id`.

Commit: `fix(hours): client combobox swappable in both tabs without clear-first (Phase B)`.

---

## Phase C — Refresh mobile install guide

`EMPLOYEE_MOBILE_INSTALL_GUIDE.md` is too text-heavy. Oren wants
"simple step by step with minimal text."

### Target

Same file path. Replace contents with a stripped-down version:

- 5 numbered steps maximum.
- Each step ≤ 2 lines of Hebrew text.
- Heavy use of unicode UI cues (▢ Share icon, 🏠 Home Screen) where
  helpful.
- Domain in the URL is `app.banani-hr.com` (not the old vercel.app).
- No FAQ — keep it as a one-pager.
- Add a "טיפים" section with 3–5 short bullets at the end (e.g.,
  "השתמש ב-Safari, לא Chrome", "Face ID יעבוד אחרי הכניסה הראשונה").
- The sequence: open Safari → URL → share → add to home screen →
  open icon → log in once.

### Don't break the existing in-app reference

If any in-app text or page links to specific section anchors of the
old guide, update those links too. Otherwise, just rewrite the file
in place.

Commit: `docs(mobile): tighter step-by-step install guide (Phase C)`.

---

## Phase D — Cleanup verification

Same as prior batches:

```bash
# Tagged residue should be zero:
curl -sS "$VITE_SUPABASE_URL/rest/v1/profiles?email=ilike.qa.test+admedit%25" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" | jq 'length'  # must be 0
```

Real-data integrity: row counts before/after must match for
`transactions`, `clients`, `hours_log`, and any non-test `profiles`.

## Termination

1. Write `QUICK_FIXES_REPORT.md`:
   - Per-phase commit SHAs and Vercel deployment IDs.
   - Phase A scenario outcomes (1–6) with the test user's auth ID
     and the timestamps of email-change confirmations.
   - Phase B scenario outcomes (1–4) with the keystroke sequences
     and observed table-refresh behavior.
   - Phase C: a copy of the new guide content (so it's auditable
     in the report itself).
   - Phase D cleanup confirmation counts.
2. Print `QUICK FIXES COMPLETE` and stop.
