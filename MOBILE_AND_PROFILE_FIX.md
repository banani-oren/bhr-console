# Fix: mobile sidebar leak + profile email/password change

Two tightly-scoped fixes. Execute end-to-end — do not stop, do not ask,
do not summarize mid-run. Produce `MOBILE_AND_PROFILE_FIX_REPORT.md`.

## Read first

1. `BHR_CONSOLE_PROJECT.md`.
2. `REFINEMENTS_BATCH_4.md` — Phase D built the mobile shell.
3. `IMPROVEMENTS_BATCH.md` — Feature 1 (profile page) was the original
   spec. Email change was deferred; this task lands it.
4. This file.

## Hard rules

- English only for commit messages.
- Live-verify on both desktop and mobile emulator (and, for the PWA bits,
  confirm via `/m/hours` and `/profile`).
- Deploy verification — per the new rule in `CLAUDE_CODE_AUTONOMOUS.md`,
  poll Vercel's API until `state=READY` before declaring done.
- Never print or commit secrets.

---

## Phase A — Kill the desktop sidebar on mobile routes

**Symptom:** visiting `https://app.banani-hr.com/m/hours` on a mobile
viewport renders two shells simultaneously — the mobile `/m` shell (bottom
tab bar, header) AND the admin Layout (right-aligned sidebar with
דשבורד/לקוחות/עסקאות/...). They overlap.

**Root cause hypothesis:** the admin `<Layout>` component wraps every
protected route in `src/App.tsx`, including the `/m/*` routes that were
added in batch 4. The mobile shell is rendered INSIDE the admin Layout,
so both sidebars show.

**Fix:**

1. Read `src/App.tsx` and identify where the `/m/*` routes are defined.
2. Move them out from under `<Layout>`. Two clean patterns; pick whichever
   fits the existing structure:
   - **Option A (preferred):** separate `<Routes>` blocks.
     ```tsx
     <Routes>
       {/* mobile shell — NO admin Layout */}
       <Route path="/m/*" element={<MobileLayout />}>
         <Route index element={<Navigate to="hours" />} />
         <Route path="hours" element={<MobileHours />} />
         <Route path="transactions" element={<MobileTransactions />} />
         <Route path="profile" element={<MobileProfile />} />
       </Route>

       {/* desktop shell — with admin Layout */}
       <Route element={<Layout />}>
         <Route path="/" element={<RequireRole ...><Dashboard /></RequireRole>} />
         {/* ...the rest of the admin routes... */}
       </Route>
     </Routes>
     ```
   - **Option B:** inside `<Layout>`, detect `location.pathname.startsWith('/m')`
     and render `{children}` without the sidebar. Uglier but smaller diff.
3. Make sure `RequireRole` still wraps the mobile routes (auth is still
   required). `MobileLayout` should render `<Outlet />` with the bottom tab
   bar and the mobile header — nothing from the desktop sidebar.
4. Remove any CSS / class that forces the desktop sidebar to render. Ensure
   on `/m/*` the DOM contains zero `<aside>` elements from the admin Layout.

**Auto-redirect:** on first load at `/`, if `window.innerWidth < 640` AND
the user's role isn't `admin`, redirect to `/m/hours` (per batch 4 Phase
D2). Admins still default to desktop so they can manage. Make sure this
redirect logic fires once, not on every render.

**Live checks:**

- At 1440×900 desktop viewport: `/` loads with the sidebar on the RIGHT.
  `/m/hours` is reachable via a direct URL but admins get a "תצוגה ניידת"
  link in the sidebar footer (per batch 4).
- At iPhone 14 Pro viewport (390×844):
  - `/m/hours` renders the mobile shell only — no admin sidebar.
  - `document.querySelectorAll('aside').length` returns 0 at `/m/hours`.
  - Bottom tab bar visible and functional: שעות / משרות / פרופיל.
  - The big "+ דווח שעות" button is accessible with thumb reach.
  - The screen isn't split 50/50 with a dark sidebar on either side.
- As a seeded recruiter test user on mobile: automatically lands at
  `/m/hours` on first visit to `/`.

Commit: `fix(mobile): remove desktop Layout from /m routes (Phase A)`.

---

## Phase B — Profile: change email, change password, plus a working `/profile` on mobile

**Problem 1:** Oren needs to change his own email. Currently the
`/profile` page doesn't expose that.
**Problem 2:** Password change may exist but isn't obvious / reachable
on mobile.
**Problem 3:** `/m/profile` needs parity with `/profile` for the editable
fields.

### B1. Inventory what already exists

Read `src/pages/Profile.tsx` (or wherever the profile page lives). List
what's editable today: `full_name`? `phone`? `bonus_model`? The earlier
spec (batch 1 Feature 1) said `full_name` + `phone` + password change.
Confirm presence.

### B2. Password change — make sure it works

If "שנה סיסמה" button isn't present or not wired:

- Add a button on the profile page labeled **"שנה סיסמה"**.
- On click, open a dialog with:
  - `current_password` input (for confirmation — optional, Supabase
    `updateUser` doesn't require it, but UX-wise it's a confirmation).
  - `new_password` input, `autocomplete="new-password"`, min 8 chars.
  - `confirm_new_password` input, must match.
- On save: `supabase.auth.updateUser({ password: newPassword })`.
- Success: green toast `הסיסמה עודכנה ✓`. Close dialog. Fire a subtle
  hint that next login will need the new password.
- Failure: red toast with the error.

Use the `useSafeMutation` wrapper (from batch 4 Phase A2) so a hung call
times out at 15s.

### B3. Email change — new capability

Supabase's email change flow:

1. Call `supabase.auth.updateUser({ email: newEmail })`.
2. Supabase sends a confirmation link to the NEW email address.
3. Until the user clicks that link, the auth row shows
   `email_change: newEmail` but `email` is still the old value.
4. After confirmation, `email` becomes `newEmail`.

UI:

- Add a button **"שנה כתובת מייל"** on the profile page (below the name /
  phone block, above the password section).
- On click, open a dialog:
  - Shows current email as read-only.
  - `new_email` input, `autocomplete="email"` `inputMode="email"`.
  - Short explanatory text: `נשלח קישור אימות לכתובת החדשה. שינוי המייל
    יושלם לאחר אימות.`
- On save:
  - Call `supabase.auth.updateUser({ email: newEmail })`.
  - Success: green toast `קישור אימות נשלח ל-<newEmail>. יש לאשר בתיבת
    הדואר החדשה כדי להשלים את השינוי.`
  - Also update `profiles.email` via service role from the edge
    function **only after** the auth user's `email` updates — this
    happens via a Supabase Auth webhook or via a one-shot re-sync on
    next login (see "Sync" below).
- Failure modes:
  - Email already in use: `הכתובת תפוסה. בחר כתובת אחרת.`
  - Invalid format: standard HTML5 validation.

**Supabase Auth email-change configuration:** confirm the project has
`Confirm email change` enabled and the `Change Email` template's
redirect URL is set to `https://app.banani-hr.com/auth/confirm-email`
(or wherever the post-confirmation landing is). Patch via Management API
if needed.

**Sync `profiles.email` to `auth.users.email`:** two options —

- **Preferred:** on every login, if
  `auth.user().email !== profile.email`, update the profile row.
  Small logic in `AuthProvider`.
- **Belt-and-suspenders:** a nightly edge function that reconciles via
  the Admin API. Skip for now.

### B4. `/m/profile` parity

`/m/profile` (the mobile route) should render the same editable
fields — name, phone, email-change action, password-change action,
logout — in a stacked single-column layout. No shared code gymnastics;
a small dedicated mobile component is fine.

### Live checks

- On `/profile` (desktop): see current email (read-only), phone,
  name. "שנה כתובת מייל" and "שנה סיסמה" buttons visible.
- Click "שנה סיסמה" → dialog opens → enter a new password → save →
  toast → sign out → sign back in with the new password.
- Click "שנה כתובת מייל" → enter `bananioren+test@gmail.com` →
  save → toast `נשלח קישור אימות...` → check the +test inbox via
  Gmail filtering → click the link → confirmation page renders →
  `auth.users.email` is updated → next login with the new email
  works. Then change it back to `bananioren@gmail.com` (same flow)
  to leave things clean.
- At mobile viewport on `/m/profile`: both actions visible and
  tappable; text isn't cramped.

Commit: `feat(profile): email change flow + password change, desktop + mobile (Phase B)`.

---

## Checklist extensions

Extend `BHR_CONSOLE_CHECKLIST.md`:

- §35 Mobile layout hygiene: `/m/*` contains zero admin sidebars; bottom
  tab bar visible; no double-shell.
- §36 Profile password change works end-to-end on both desktop and mobile.
- §37 Profile email change flow: dialog, verification email sent, link
  confirms, DB reflects new email, login works with new email.

## Termination

1. Update `BHR_CONSOLE_PROJECT.md`:
   - Route layout model (two `<Routes>` blocks, or the pattern you used).
   - Profile-page capabilities (email + password change flows).
   - Email-change reconciliation: where `profiles.email` gets updated.
2. Write `MOBILE_AND_PROFILE_FIX_REPORT.md`:
   - Commit SHAs for A + B.
   - Before/after screenshots of `/m/hours` (the double-shell bug
     should be gone).
   - Confirmation the email + password changes round-tripped live.
3. Print `MOBILE AND PROFILE FIX COMPLETE` and stop.
