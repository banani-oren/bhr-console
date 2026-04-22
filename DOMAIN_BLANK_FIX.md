# Fix: app.banani-hr.com renders blank / data-less

Oren reports that after the DOMAIN_SETUP migration, the app at
`https://app.banani-hr.com` loads but shows no data, while
`https://bhr-console.vercel.app` continues to work. Diagnose and fix.
Do not stop, do not ask, do not summarize mid-run. Report in
`DOMAIN_BLANK_FIX_REPORT.md`.

## Read first

1. `BHR_CONSOLE_PROJECT.md`
2. `DOMAIN_SETUP.md` — what the prior run did.
3. `DOMAIN_SETUP_REPORT.md` — what actually got deployed.
4. This file.

## Hard rules

- English only; never print secrets.
- Live-verify on BOTH domains throughout so the fix doesn't regress the
  old one.
- No deferrals — if a fix requires a config change, make it, redeploy,
  and verify live.

## Step 1 — Diagnose in Chrome (both domains, fresh incognito)

For each of `https://app.banani-hr.com` and `https://bhr-console.vercel.app`,
open an incognito window and capture:

1. What the page renders at `/` (login page? blank? error?).
2. DevTools → Console: every error and warning.
3. DevTools → Network: all failed requests (status ≥ 400) and requests
   that stay `Pending`. Especially `*.supabase.co/auth/*` and
   `*.supabase.co/rest/*`.
4. DevTools → Application → Local Storage: is there a
   `sb-szunbwkmldepkwpxojma-auth-token` key?
5. Inspect the served JS bundle: download
   `https://<domain>/assets/<main>.js` and grep for the hardcoded
   `VITE_SUPABASE_URL` value. Should be
   `https://szunbwkmldepkwpxojma.supabase.co` on BOTH domains (same Vercel
   deployment serves both).

Write the findings into `DOMAIN_BLANK_FIX_REPORT.md`. Then branch:

## Step 2 — Branch on the diagnosis

### Branch A — New domain redirects to `/login` cleanly

Expected, not-a-bug case. The issue is that Oren was logged in on the
old domain's localStorage and a new domain is a fresh origin. Fix:

1. Generate an admin magic link targeting the NEW domain:
   ```bash
   curl -sS -X POST "${VITE_SUPABASE_URL}/auth/v1/admin/generate_link" \
     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"type":"magiclink","email":"bananioren@gmail.com","options":{"redirect_to":"https://app.banani-hr.com/"}}'
   ```
2. Open the returned `action_link` in Chrome. Confirm it lands on
   `https://app.banani-hr.com/` and the dashboard renders with full data.
3. No code change needed. Document in the report that this was a
   per-origin session issue, not a bug.

### Branch B — New domain renders UI but data is empty AND no session in localStorage

The app rendered instead of redirecting to `/login`. Route guard bug. Fix:

1. Inspect `src/App.tsx` and `src/components/RequireRole.tsx` (or
   equivalent). Confirm `user` being `null` returns a `<Navigate
   to="/login" replace />`. If it currently returns the page with an
   empty user, patch it.
2. Also check for a loading-flag bug where `user=null` while `loading=true`
   renders the page shell with empty data. Add an explicit loading skeleton
   that blocks data rendering until `loading === false`.
3. Rebuild, commit, push, verify on both domains.

### Branch C — Network shows 401/400 on Supabase auth/rest calls from the new domain only

Likely Supabase Auth `uri_allow_list` doesn't include the new domain. Fix:

1. Read current auth config:
   ```bash
   curl -sS \
     "https://api.supabase.com/v1/projects/szunbwkmldepkwpxojma/config/auth" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     | jq '{site_url, uri_allow_list}'
   ```
2. If `uri_allow_list` does not include `https://app.banani-hr.com` and
   `https://app.banani-hr.com/*`, patch:
   ```bash
   curl -sS -X PATCH \
     "https://api.supabase.com/v1/projects/szunbwkmldepkwpxojma/config/auth" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "site_url": "https://app.banani-hr.com",
       "uri_allow_list": "https://app.banani-hr.com,https://app.banani-hr.com/*,https://bhr-console.vercel.app,https://bhr-console.vercel.app/*"
     }'
   ```
3. Re-run the magic-link flow from Branch A against the new domain.

### Branch D — JS bundle on new domain has empty `VITE_SUPABASE_URL`

Build-time env vars weren't baked into the Vercel production build. Fix:

1. Read the current Vercel envs:
   ```bash
   curl -sS \
     "https://api.vercel.com/v9/projects/prj_rmCrlbOpuVLP6XPiPTOwYBlq0Smz/env" \
     -H "Authorization: Bearer $VERCEL_TOKEN" \
     | jq '.envs[] | {key, target}'
   ```
   Expect `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL`
   present in the `production` target.
2. If any are missing, add them via the Vercel API. Then trigger a
   production redeploy:
   ```bash
   curl -sS -X POST \
     "https://api.vercel.com/v13/deployments?forceNew=1" \
     -H "Authorization: Bearer $VERCEL_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "bhr-console",
       "project": "prj_rmCrlbOpuVLP6XPiPTOwYBlq0Smz",
       "gitSource": {"type": "github", "ref": "main", "repoId": "<from project config>"},
       "target": "production"
     }'
   ```
   Simpler: push an empty commit (`git commit --allow-empty -m
   "chore: trigger redeploy after env fix"` + `git push`) and wait 90s.

### Branch E — Service worker serving a stale bundle

Batch 4 may have registered a service worker (`vite-plugin-pwa`). The new
domain might be serving a cached bundle that doesn't know about the new
origin. Fix:

1. In Chrome on the new domain: DevTools → Application → Service Workers
   → check what's registered. If an old one is cached, `Unregister`.
2. If Batch 4 hasn't shipped yet, this branch is not applicable — note
   and skip.
3. In the PWA config, confirm `skipWaiting: true` and `clientsClaim: true`
   are set so future updates roll out cleanly.

## Step 3 — Verify on BOTH domains

Run the same checklist on `https://app.banani-hr.com` and
`https://bhr-console.vercel.app`:

1. Admin magic-link login → dashboard renders.
2. `/clients` — list loads with all clients.
3. `/transactions` — list loads.
4. `/hours` — admin view loads without blank state.
5. No console errors, no 4xx/5xx in Network.
6. localStorage has `sb-szunbwkmldepkwpxojma-auth-token`.

If either domain fails any check, return to Step 1 for that domain.

## Step 4 — Document

Write `DOMAIN_BLANK_FIX_REPORT.md`:

- Which branch (A/B/C/D/E) was the root cause (can be more than one).
- Exact changes made: file edits, API calls, commit SHAs, redeploy timestamps.
- Before/after `uri_allow_list` if touched.
- Confirmation that both domains pass Step 3.
- If the fix was "log in at new domain" (Branch A only, no bug), update
  `BHR_CONSOLE_PROJECT.md` with a short note under "Domains": "When
  switching domains, employees will need to log in once on the new domain
  — their session does not transfer between origins."

Print `DOMAIN BLANK FIX COMPLETE` and stop.
