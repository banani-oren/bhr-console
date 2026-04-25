# Fix: Vercel build failing — `vite-plugin-pwa` peer-dep conflict

Commit `4e34de6 feat(mobile): PWA install + /m mobile routes + offline hours
queue (Phase D)` fails on Vercel with:

```
npm error ERESOLVE could not resolve
npm error While resolving: vite-plugin-pwa@1.2.0
npm error Found: vite@8.0.8
npm error Could not resolve dependency:
npm error peer vite@"^3.1.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0" from vite-plugin-pwa@1.2.0
```

Execute end-to-end. Do not stop, do not ask. Report in `VERCEL_BUILD_FIX_REPORT.md`.

## Read first

1. `BHR_CONSOLE_PROJECT.md`.
2. `REFINEMENTS_BATCH_4.md` — Phase D is the source of this conflict.
3. This file.

## Hard rules

- English only. No secrets in logs.
- Prove each fix by checking Vercel's build STATUS via API before declaring
  done — do not trust "I waited 90 seconds."

## Step 1 — Diagnose authoritatively

```bash
cd "/path/to/App Dev"  # wherever the repo is
rm -rf node_modules package-lock.json
npm install 2>&1 | tee /tmp/npm-install.log
```

If the install fails with the same ERESOLVE error, the conflict is real (not
a local cache issue). Capture the exact resolver output.

Check the latest published `vite-plugin-pwa` version and whether it supports
vite 8:

```bash
npm view vite-plugin-pwa versions --json | tail -20
npm view vite-plugin-pwa peerDependencies
```

## Step 2 — Fix, in priority order

Try fix (A) first. If it fails, fall through to (B), then (C). Commit the
fix that worked.

### Fix A — Upgrade `vite-plugin-pwa` to a vite-8-compatible version

If `npm view vite-plugin-pwa peerDependencies` shows a version with `vite`
peer covering `^8`, upgrade:

```bash
npm install -D vite-plugin-pwa@latest
npm install                     # verify clean install succeeds
npm run build                   # verify build succeeds
```

### Fix B — Pin `vite` to a version `vite-plugin-pwa` supports

Only if Fix A isn't possible because no PWA-plugin release supports vite 8.
Downgrade vite to the latest `^7`:

```bash
npm install -D vite@^7
npm install
npm run build
# Check for any breaking changes; the app has been on 8 presumably for good reason
```

Document the reason in `BHR_CONSOLE_PROJECT.md` under a "Known pinned deps"
section.

### Fix C — `.npmrc` with `legacy-peer-deps=true` (last resort)

If neither A nor B is clean, write `.npmrc` at the repo root:

```
legacy-peer-deps=true
```

This persists for both local and Vercel CI (Vercel respects `.npmrc`).
Commit the file.

This is a last resort because it disables the resolver's safety net
project-wide. Only use if A and B don't work.

## Step 3 — Trigger a new deployment and VERIFY the build status

Push the fix:

```bash
git add -A
git commit -m "fix(deps): resolve vite-plugin-pwa peer-dep conflict against vite 8"
git push origin main
```

Load `VERCEL_TOKEN` from `.env.local`. Poll the Vercel API for the latest
deployment's status, up to 5 minutes:

```bash
VERCEL_TOKEN="$(grep '^VERCEL_TOKEN=' .env.local | cut -d= -f2-)"
PROJECT_ID=prj_rmCrlbOpuVLP6XPiPTOwYBlq0Smz

for i in $(seq 1 30); do
  DEPLOY=$(curl -sS \
    "https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&limit=1" \
    -H "Authorization: Bearer $VERCEL_TOKEN")
  STATE=$(echo "$DEPLOY" | jq -r '.deployments[0].state')
  URL=$(echo "$DEPLOY" | jq -r '.deployments[0].url')
  COMMIT=$(echo "$DEPLOY" | jq -r '.deployments[0].meta.githubCommitSha' | cut -c1-7)
  echo "[$i] state=$STATE url=$URL commit=$COMMIT"
  case "$STATE" in
    READY) echo "Build succeeded"; break ;;
    ERROR|CANCELED) echo "Build failed again"; exit 1 ;;
    BUILDING|INITIALIZING|QUEUED) sleep 10 ;;
    *) sleep 10 ;;
  esac
done
```

If the state is `ERROR`, pull the logs via
`https://api.vercel.com/v3/deployments/<deployment_id>/events`, diagnose,
and iterate. Do not proceed until `state=READY`.

## Step 4 — Verify Phase D landed

Once the deployment reports `READY`:

1. Fetch the manifest and confirm it's present and correct:
   ```bash
   curl -sS https://app.banani-hr.com/manifest.webmanifest | head -50
   ```
   Must contain `"name": "BHR Console"`, `"dir": "rtl"`, `"lang": "he"`.
2. Fetch the service worker registration page:
   ```bash
   curl -sS https://app.banani-hr.com/ | grep -iE "(manifest|apple-touch-icon)"
   ```
   Must include both a manifest link and an `apple-touch-icon` link.
3. In Chrome, visit `https://app.banani-hr.com/` on a mobile emulator.
   Lighthouse → PWA audit must pass installability.
4. Navigate to `https://app.banani-hr.com/m/hours` — the mobile route group
   must render.

If any of these fails, Phase D's code changes didn't actually reach
production. Diagnose by comparing the deployed commit SHA with `main` HEAD
and look for any post-fix regressions.

## Step 5 — Harden the autonomous loop

The gap that let this ship as "complete" even though Vercel failed: the
earlier prompts said "wait 90s for Vercel" but didn't verify the build
status. Patch `CLAUDE_CODE_AUTONOMOUS.md` (and add the same rule to
`BHR_CONSOLE_PROJECT.md` under "Mandatory Development Workflow"):

Add to the loop's step 2f:

> f. After pushing, poll the Vercel API
>    (`GET /v6/deployments?projectId=…&limit=1`) every 10 seconds until the
>    latest deployment's `state` is `READY`. Timeout 5 minutes. If `state`
>    becomes `ERROR` or `CANCELED`, fetch the deployment events / logs,
>    diagnose the build failure, fix the code, and go back to step 2c for
>    the same checklist item. Do not proceed to verification until the
>    live deployment matches the commit you just pushed.

Verify in a separate commit that the new rule is in place.

## Termination

1. Write `VERCEL_BUILD_FIX_REPORT.md`:
   - Which fix (A/B/C) resolved it and why.
   - Final Vercel deployment state + deployed commit SHA.
   - Confirmation that PWA manifest, service worker, and `/m/hours`
     all serve correctly on the live URL.
   - Confirmation that `CLAUDE_CODE_AUTONOMOUS.md` now requires Vercel
     build-status verification.
2. Print `VERCEL BUILD FIX COMPLETE` and stop.
