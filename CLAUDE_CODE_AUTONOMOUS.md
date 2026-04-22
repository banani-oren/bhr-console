# Autonomous Completion — BHR Console (v2)

You are running in autonomous mode. Chrome browser tools are available via the `--chrome`
integration. Your single job: make every item in `BHR_CONSOLE_CHECKLIST.md` pass on the
live production site at https://bhr-console.vercel.app, then stop.

## Hard constraints

1. **Read `BHR_CONSOLE_PROJECT.md` and `BHR_CONSOLE_CHECKLIST.md` in full before any action.**
   They are the source of truth. Re-read `BHR_CONSOLE_PROJECT.md` at the start of every
   new implementation cycle.
2. **English only** for reasoning and commit messages. Hebrew is only for user-facing UI.
3. **Do not ask questions. Do not wait for input. Do not summarize mid-run.** Run until
   every box in the checklist is `[x]` and the regression sweep is green, then stop.
4. **NO DEFERRALS.** Every item must be verified by real interaction on the live site.
   "Code-verified", "grep-verified", "not exercised to avoid writing data" are NOT
   acceptable outcomes. If a check requires logging in as admin, log in as admin
   (see Admin authentication below). If a check requires a configured bonus model,
   configure one on a test employee. If a check requires production data, seed it
   under a clearly-named test record and clean it up at the end.
5. **A task is DONE only when four gates all pass:** (1) `npm run build` completes with
   zero errors, (2) local QA passes, (3) the commit is pushed to `origin/main`,
   (4) the live URL, observed via Chrome, exhibits the expected behavior.
6. **Verification is browser-observable only.** Open the live URL in Chrome, perform the
   action, observe the outcome. No exceptions.

## Admin authentication — REQUIRED

You must log in as admin for every admin-gated check. Do NOT ask Oren for a password.
Do NOT store a password anywhere. Use the magic-link flow:

1. Read `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`.
2. Generate a one-shot magic link for the admin:
   ```bash
   curl -s -X POST "$VITE_SUPABASE_URL/auth/v1/admin/generate_link" \
     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"type":"magiclink","email":"bananioren@gmail.com"}'
   ```
3. Extract `properties.action_link` (or `action_link`) from the JSON response.
4. In Chrome, navigate to that link. Supabase consumes the token, sets the session
   cookie on the site origin, and redirects you into the app as admin.
5. Proceed with admin-gated checks.

If the session expires mid-run (likely after ~1 hour), generate a fresh link and re-enter.
If magic-link generation fails, diagnose and fix it — it is a prerequisite for the run.

## Seeding & cleaning up test data

Some checks require data that isn't in production. Use clearly-named test records so
cleanup is unambiguous:

- Test admin-side employee: `QA Test Employee` / `qa.test+autotest@banani-hr.test`
- Test client: `QA Test Client (autotest)`
- Test bonus model: configure the 6-tier spec model from `BHR_CONSOLE_PROJECT.md` on `QA Test Employee`
- Test transaction: description / notes include the tag `[AUTOTEST]`

At termination, delete every record whose name/email/notes contains `autotest` or `AUTOTEST`.
Log every seed + delete in `RUN_REPORT.md`.

## Priority order

Work items in this order, not checklist order:

1. **§0.5 Known bugs first** — reproduce each, fix, push, verify gone.
2. **§0 Baseline + §1 Layout + §2 Sidebar** — establishes the foundation.
3. **Admin login (§0.5 magic link)** — unlocks everything else.
4. **§3 → §8 page by page** — for each page: load it, click every button,
   fill every form, submit, observe; fix each failure before moving on.
5. **§9 Portal** — re-exercise live (no more "code-verified").
6. **§10 Auth & safety, §11 Data integrity** — live-exercise the admin-gated ones.
7. **§12 Final regression sweep** — screenshots, console-clean, network-clean.

## The loop

Repeat until the checklist is all `[x]`:

1. Read `BHR_CONSOLE_CHECKLIST.md`. Pick the first unchecked item per the priority order above.
2. If it requires code changes:
   a. Read the relevant files in `src/` to understand the current state.
   b. Implement the minimal change.
   c. `npm run build` — fix errors, repeat until clean.
   d. `git add` + `git commit -m "<section>: <what changed>"`.
   e. `git push origin main`.
   f. After pushing, poll the Vercel API
      (`GET /v6/deployments?projectId=${PROJECT_ID}&limit=1` with
      `Authorization: Bearer $VERCEL_TOKEN`) every 10 seconds until the
      latest deployment's `state` is `READY`. Timeout 5 minutes. If
      `state` becomes `ERROR` or `CANCELED`, fetch the deployment
      events/logs (`/v3/deployments/<id>/events`), diagnose the build
      failure, fix the code, and go back to step 2c for the same
      checklist item. Do not proceed to verification until the live
      deployment matches the commit you just pushed. A fixed-length
      "wait 90 seconds" is NOT acceptable — always verify build state.
3. Open the live URL in Chrome. Perform the check. Observe.
4. If it passes, edit `BHR_CONSOLE_CHECKLIST.md`: flip `[ ]` → `[x]`, append a short
   live-evidence note (what you clicked, what you saw). Commit + push.
5. If it fails, diagnose via browser console + network + source. Fix. Return to 2c.
   Do not move on.
6. Loop.

## Active bug-hunt mode (not just checklist items)

While executing §3–§8, act as a QA engineer:
- Load every page. Wait 10 seconds observing for hangs, spinners that never resolve,
  or UI freezes. If a page is unresponsive > 5s, treat as a failure — diagnose and fix.
- Click every button. Open every dialog. Submit every form with realistic data.
- Watch the browser console and network tab continuously. Any red console error,
  any 4xx/5xx request, any React warning → add a new `[ ]` line under §0.5 describing
  the bug, then fix it before continuing.
- Test edge cases: empty states (no clients, no transactions), long text, RTL/LTR mixed
  data, missing optional fields.

## Git & safety

- Never commit `.env.local` or anything in `.gitignore`.
- If `git push` is rejected non-fast-forward: `git pull --rebase origin main`, resolve, push.
- Never `git commit --amend` a pushed commit. Never `git reset --hard` a pushed commit.
- Never store or print `SUPABASE_SERVICE_ROLE_KEY`, `VERCEL_TOKEN`, `RESEND_API_KEY`,
  `SUPABASE_ACCESS_TOKEN`, or the admin password.

## Termination

When every `[ ]` in `BHR_CONSOLE_CHECKLIST.md` is `[x]` and §12 is green:

1. Run the full regression sweep (§12).
2. Screenshots of every admin page + portal to `./qa-screenshots/`.
3. Delete all `autotest` / `AUTOTEST` seeded data.
4. Write `./RUN_REPORT.md` summarizing: commits made, items completed, bugs discovered
   and fixed (with file/line), test data seeded + cleaned, final live commit SHA.
5. Print `AUTONOMOUS RUN COMPLETE` and stop.

Start now. Read `BHR_CONSOLE_PROJECT.md`, then `BHR_CONSOLE_CHECKLIST.md`, then execute
the loop.
