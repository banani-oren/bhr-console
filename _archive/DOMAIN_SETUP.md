# Domain setup — move from bhr-console.vercel.app to app.banani-hr.com

Move the live site to `app.banani-hr.com`. Execute end-to-end. Do not stop,
do not ask, do not summarize mid-run. Report in `DOMAIN_SETUP_REPORT.md`.

## Read first

1. `BHR_CONSOLE_PROJECT.md`.
2. This file.

## Hard rules

- English only for reasoning and commit messages.
- Never print or commit secrets (`VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, etc.).
- The domain throughout this task is `app.banani-hr.com`. If Oren has
  overridden it, read `.env.local` for `CUSTOM_DOMAIN=...` and use that; else
  use `app.banani-hr.com`.

## Phase 1 — Add the custom domain in Vercel

Load `VERCEL_TOKEN` from `.env.local`. Add the domain to the
`bhr-console` project:

```bash
VERCEL_TOKEN="$(grep '^VERCEL_TOKEN=' .env.local | cut -d= -f2-)"
DOMAIN="${CUSTOM_DOMAIN:-app.banani-hr.com}"
PROJECT_ID=prj_rmCrlbOpuVLP6XPiPTOwYBlq0Smz

curl -sS -X POST \
  "https://api.vercel.com/v10/projects/${PROJECT_ID}/domains" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$DOMAIN\"}"
```

Expected response includes `verification` (if any) and `misconfigured: true`
until DNS is set. Extract and save the verification hint.

## Phase 2 — Wait for DNS propagation

Write a clear `DOMAIN_DNS_INSTRUCTIONS.md` to the repo root telling Oren what
record to add at his DNS registrar. For `app.banani-hr.com` pointing to
Vercel, that's a single `CNAME`:

```
Type:     CNAME
Host:     app
Value:    cname.vercel-dns.com.
TTL:      3600 (or registrar default)
```

Then poll Vercel and DNS for up to 30 minutes (checks every 60 seconds):

```bash
for i in $(seq 1 30); do
  STATUS=$(curl -sS \
    "https://api.vercel.com/v6/domains/$DOMAIN/config?teamId=${VERCEL_TEAM_ID:-}" \
    -H "Authorization: Bearer $VERCEL_TOKEN" | jq -r '.misconfigured')
  if [ "$STATUS" = "false" ]; then
    echo "DNS live after ${i} minutes"
    break
  fi
  sleep 60
done
```

If after 30 minutes the domain is still `misconfigured=true`, write the
current status to `DOMAIN_SETUP_REPORT.md`, leave phases 3–5 for a follow-up
run, and stop. Otherwise, continue to phase 3.

Vercel auto-issues a Let's Encrypt certificate once DNS resolves. Confirm the
domain serves HTTPS:

```bash
curl -sSI "https://$DOMAIN" | head -5
# Expect HTTP/2 200 (or 308 redirect to the same domain).
```

## Phase 3 — Update Supabase Auth Site URL and redirects

Load `SUPABASE_ACCESS_TOKEN` from `.env.local`. Update the auth config so
magic links, invite links, and password resets redirect to the new domain.
Keep the Vercel default URL in the additional_redirect_urls list as a safety
net for one release:

```bash
SUPABASE_ACCESS_TOKEN="$(grep '^SUPABASE_ACCESS_TOKEN=' .env.local | cut -d= -f2-)"

curl -sS -X PATCH \
  "https://api.supabase.com/v1/projects/szunbwkmldepkwpxojma/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"site_url\": \"https://$DOMAIN\",
    \"uri_allow_list\": \"https://$DOMAIN,https://$DOMAIN/*,https://bhr-console.vercel.app,https://bhr-console.vercel.app/*\"
  }"
```

Verify:

```bash
curl -sS \
  "https://api.supabase.com/v1/projects/szunbwkmldepkwpxojma/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  | jq '{site_url, uri_allow_list}'
```

## Phase 4 — Rewrite hardcoded URLs in the repo

Grep for `bhr-console.vercel.app` across the repo. Replace each occurrence
with either the new domain or (preferably) a dynamic `window.location.origin`
/ the `VITE_SITE_URL` env var where possible.

Known hotspots:

- `supabase/functions/invite-user/index.ts` — the invite email's action link
  is built from Supabase's `redirect_to` option. Ensure the redirect_to is
  set to `https://$DOMAIN/set-password`.
- `supabase/functions/extract-agreement/` — no URL usage expected; skip.
- `BHR_CONSOLE_PROJECT.md` — update the "Live URL" and "Vercel" sections.
- `README.md` — update.
- `BHR_CONSOLE_CHECKLIST.md` — replace all `https://bhr-console.vercel.app`
  with `https://app.banani-hr.com` in future checks (do not rewrite history
  in the completed evidence notes).

Add `VITE_SITE_URL=https://app.banani-hr.com` to `.env.local` (update) and
to Vercel environment variables:

```bash
curl -sS -X POST \
  "https://api.vercel.com/v10/projects/${PROJECT_ID}/env" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {"key":"VITE_SITE_URL","value":"https://app.banani-hr.com","type":"plain","target":["production","preview","development"]}
  ]'
```

Redeploy any changed edge function:

```bash
npx supabase functions deploy invite-user --project-ref szunbwkmldepkwpxojma --no-verify-jwt
```

Commit, push, wait 90s for Vercel to redeploy.

## Phase 5 — Verification

Using Chrome via the `--chrome` integration:

1. Visit `https://$DOMAIN/login` → clean console, app renders.
2. Admin magic-link flow (generate via `auth/v1/admin/generate_link`,
   navigate in Chrome): token redirects to `$DOMAIN`, lands on `/`.
3. Invite a test user `qa.domain+test@banani-hr.test`. Confirm the invite
   email's action link points at `https://$DOMAIN/set-password` (inspect the
   Resend send via its API).
4. Use the action link: lands on `$DOMAIN/set-password`, not the old
   vercel.app URL.
5. `https://bhr-console.vercel.app/login` — continues to work (safety net).
   Both domains serve the same app. No redirect between them (yet).

Delete the test user.

## Phase 6 — Retire the `bhr-console.vercel.app` domain (NOT in this batch)

Leave this step undone. Add a checklist item `§34 retire vercel.app domain`
with the one-liner: once Oren confirms all employees have switched to the
new domain, remove `bhr-console.vercel.app` from `uri_allow_list` and
optionally add a 301 redirect in `vercel.json` from the old domain to the
new one.

## Termination

1. Update `BHR_CONSOLE_PROJECT.md`: replace the "Live URL" and re-document
   the domain setup.
2. Write `DOMAIN_SETUP_REPORT.md`:
   - Final commit SHA.
   - Time to DNS propagation.
   - Supabase auth config before/after (redacted).
   - Any hardcoded URLs that were left deliberately.
3. Print `DOMAIN SETUP COMPLETE` and stop.
