# Fix: bonus_model edit on /team doesn't save

Diagnose-first. Identify the exact failure point before patching. Treat
real data as read-only — use a `[TEST-…]` employee for save scenarios,
not a real one. Per `CLAUDE_CODE_AUTONOMOUS.md`, poll Vercel for
`state=READY` after each push. Produce `BONUS_SAVE_FIX_REPORT.md`.

## Read first

1. `BHR_CONSOLE_PROJECT.md`
2. This file.

## Hard rules

- Read-only on real employee rows. Use a `[TEST-…]` test employee for
  reproduction.
- Evidence rule: include actual HTTP request/response bodies, not "save
  failed."

## Step 1 — Reproduce in Chrome with DevTools open

1. Magic-link as admin → `/team`.
2. Create a `[TEST-…]` employee:
   - Invite `qa.test+bonus@banani-hr.test`, name `[TEST] Bonus Probe`,
     role `recruiter`.
3. Open DevTools → Network tab → filter `profiles`.
4. Open the test employee's card → click `ערוך מודל` (or whatever the
   bonus-edit button is).
5. Configure the 6-tier model from `BHR_CONSOLE_PROJECT.md` (Noa's
   spec):
   ```
   {min:0, bonus:0}, {10000, 800}, {14000, 1200}, {25000, 2100},
   {37000, 3200}, {59000, 4100}, {70000, 5200}
   ```
6. Click שמור.

Capture in `BONUS_SAVE_AUDIT.md`:

- Full HTTP request: method, URL, headers (redact Authorization), body.
- Full HTTP response: status, headers, body.
- Console errors at the time of the click.
- The component's local state right after the click (via React
  DevTools or by reading `dialog`'s state via JS in the console).
- Whether the dialog stays open, closes, shows a toast, or hangs.

## Step 2 — Branch on the diagnosis

### Branch A — No request fires at all

The submit handler isn't wired or short-circuits before the call.

- Read the bonus-edit dialog component. Find the submit handler.
- Check for: missing `onClick`/`onSubmit`, validation error that
  silently blocks submit, disabled button state, `useSafeMutation`
  shortcut that fails to invoke.
- Fix the wiring. Add a console.log at submit-start as a sanity check,
  remove after verification.

### Branch B — Request fires but returns 4xx/5xx

Most likely RLS or schema. Decode the response body.

- **400 `invalid input syntax for type jsonb`** → the bonus_model
  is being sent as a string instead of an object. Frontend likely
  doing `JSON.stringify(model)` twice. Strip one layer.
- **400 `value violates check constraint`** → a tier has invalid
  values. Check for negative numbers or NaN being sent.
- **401/403** → RLS denying the update. The current policy on
  `profiles` requires the caller's `role='admin'` for update of other
  rows; if the admin's session was downgraded or the policy uses
  `auth.uid()` incorrectly, this fails. Verify policy via:
  ```sql
  select policyname, cmd, qual, with_check from pg_policies
  where tablename = 'profiles';
  ```
  Fix the policy via Management API if it's wrong.
- **500** → server-side function (RPC, trigger, or edge function)
  failing. Check Supabase Function logs and any database trigger logs.

### Branch C — Request returns 2xx but UI doesn't reflect

- The mutation's `onSuccess` doesn't fire / doesn't invalidate
  queries. Check `queryClient.invalidateQueries(['profiles'])` or
  whatever key is in use.
- The dialog's local state machine is stuck on "saving" — verify
  `useSafeMutation` resolves the promise and resets `saveStatus`.

### Branch D — Request returns 2xx and DB updates, but reload shows stale

- React Query cache doesn't refresh because the bonus_model column
  isn't in the SELECT. Check the `/team` query columns; ensure
  `bonus_model` is selected.

## Step 3 — Fix and verify

Apply the fix from the branch that matches.

Verify with these scenarios on the test employee:

V1. Save the 6-tier model. Reload the page. Open the dialog. The
saved tiers reappear with the same values.

V2. Service-role query confirms the JSONB is stored correctly:
```bash
curl -sS "$VITE_SUPABASE_URL/rest/v1/profiles?email=eq.qa.test+bonus@banani-hr.test&select=full_name,bonus_model" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY"
```
The `bonus_model` JSON matches what was entered, including types
(numbers, not strings).

V3. Edit the model — change one tier (e.g., 800 → 850). Save. Reload.
The change persisted.

V4. Empty out the model (no tiers). Save. The DB shows `bonus_model
= null` or `[]` per the empty-model semantics.

V5. Enter an invalid value (e.g., negative bonus, text instead of
number). Save. Red toast appears. DB unchanged.

V6. Bonus dashboard `/bonuses` updates within 5s of save (no
refresh needed) — the test employee appears with the saved model
parameters.

V7. Cleanup: delete the test employee and any associated rows.

Commit: `fix(bonus): root-cause + repair save flow on /team — <branch>`.

## Termination

1. Write `BONUS_SAVE_FIX_REPORT.md`:
   - Step 1 audit: copy of HTTP request/response, console errors,
     branch identified.
   - Step 3 scenario evidence (V1–V7).
   - Final commit SHA, deployment ID.
   - Cleanup confirmation: `qa.test+bonus@banani-hr.test` deleted from
     `auth.users` AND `profiles`.
2. Print `BONUS SAVE FIX COMPLETE` and stop.
