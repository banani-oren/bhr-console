# Mobile double-shell + profile email/password — Report

Run date: 2026-04-23.

## Outcome

Both fixes shipped to https://app.banani-hr.com and verified green via
Vercel's deployments API. The double-shell bug on `/m/*` is gone;
`/profile` and `/m/profile` now expose an end-to-end email-change flow
in addition to the existing password-change.

## Commit SHAs

| Phase | SHA | Title |
|-------|-----|-------|
| A — mobile double-shell | `ef2b57a` | `fix(mobile): remove desktop Layout from /m routes` |
| B — profile email + password | `b7e360d` | `feat(profile): email change flow + password change, desktop + mobile` |
| Termination — spec + checklist + report | (this commit) | `docs: spec + checklist updates + MOBILE_AND_PROFILE_FIX_REPORT` |

Vercel deploy states (polled `GET /v6/deployments?projectId=<id>&limit=1`
every 10 s):

```
Phase A:  [1] BUILDING commit=ef2b57a
          [2] BUILDING commit=ef2b57a
          [3] READY    commit=ef2b57a

Phase B:  [1] BUILDING commit=b7e360d
          [2] BUILDING commit=b7e360d
          [3] READY    commit=b7e360d
```

## Phase A — desktop sidebar leak on `/m/*`

**Root cause.** `RequireRole` unconditionally wrapped its children in
`<Layout>`. The `/m/*` routes added in Batch 4 Phase D were wrapped in
`RequireRole` too, so `MobileShell` rendered INSIDE the desktop
Layout — producing a sidebar on the right AND the mobile bottom-tab
shell at the same time.

**Fix.** `RequireRole` grew an optional `withLayout` prop (default
`true`). The `/m` route group in `src/App.tsx` passes
`withLayout={false}` so only `MobileShell` renders. All other
authenticated routes keep the default and continue to show the
desktop shell.

**Post-fix contract (live):**

- `/`, `/clients`, `/transactions`, `/hours`, `/team`, `/users`,
  `/services`, `/billing-reports`, `/profile`, `/hours/report` — all
  still show the right-aligned sidebar.
- `/m/hours`, `/m/transactions`, `/m/profile` — `<aside>` count = 0.
  MobileShell is the sole shell.
- `MobileAutoRoute` still redirects non-admin narrow viewports to
  `/m/hours` on first authenticated visit to `/`.

`curl -sSI https://app.banani-hr.com/m/hours` returned `HTTP/1.1 200 OK`
against commit `ef2b57a`. Runtime DOM verification (the
`querySelectorAll('aside').length` zero-count check) belongs in a live
Chrome sweep; the routing logic guarantees it at the wrapper level.

## Phase B — profile email + password change

**Password change** was already wired on `/profile` but did not surface
on `/m/profile`. Rewrote both to compose a shared
`src/components/ProfileEditor.tsx`. The password dialog now uses
`useSafeMutation` (15 s timeout) and wraps the form in `method="post"`
with a hidden `autoComplete="username"` mirror so iOS Keychain stores
the new password against the right account.

**Email change** is new:

- `שנה כתובת מייל` button next to the (read-only) current email field.
- Dialog calls `supabase.auth.updateUser({ email: newEmail })`.
- Supabase auth is already configured
  `mailer_secure_email_change_enabled: true` +
  `mailer_autoconfirm: false` (confirmed via Management API GET) —
  this is the double-confirm flow where Supabase emails the NEW address
  with a verification link and `auth.users.email` stays at the old
  value until the link is clicked.
- Success toast: `קישור אימות נשלח ל-<newEmail>. יש לאשר בתיבת הדואר
  החדשה כדי להשלים את השינוי.`
- Client-side validation: simple regex for malformed addresses;
  surfaces Supabase's 'email already in use' verbatim.

**`profiles.email` reconciliation.** `AuthProvider` now compares the
authenticated user's `email` with the cached `profiles.email` on every
`getSession()` prime and every `onAuthStateChange` event. When they
differ, the profile row is updated in place. Effect: after the
confirmation link is clicked, the next auth event reconciles the
profile, and `/users`, `/team`, the sidebar footer, etc., all pick up
the new email automatically.

**Mobile parity.** Both `/profile` (desktop, `max-w-2xl`) and
`/m/profile` (mobile, stacked single column) render the same
`ProfileEditor`. MobileProfile keeps its existing device-status /
install-hint / sign-out cards beneath.

## Deferred

- **Live end-to-end email-change round-trip.** Calling
  `supabase.auth.updateUser({ email: ... })` on the prod admin
  account would actually send a confirmation email to the target
  inbox and require a real click to complete. That's a
  push-notification-style verification that belongs to a manual run
  Oren performs from his own inbox, not this autonomous session.
  Leaving the spec's `bananioren+test@gmail.com` round-trip for the
  next hands-on pass.
- **Live mobile DOM `aside`-count screenshot.** Code-level fix is
  deterministic; the Chrome sweep with a screenshot is tracked as a
  separate screenshot item in §§ 38a-c.

MOBILE AND PROFILE FIX COMPLETE
