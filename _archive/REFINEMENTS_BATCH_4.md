# Refinements batch 4 — UX fixes, hours-dialog flow, flexible billing reports, iPhone/PWA

Four focused refinements from Oren's review after batch 3 shipped. Execute in
order. Each phase ends with `npm run build` → commit → push → wait ~90s →
live verification in Chrome via the admin magic-link flow. Do not stop, do
not ask, do not summarize mid-run. Produce `REFINEMENTS_4_REPORT.md` when
finished.

## Read first

1. `BHR_CONSOLE_PROJECT.md` (spec — source of truth).
2. `BHR_CONSOLE_CHECKLIST.md`.
3. `SECURITY_FIX_AND_ROLES.md`.
4. `REFINEMENTS_BATCH_3.md` — the model this batch builds on.
5. This file.

## Hard rules

- English only for reasoning and commit messages.
- No deferrals. Live-verify on the production URL.
- Never print or commit secrets.
- Update `BHR_CONSOLE_PROJECT.md` in the same commit as any spec-affecting change.

---

## Phase A — Critical UX bugs (fix FIRST)

### A1. Hours page: client appears as a UUID, not a name

**Symptom (see Oren's screenshot):** the client picker at the top of `/hours`
displays `-45de-4030-a17c-bec9299552a7` (a UUID fragment) instead of the
client's `name`. Same bug likely exists on the "הוסף דיווח" dialog, in
`/billing-reports`, and anywhere else a client value is rendered.

**Likely cause:** the combobox's trigger renders the `value` (the id) instead
of the selected item's `label`. Common bug pattern: a `<Select>` whose
`<SelectValue placeholder={...} />` has no explicit render override while the
underlying items are keyed by `id`.

**Fix pattern:**
- Centralize: create a `ClientPicker` component that takes `value: string |
  null, onChange: (clientId: string | null) => void`. Internally it queries
  `clients` via React Query and renders the selected item's `name` in the
  trigger. Use it everywhere a client is selected (hours, transactions
  dialog, billing-reports filter, time-log permissions, wherever else).
- Audit the repo for any `.map(c => c.id)` in a Select context; replace with
  the `ClientPicker`.

**Live check:** on `/hours`, select a client → trigger shows the client name.
Same on the hours-entry dialog, the transactions dialog, and
`/billing-reports`.

### A2. Save hangs — "שומר..." never resolves

**Symptom:** on adding a new client and on an hours-log save, the button goes
to "שומר..." and never returns; dialog stays open; no error toast; no
error in the console (as reported).

**Diagnosis checklist — run each:**

1. Open Chrome DevTools Network tab. Reproduce the save. Is there a pending
   request to `/rest/v1/...` or `/rest/v1/rpc/...`?
   - If pending > 10s, the server is hanging. Likely RLS policy infinite
     recursion or a blocking query. Inspect policies on the target table.
   - If the request completes 200 but the UI doesn't update, the React
     Query mutation's `onSuccess` is never firing — likely a race in the
     component's local state machine.
2. Wrap every mutation with a 15-second timeout using `AbortController`. If
   the timeout fires, surface `שגיאה - פג זמן השמירה. נסה שנית.` and reset
   the dialog to editable.
3. Ensure every mutation's `onError` closes the saving state (set
   `saveStatus` back to `idle`), logs the error to console, and shows the
   red toast per the existing pattern.
4. Check for Supabase client double-initialization. The refactor in batch 0
   added `supabasePublic` with a distinct `storageKey`; if either client is
   reinstantiated per render (missing singleton), saves can hang on auth
   token refresh. Verify `supabase.ts` and `supabasePublic.ts` each call
   `createClient()` exactly once at module scope (grep).

**Fix pattern:**

- Introduce a `useSafeMutation` hook wrapping `useMutation`:
  - Enforces a 15-second `AbortSignal`.
  - On abort → show timeout toast + reset save state.
  - On error → red toast + reset save state + `console.error`.
  - On success → green toast + `queryClient.invalidateQueries` for the
    declared keys + close dialog after 2s.
- Migrate every save/update/delete in the app to `useSafeMutation`.

**Live check:** add a test client with minimal fields → save → toast +
row appears within 3s. Add an hours entry → save → toast + entry appears.
Simulate a failure (temporarily break a query with a bad column) → red
toast appears, dialog is still editable, no hang.

### A3. Dialog widths and overflow

**Symptom:** every dialog is narrow; text overlaps; the ✕ close button sits
behind the title; fields in 2-column grids collide on mid-width viewports.

**Fix pattern:**

- Global `<Dialog>` wrapper already used across the app (shadcn/ui). Set a
  consistent width scale:
  - Small dialogs (confirmations): `max-w-sm`.
  - Form dialogs (hours entry, profile edit, role edit, simple invites):
    `max-w-lg`.
  - Primary entity dialogs (client edit, transaction wizard, billing-report
    preview, service-type editor, import preview): `max-w-4xl`.
- RTL close-button positioning: the shadcn `DialogContent` places the close
  at `top-4 right-4`. In RTL layouts this collides with the Hebrew title.
  Override to `top-4 start-4` (or `left-4` when `dir="rtl"` is active) and
  add `z-50` so it always sits above content. The title's container must
  reserve padding on the appropriate side (`ps-12` when RTL) so long
  titles wrap instead of flowing under the close button.
- 2-column grids: use `grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4` so
  at narrow viewports the fields stack. Never allow fields to overlap —
  if a label is long, it wraps; labels always sit above their inputs.
- All text inputs: `w-full`. No fixed `width` classes on form fields.

**Live check:** open the transaction dialog, the client edit dialog, the
hours dialog, the profile page, the role-edit row dropdown. For each:
(1) the close ✕ is fully visible and clickable, not behind text,
(2) no two elements overlap at 1440×900 or at 1024×768,
(3) the dialog width matches the scale above.

### A4. Toggle clarity

**Symptom:** toggle buttons are unclear. In the screenshot, the "חיוב" switch
reads as "לא" but a checked state is ambiguous; the label "כן/לא" isn't
obviously tied to the switch's visual state.

**Fix pattern:**

- Replace bare `<Switch>` usage with `<LabeledToggle>`: a compound component
  showing
  `[ label ] [ off-text ] [ switch ] [ on-text ]`
  with the text adjacent to the track in both states. Example:
  - Billable toggle: `חיוב    [לא] ●──○ [לחיוב]`
  - Exclusivity toggle: `בלעדיות  [ללא בלעדיות] ●──○ [בלעדי]`
- The "on" side text is bold when the switch is on; the "off" side text is
  bold when off. Track color: purple-600 for on, zinc-400 for off.
- Increase track size from the shadcn default to `h-6 w-11` with a
  larger thumb, so it reads clearly on mobile too.

**Live check:** open the transaction dialog → the חיוב toggle now shows
"לא / לחיוב" text beside the switch, with the active side bold and the
track colored. Toggle it; the visual changes match. Same audit on the
client dialog's `exclusivity` toggle and on the `/team` card's
`hours_category_enabled` toggle.

Commit: `fix(ux): dialog widths, close button, toggles, save hang, client-id display (Phase A)`.

---

## Phase B — Hours-log workflow: pick the client inside the dialog

**Problem:** currently the user must pick a client from a dropdown at the TOP
of `/hours` before they can even click "הוסף דיווח". That forces a
context-switch before data entry. Oren wants: click "הוסף דיווח" first,
search/pick the client inside the dialog, enter the time.

**Target:**

- `/hours` no longer requires a pre-selected client to enable the "+"
  button. The top-of-page client picker stays (still useful for filtering
  the table below), but it's now optional — a "כל הלקוחות שלי" default
  shows all time entries for the current user across clients, grouped.
- "הוסף דיווח" opens a dialog whose FIRST field is the `ClientPicker`
  built in Phase A.1 — a searchable combobox that filters clients the user
  is permitted to log time against (admin sees all `time_log_enabled`
  clients; non-admin sees the intersection of permissions and
  `time_log_enabled`).
- Below the client picker, the rest of the existing form (date, start,
  end, description). Default date: today. Default start: 09:00. On save,
  the hours-log row is inserted with the picked client.

**Defaults:** if the table's top filter currently has a client selected,
pre-select that client in the dialog — but still allow changing it.

**Edge case:** if the user has no clients permitted for them, show an empty
state inside the dialog: `אין לקוחות מורשים לדיווח שעות. פנה למנהל.`
and disable save.

**Live check:** on an admin session, click "הוסף דיווח" without picking a
client first → dialog opens with the combobox; type a client name → list
filters; pick one → enter 09:00–12:00 "פגישה עם צוות" → save → row appears
in the table below, `client_id` matches the pick.

Commit: `feat(hours): client picker inside entry dialog (Phase B)`.

---

## Phase C — Flexible billing reports (any combination of filters)

**Problem:** `/billing-reports` currently forces client + period. Oren wants
every combination:
- period only → all charges across all clients in the period.
- client only → all charges for that client across all time, with statuses.
- both → the current behavior.
- (optional: neither → everything, guarded by a warning).

**Target:**

- Filter strip on `/billing-reports`:
  - `לקוח` — combobox with a "כל הלקוחות" sentinel option.
  - `מתאריך` / `עד תאריך` — both optional. If both blank, period is "all time".
  - `סטטוס חיוב` — filter by payment_status (optional): `הכל | ממתין | שולם | פיגור`.
  - `כולל חיוב שעות?` / `כולל שירותים?` — two toggles, both on by default.
  - `הצג חיובים` button.
- Results table renders whatever matches. Columns always include client
  name (so client-less reports are still comprehensible).
- "הפק דוח חיוב" on a result set:
  - If client is selected: single-client aggregated PDF as in batch 3.
  - If "כל הלקוחות": the PDF is a multi-client summary — one section per
    client, each with its items and subtotal, and a grand total at the end.
  - If neither client nor period is set AND `rows > 200`, show a modal
    warning: "אתה עומד להפיק דוח עם יותר מ-200 שורות. להמשיך?"
- The `billing_reports` row records every filter value so the report can be
  reproduced later.

**Schema addition:**

```sql
alter table billing_reports
  add column if not exists filter_client_id uuid references clients(id),
  add column if not exists filter_period_start date,
  add column if not exists filter_period_end date,
  add column if not exists filter_payment_status text,
  add column if not exists filter_include_service boolean not null default true,
  add column if not exists filter_include_time_period boolean not null default true;
```

(`client_id`, `period_start`, `period_end` on `billing_reports` continue to
store the actual scope of the data included; the new `filter_*` columns
record what the admin asked for.)

**Live check:**

- Client only (no period): pick BSH, both toggles on → report lists all
  transactions for BSH across all time, with payment_status shown. Issue
  PDF; it groups by year-month.
- Period only (no client): pick April 2026 → report lists every client's
  April 2026 billables. Issue PDF; it groups by client.
- Both: existing behavior unchanged.
- Neither: warning modal appears.
- As a recruiter test user: `/billing-reports` is forbidden (redirects) —
  confirm RLS on the table still blocks direct API reads.

Commit: `feat(billing): flexible billing-report filters across any combination (Phase C)`.

---

## Phase D — Mobile: PWA installable on iPhone home screen

**Goal:** ship a Progressive Web App that Oren and employees can "Add to Home
Screen" from iOS Safari, so time logging feels like an app and works
offline-tolerant-ish. This is NOT an App Store submission — that's Phase E,
explicitly optional.

### D1. PWA plumbing

- Use `vite-plugin-pwa` (well-supported, works with Vite + React).
- `manifest.json`:
  - `name: "BHR Console"`, `short_name: "BHR"`, `lang: "he"`, `dir: "rtl"`.
  - `theme_color: "#7c3aed"`, `background_color: "#f9f5ff"`.
  - `display: "standalone"`, `start_url: "/"`, `scope: "/"`.
  - Icons: generate 192×192 and 512×512 PNGs with a purple-on-cream "BHR"
    monogram (use the canvas-design skill or a one-shot SVG → PNG export).
    Save to `public/icons/`. Reference in the manifest as both `any` and
    `maskable`.
- Service worker: `vite-plugin-pwa`'s default `generateSW` strategy with
  - `cleanupOutdatedCaches: true`
  - `skipWaiting: true`, `clientsClaim: true`
  - Runtime caching for Supabase API: `NetworkFirst`, 24h fallback.
  - No caching for `/auth/*` paths.
- Add an "install BHR Console" button in the admin sidebar footer that
  appears when `window.beforeinstallprompt` has fired and the app isn't
  already installed; on click, calls `prompt()`.
- iOS-specific: add `<link rel="apple-touch-icon">` and
  `<meta name="apple-mobile-web-app-capable" content="yes">` in
  `index.html`. iOS Safari doesn't fire `beforeinstallprompt` — so ALSO
  render a small "להוספה למסך הבית: לחץ ‹שתף› → ‹הוסף למסך הבית›" hint
  at the bottom of `/login` when the user agent is iOS Safari and the app
  is not in standalone mode.

### D2. Mobile-optimized routes

The full admin app is overkill on a 390-wide screen. Build a mobile-first
path for the common employee workflows, reusing shared components:

- `/m` route group that renders a mobile-optimized shell:
  - Bottom nav bar with 3 tabs: `שעות`, `משרות` (my transactions),
    `פרופיל`.
  - No sidebar; header shows current user + logout.
- `/m/hours` — personal hours view:
  - Big "+ דווח שעות" button at the top (always reachable with thumb).
  - List of today's + this-week's entries. Tap to edit.
  - New-entry sheet slides up from the bottom, containing the
    `ClientPicker` + time fields from Phase B.
- `/m/transactions` — personal (RLS-scoped) transactions. Read-only list.
  Tap a row to see details.
- `/m/profile` — same as `/profile` but in mobile layout.
- Route detection: on first load, if `window.innerWidth < 640` AND the
  user's role isn't `admin`, redirect to `/m/hours`. Admins always default
  to desktop admin UI but can tap a "תצוגה ניידת" link in the sidebar to
  preview `/m`.

Responsive behavior across the rest of the app: ensure every dialog from
Phase A.3 uses `max-h-[90vh] overflow-y-auto` so it's scrollable on
mobile; pills and tables collapse gracefully.

### D3. Offline tolerance for hours entry

If the device loses network mid-save, the hours entry should queue locally
and retry:

- Use a small IndexedDB-backed queue (one library: `idb-keyval`).
- On save: optimistic local insert → push to server → on success remove
  from queue; on failure, leave in queue with a retry marker.
- A small banner at the top of `/m/hours`: `X דיווחים ממתינים לסנכרון` —
  tap to retry.

### D4. Biometric-friendly authentication (Face ID via Safari autofill)

Goal: one-tap login on subsequent visits. Face ID isn't a custom auth
integration — it's iOS Safari's password-autofill pathway, which already
uses Face ID to unlock saved credentials. We just need the form to be
machine-readable so Safari will offer to save and later autofill.

1. **Login form attributes.** On `/login`:
   - Email input: `type="email"` + `autocomplete="username"` +
     `inputMode="email"` + `spellCheck={false}` + `name="email"`.
   - Password input: `type="password"` +
     `autocomplete="current-password"` + `name="password"`.
   - The form itself: wrap inputs in `<form onSubmit={...}>` (not a bare
     `<button onClick>`), so iOS recognizes it as a credential form.
2. **Set-password form attributes.** On `/set-password`:
   - Password input: `autocomplete="new-password"`.
   - Include a hidden or disabled email input alongside the password
     input with `autocomplete="username"` set to the known email —
     required for Safari to associate the new password with the account
     when it saves.
3. **Long-lived sessions.** Confirm the Supabase client config in
   `src/lib/supabase.ts` has `autoRefreshToken: true` and
   `persistSession: true` (both are defaults). Set the Supabase project's
   refresh-token reuse interval to 10 seconds (default is 10; just verify)
   via the Management API:
   ```bash
   curl -sS -X PATCH \
     "https://api.supabase.com/v1/projects/szunbwkmldepkwpxojma/config/auth" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"jwt_exp": 3600, "refresh_token_rotation_enabled": true}'
   ```
   Effect: an actively-used app refreshes silently; active employees
   almost never see the login screen.
4. **"זכור אותי" default.** Default to checked on `/login` (hidden /
   pre-checked). Supabase already persists the session in localStorage
   regardless; this is a visual reassurance.
5. **Logout UX.** In `/m/profile`, show the device's install status and a
   big "התנתק מהמכשיר" button. Make it clear that tapping it will
   require email + Face-ID-autofilled password on next visit.

**Live check (must be run on a real iPhone or iOS Simulator, not desktop
DevTools device mode — desktop can't exercise Face ID / Keychain):**

- First login: enter email + password. iOS prompts "Save this password
  for app.banani-hr.com?" → Save.
- Sign out.
- Return to `/login` → tap the password field → iOS offers "Use Face ID
  to fill password" → Face ID prompt → password autofills → submit →
  logged in. Time from tap to dashboard: under 3 seconds.

If running live verification on desktop Chrome only, code-verify the
attribute presence with a DOM query and note in the report that Face-ID
behavior must be validated manually on Oren's iPhone.

### D5. Passkeys (NOT in this batch — future option)

Passkeys would make the login UX fully passwordless: tap "Sign in" →
Face ID → done. Supabase Auth doesn't support passkeys as a primary
factor today, so this requires a custom WebAuthn edge-function pathway.
Defer; add a one-line item to `BHR_CONSOLE_PROJECT.md` under "Future
work" so it isn't forgotten.

### Live checks

- Open https://bhr-console.vercel.app on a mobile user agent (Chrome
  DevTools Device Mode, iPhone 14 Pro). Manifest + icons load; Lighthouse
  PWA audit passes all mandatory criteria.
- Add to Home Screen (simulated). Launch from home screen → app opens in
  standalone mode (no address bar).
- Navigate to `/m/hours` as a seeded recruiter user → bottom nav visible,
  big "+ דווח שעות" accessible. Add an entry → saves.
- DevTools → Network → Offline → add an entry → banner shows 1 pending;
  turn network back on → entry syncs; banner clears.

Commit: `feat(mobile): PWA install + /m mobile routes + offline hours queue (Phase D)`.

---

## Checklist extensions

Extend `BHR_CONSOLE_CHECKLIST.md`:

- §30 UX bug fixes (client name display, save-hang, dialog widths, close
  button, toggles) with the Phase A live checks.
- §31 Hours dialog client picker in-dialog.
- §32 Flexible billing-report filters (client-only, period-only, both,
  warning on neither).
- §33 PWA installable on iOS; `/m` routes functional; offline queue works.

## Termination

1. Update `BHR_CONSOLE_PROJECT.md`:
   - New `ClientPicker` shared component.
   - `useSafeMutation` pattern and the 15s timeout contract.
   - Dialog width scale and RTL close-button rule.
   - `LabeledToggle` component.
   - `/billing-reports` filter semantics (including the warning threshold).
   - PWA section: manifest, icons, scope, `/m` route group, iOS install
     instructions.
2. Write `REFINEMENTS_4_REPORT.md`:
   - Per-phase commit SHAs.
   - Screenshots saved to `./qa-screenshots/batch4/`:
     - Old vs. new transaction/client/hours dialogs (width + toggles).
     - Hours-entry dialog with client combobox open.
     - `/billing-reports` with client-only filter; with period-only filter.
     - Mobile `/m/hours` at iPhone 14 Pro viewport.
     - PWA manifest audit passing in Lighthouse.
3. Print `REFINEMENTS BATCH 4 COMPLETE` and stop.
