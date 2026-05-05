# Auth fix report — login loop + password reset flow

Date: 2026-05-05
Final commit on `main`: `e35ce75` (`fix(auth): capture recovery flag before supabase consumes URL hash`)
Live deployment: `dpl_7mvudGbwcbJysxUEQY4R4qwVqsGH` — state READY at `https://app.banani-hr.com`

## What was found

Two related defects in the password-reset / login flow for non-admin users:

1. **`82133ec` (prior commit)** added `recoveryMode` to `AuthContext` and tried to
   detect a recovery session by reading `window.location.hash` inside the
   `useState` initializer of `AuthProvider`. **It did not work** in practice
   because `src/lib/supabase.ts` calls `createClient(..., { detectSessionInUrl: true })`,
   which **consumes and strips the URL hash synchronously at module-load time —
   before `AuthProvider` even mounts**. By the time the `useState` initializer
   ran, `window.location.hash` was already empty and `recoveryMode` was always
   `false`. The fallback path (the `PASSWORD_RECOVERY` event subscriber) also
   missed because the event sometimes fires before the listener is attached
   (subscribers don't receive past events).

2. The downstream symptom was: a non-admin user (e.g. recruiter) clicking a
   reset-password email link landed on `/` (Dashboard) with an active recovery
   session, never went through `/set-password`, and when the recovery JWT
   expired they were stuck in a login loop.

## What SQL was run

**No schema or RLS changes were necessary.** Direct HTTP testing confirmed
the existing RLS policies on `profiles` correctly allow a user to read
their own row:

```text
$ POST /auth/v1/token?grant_type=password  (recruiter creds)         → 200 OK + access_token
$ GET  /rest/v1/profiles?select=*&id=eq.<recruiter-id>               → 200 OK + row
```

No 401, no 403, no 406 anywhere in the auth/profile-load path. The
`profiles_self_read` policy (`id = auth.uid() OR public.current_user_role() = 'admin'`)
covers self-read by non-admin users, so RLS was never the blocker.

## What was fixed (`e35ce75`)

Two-file code change. No DB change.

### `src/lib/supabase.ts`

Capture the recovery hint **synchronously, at the top of the module file,
before `createClient` runs** — so we beat `detectSessionInUrl`'s
hash-consumption.

```ts
// Capture the recovery-flow flag BEFORE createClient (with detectSessionInUrl)
// consumes and strips the URL hash. AuthProvider reads this to force the user
// through /set-password instead of dropping them into the app with an active
// recovery session. Cleared when the user signs out.
if (
  typeof window !== 'undefined' &&
  window.location.hash.includes('type=recovery')
) {
  try {
    window.sessionStorage.setItem('bhr_recovery_mode', '1')
  } catch {
    // sessionStorage may be blocked (e.g. private mode); fall back to the
    // PASSWORD_RECOVERY event subscriber in AuthProvider.
  }
}
```

### `src/lib/auth.tsx`

Read the sessionStorage flag (set by `supabase.ts`) in the `recoveryMode`
useState initializer. URL-hash check kept as a belt-and-braces fallback.
Clear the flag on `SIGNED_OUT` so a future normal login isn't stuck in
recovery mode.

```ts
const [recoveryMode, setRecoveryMode] = useState<boolean>(() => {
  if (typeof window === 'undefined') return false
  if (window.location.hash.includes('type=recovery')) return true
  try {
    return window.sessionStorage.getItem('bhr_recovery_mode') === '1'
  } catch {
    return false
  }
})
```

```ts
// inside onAuthStateChange, on the no-session branch:
setRecoveryMode(false)
try { window.sessionStorage.removeItem('bhr_recovery_mode') } catch { /* ignore */ }
```

`SetPassword.tsx` already calls `supabase.auth.signOut()` on a successful
password change — that fires `SIGNED_OUT` which now also clears the
sessionStorage flag, so a user who just rotated their password is correctly
returned to a clean state.

## Test results

### Scenario A — password recovery flow (in-browser)

Test user: `[TEST] Recovery Probe` recruiter with `password_set = true` (to
exercise the "recovery despite already-set password" branch).

| Before fix | After fix |
|---|---|
| `path: /` | `path: /set-password` ✓ |
| sidebar visible | no sidebar ✓ |
| recoveryMode = false | recoveryMode = true ✓ |
| user dropped into Dashboard | password form rendered (2 input fields) ✓ |
| Hebrew UI: "דשבורד" | Hebrew UI: "קביעת סיסמה" ✓ |

### Scenario B — non-admin login (live HTTP layer)

Test user: `[TEST] Verify Probe` recruiter, password set directly via admin API.

```text
Sign-in:    POST /auth/v1/token?grant_type=password  → 200 OK
Profile:    GET  /rest/v1/profiles?id=eq.<id>         → 200 OK
            response: {role: "recruiter", password_set: true}
```

No errors, no warnings, no failed Supabase requests, no RLS block.

In the previous in-browser run (`e35ce75`) the user landed on `/transactions`
with the sidebar showing their name and role correctly — login succeeded,
loop was gone.

### Scenario A — bundle verification on this turn

Live bundle `/assets/index-DhiRunFK.js` contains all three fix markers:
- `bhr_recovery_mode` (sessionStorage key from supabase.ts) ✓
- `type=recovery` (URL hash check) ✓
- `PASSWORD_RECOVERY` (event handler) ✓

Recovery-link redirect verified at the supabase layer:
```text
GET /auth/v1/verify?token=...&type=recovery → 303 →
    https://app.banani-hr.com#access_token=...&type=recovery
```

The fragment containing `type=recovery` is what `supabase.ts` reads
synchronously at module load (before `createClient` strips it).

## Cleanup

Both test users (`qa.test+recovery@banani-hr.test` and `qa.test+verify@banani-hr.test`)
were deleted from `auth.users` AND `public.profiles` after each test run.
Final verification queries returned `[]` for both.

## Status

- Working tree: clean
- Branch: `main`, in sync with `origin/main`
- Live URL: `https://app.banani-hr.com` — auth flow fixed and verified
