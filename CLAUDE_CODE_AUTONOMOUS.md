# Autonomous Completion — BHR Console

You are running in autonomous mode. Chrome browser tools are available via the `--chrome`
integration. Your single job: make every item in `BHR_CONSOLE_CHECKLIST.md` pass on the
live production site at https://bhr-console.vercel.app, then stop.

## Hard constraints

1. **Read `BHR_CONSOLE_PROJECT.md` and `BHR_CONSOLE_CHECKLIST.md` in full before any action.**
   They are the source of truth. Re-read `BHR_CONSOLE_PROJECT.md` at the start of every
   implementation cycle in case it has changed.
2. **English only** for reasoning and commit messages. Hebrew is only for user-facing UI.
3. **Do not ask questions. Do not wait for input. Do not summarize progress mid-run.**
   Run until every box in the checklist is `[x]` and the final regression sweep is green.
4. **A task is DONE only when four gates all pass:**
   (1) `npm run build` completes with zero errors,
   (2) local QA (per `BHR_CONSOLE_PROJECT.md`) passes,
   (3) the commit is pushed to `origin/main`,
   (4) the live URL, observed via Chrome, exhibits the expected behavior.
5. **Verification is browser-observable only.** "Looks right in the code" is not acceptance.
   Open the live URL in Chrome, perform the checklist action, observe the result.

## The loop

Repeat until the checklist is all green:

1. Read `BHR_CONSOLE_CHECKLIST.md`. Pick the first unchecked `[ ]` item.
2. If the item requires code changes:
   a. Read the relevant files in `src/` to understand the current state.
   b. Implement the minimal change that satisfies the item.
   c. Run `npm run build`. If errors, fix and re-run until clean.
   d. Stage, commit with a message that names the section and what changed. Example:
      `feat(§2): remove /agreements route and הסכמים nav item`
   e. `git push origin main`.
   f. Wait 90 seconds for Vercel to finish deploying.
3. Open https://bhr-console.vercel.app in Chrome. Perform the check. Observe the result.
   If it matches the pass criterion, edit `BHR_CONSOLE_CHECKLIST.md` to change `[ ]` to
   `[x]` on that line, commit (`chore: check off §N.X`), push.
4. If it does not match, diagnose:
   - Read the browser console for JS errors.
   - Read the network tab for 4xx/5xx responses.
   - Read the relevant `src/` files.
   Then fix and restart step 2c for the same item. Do not move to a new item until the
   current one is green on the live site.
5. Loop.

## Chrome usage

- The ONLY valid verification target is https://bhr-console.vercel.app. Never verify
  against localhost, `npm run dev`, or the `dist/` build output — deployment is ground truth.
- For admin-only checks: log in at `/login`. Admin email is `bananioren@gmail.com`; the
  password is stored by Oren (not in `.env.local`). If a password is required and not
  available, add a note to `RUN_REPORT.md`, defer only the admin-gated checks, and keep
  working on everything else — this is the ONE permitted deferral.
- For portal checks: use the portal link shown on `/team` for a test employee.
- If the browser tool errors or disconnects, retry up to 3 times (reopening Chrome if
  needed). If still failing after 3 tries, log it in `RUN_REPORT.md` and continue with
  code-only items.

## Git & safety

- Never commit `.env.local` or anything ignored by `.gitignore`.
- If `git push` is rejected as non-fast-forward: `git pull --rebase origin main`, resolve,
  then push.
- Never `git commit --amend` a commit that has already been pushed.
- Never `git reset --hard` anything that has been pushed.
- If a check surfaces a real bug that isn't covered by any existing item, add a new `[ ]`
  line under §12 and fix it before final sign-off.

## Termination

When every `[ ]` in `BHR_CONSOLE_CHECKLIST.md` is `[x]` and §12 is green:

1. Run the full regression sweep (§12).
2. Save screenshots of every admin page and the portal to `./qa-screenshots/`.
3. Write `./RUN_REPORT.md` summarizing: commits made, items completed, any surprises
   found, anything that was deferred or blocked, and the final live commit SHA.
4. Print `AUTONOMOUS RUN COMPLETE` and stop.

Start now. Read `BHR_CONSOLE_PROJECT.md`, then `BHR_CONSOLE_CHECKLIST.md`, then execute
the loop.
