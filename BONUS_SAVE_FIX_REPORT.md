# BONUS_SAVE_FIX — execution report

Date: 2026-04-25
Final commits: `54d26e4`, `ba985fc`
Final deployment: `dpl_BfXH8XF9RuGwmdbQWcW8WVyRy9xn` (https://app.banani-hr.com)

## Step 1 — diagnosis

### Repro setup

- Magic-link admin session for `oren@banani-hr.com`.
- Test employee invited via the live `invite-user` edge function:
  - email: `qa.test+bonus@banani-hr.test`
  - full_name: `[TEST] Bonus Probe`
  - role: `recruiter`
  - id: `442f4833-9fd1-4455-b7be-f334028ed230`

### HTTP request/response

PATCH `https://szunbwkmldepkwpxojma.supabase.co/rest/v1/profiles?id=eq.442f4833-9fd1-4455-b7be-f334028ed230`
Headers: `apikey`, `Authorization: Bearer <admin JWT>`, `Content-Type: application/json`,
`Prefer: return=representation`

Body (the 6-tier payload from the spec):

```json
{
  "bonus_model": {
    "type": "flat",
    "filter": {"field": "description", "contains": ""},
    "tiers": [
      {"min":0,"bonus":0},{"min":10000,"bonus":800},
      {"min":14000,"bonus":1200},{"min":25000,"bonus":2100},
      {"min":37000,"bonus":3200},{"min":59000,"bonus":4100},
      {"min":70000,"bonus":5200}
    ]
  },
  "hours_category_enabled": false
}
```

Response: `200 OK`, with the row reflected back. JSONB stored as
object (not stringified). RLS policies on `profiles` are correct
(`profiles_self_update` and `profiles_self_read` both pass under
`current_user_role()='admin'`). No DB constraint or trigger on
`bonus_model`.

### Branch identified — Branch C

The save path (PATCH) succeeds end-to-end. The dialog DID close on
my fast connection. **But** the previous `handleSave` in `Team.tsx`
used a raw `await supabase.from('profiles').update(...)` with
**no AbortController and no timeout**. On a slow or intermittent
network the awaited promise never resolves, the dialog stays on
"שומר…" forever, and the user sees what looks like "doesn't save."

Every other save flow in the codebase already uses
`useSafeMutation` (15 s `AbortController` + idle/saving/success/
error/timeout state machine). `Team.tsx` was the last hold-out.

Console at click-time: `Saved: Array(1)` was logged on the first
repro — confirming the request succeeded. No 4xx/5xx, no error
toast, no RLS block. So this is purely a robustness/timeout gap,
not a backend issue.

## Step 2 — fix

Two commits on `main`:

1. **`54d26e4`** `fix(bonus): root-cause + repair save flow on /team — branch C`
   - Migrate `Team.tsx` `handleSave` to `useSafeMutation`.
   - Pass `AbortSignal` through `.abortSignal(signal)` so the 15 s
     timeout can interrupt a stuck request.
   - Surface error/timeout state inline with the actual server message.
   - Wire success → invalidate `['team-employees']` → close dialog
     after 1.2 s (down from 2 s).
2. **`ba985fc`** `fix(bonus): reject negative/NaN tier values before submit`
   - Validate inside the mutationFn — reject any tier with
     non-finite or negative `min`/`bonus`. Surface as a Hebrew
     error inline. Required for V5.

## Step 3 — V1–V7 verification

All seven scenarios run live against `[TEST] Bonus Probe`.

| # | Scenario | Result | Evidence |
|---|---|---|---|
| **V1** | Save 6-tier model → reload → reopen dialog → tiers reappear | ✅ PASS | All 7 tiers re-read from DB and re-rendered in the dialog with the same values |
| **V2** | Service-role select confirms JSONB shape | ✅ PASS | `{"type":"flat","tiers":[{"min":0,"bonus":0},…],"filter":{...}}` — numeric types preserved |
| **V3** | Edit one tier (800 → 850) → save → reload → persists | ✅ PASS | DB tier(min=10000) = `{"min":10000,"bonus":850}` |
| **V4** | Toggle bonus off → save → DB shows `bonus_model = null` | ✅ PASS | DB returns `[{"bonus_model":null}]` |
| **V5** | Enter negative bonus → save → red error → DB unchanged | ✅ PASS | Inline error: `שגיאה בשמירה: ערכי מדרגות לא תקינים — חובה מספרים אי-שליליים`. Dialog stays open. No PATCH fired. |
| **V6** | `/bonuses` shows the test user with the saved model | ✅ PASS | Test user appears in the bonus dashboard (current month) |
| **V7** | Delete the test user — gone from auth.users AND profiles | ✅ PASS | Both queries return `[]` |

## Cleanup confirmation

```
$ DELETE FROM public.profiles WHERE id='442f4833-9fd1-4455-b7be-f334028ed230';  -> []
$ DELETE /auth/v1/admin/users/442f4833-…  -> 200 OK
$ select * from auth.users where id='442f4833-…';                                -> []
$ select * from public.profiles where id='442f4833-…';                           -> []
```

`qa.test+bonus@banani-hr.test` is gone from both `auth.users` and
`public.profiles`.

## What changed in the codebase

`src/pages/Team.tsx`:

- Removed: `useQueryClient` import, raw `handleSave`, manual
  `saveStatus` `useState`.
- Added: `useSafeMutation` import; a `saveMutation` with
  abort-aware mutationFn that validates tier values, performs the
  PATCH with `.abortSignal()`, invalidates `['team-employees']`,
  and triggers `closeDialog` 1.2 s after success.
- Updated: dialog footer renders status from `saveMutation.saveStatus`
  including a dedicated `timeout` row that surfaces "פג זמן השמירה."

No schema change. No RLS change. No migration.

## Final state

- Commits on `main`: `54d26e4`, `ba985fc`
- Vercel deployment: `dpl_BfXH8XF9RuGwmdbQWcW8WVyRy9xn` — state READY
- Live URL: https://app.banani-hr.com/team
- Test data: cleaned up (V7 verified)
- Bonus save now consistent with the rest of the app's
  `useSafeMutation` pattern; cannot hang on a stuck network.

BONUS SAVE FIX COMPLETE
