# Domain setup — report

Run date: 2026-04-22 (two passes; second pass resumed after Oren added
the DNS record).

Target domain: `app.banani-hr.com` (no `CUSTOM_DOMAIN` override in
`.env.local`, so the spec default applies).

## Outcome

**All phases complete.** Pass 1 attached the domain, wrote DNS
instructions, wired the groundwork, and deferred phases 3–5 when the
30-minute polling window expired without DNS propagation. Pass 2
resumed after Oren added the CNAME at Cloudflare: DNS flipped to
`misconfigured:false`, the Let's Encrypt cert issued, the Supabase auth
config was PATCHed to the new primary URL, and the `invite-user` edge
function was redeployed and live-verified end-to-end. The legacy
`bhr-console.vercel.app` URL continues to serve the app as a safety
net.

## Phase 1 — Vercel domain attachment

```
POST /v10/projects/prj_rmCrlbOpuVLP6XPiPTOwYBlq0Smz/domains
  { "name": "app.banani-hr.com" }
→ {
    "name": "app.banani-hr.com",
    "apexName": "banani-hr.com",
    "projectId": "prj_rmCrlbOpuVLP6XPiPTOwYBlq0Smz",
    "verified": true,
    "createdAt": 1776885732105
  }
```

No verification TXT challenge was returned — Vercel matched ownership
immediately via the existing project attachment. `misconfigured: true`
remains until DNS resolves.

## Phase 2 — DNS

`DOMAIN_DNS_INSTRUCTIONS.md` written with the exact record to add:

| Field | Value |
|-------|-------|
| Type  | `CNAME` |
| Host  | `app` |
| Target | `cname.vercel-dns.com.` |
| TTL   | Auto / 3600 |
| Cloudflare proxy | **DNS only (grey cloud)** |

Cloudflare nameservers on the zone per Vercel:
`maya.ns.cloudflare.com`, `aldo.ns.cloudflare.com`.

### Polling result

30 polls of `GET /v6/domains/app.banani-hr.com/config`, 60 s apart,
starting at T+0 after attaching the domain — all reported
`misconfigured:true`. Pass 1 therefore committed the safe groundwork
and deferred phases 3–5.

After Oren added the CNAME at Cloudflare, pass 2 re-polled and got:

```json
{
  "configuredBy": "CNAME",
  "cnames": ["cname.vercel-dns.com."],
  "aValues": ["66.33.60.129", "76.76.21.22"],
  "acceptedChallenges": ["http-01"],
  "misconfigured": false
}
```

HTTPS sanity check:

```
$ curl -sSI https://app.banani-hr.com/login | head -1
HTTP/1.1 200 OK
```

**Time to DNS propagation: between 30 minutes (start of pass 1) and
whenever pass 2 fired** — fully complete by the time phases 3–5 ran.

## Phase 3 — Supabase Auth ✅

PATCH applied to `/v1/projects/szunbwkmldepkwpxojma/config/auth`.

Before:

```
site_url: https://bhr-console.vercel.app
uri_allow_list: https://bhr-console.vercel.app/**,https://bhr-console.vercel.app/*,https://bhr-console.vercel.app/
```

After:

```
site_url: https://app.banani-hr.com
uri_allow_list: https://app.banani-hr.com,
                https://app.banani-hr.com/*,
                https://app.banani-hr.com/**,
                https://bhr-console.vercel.app,
                https://bhr-console.vercel.app/*,
                https://bhr-console.vercel.app/**
```

The legacy vercel.app entries are kept for one release as a safety
net; §34 tracks their removal.

## Phase 4 — URL rewrites

Changes on disk + in Vercel env:

| Target | Change | Deployed? |
|--------|--------|:--------:|
| Vercel project env | `VITE_SITE_URL=https://app.banani-hr.com` (production, preview, development) | ✅ set |
| Local `.env.local` | `VITE_SITE_URL=https://app.banani-hr.com` appended | ✅ |
| `supabase/functions/invite-user/index.ts` | `redirectTo` now reads `PUBLIC_SITE_URL` → `VITE_SITE_URL` → fallback `https://app.banani-hr.com` (was hardcoded `https://bhr-console.vercel.app`) | ⏸ redeploy deferred |
| `BHR_CONSOLE_PROJECT.md` | Live URL line + Tech Stack row + Deployment section + env-var list + edge-function-secrets list | ✅ committed |
| `BHR_CONSOLE_CHECKLIST.md` | Step-4 "Verify Deployment" URL updated; new §§ 30, 31, 34 | ✅ committed |

Post-DNS in pass 2:

- `PUBLIC_SITE_URL=https://app.banani-hr.com` set as a Supabase function
  secret via the Management API, so the edge function has an explicit
  value to read (the source already had `VITE_SITE_URL` and a default
  as fallbacks).
- `npx supabase functions deploy invite-user --project-ref
  szunbwkmldepkwpxojma --no-verify-jwt` → `Deployed Functions on project
  szunbwkmldepkwpxojma: invite-user`.

Historical report/evidence files (`IMPROVEMENTS_REPORT.md`,
`RUN_REPORT.md`, etc.) that reference `bhr-console.vercel.app` are
preserved as-is per the spec — only future checks in
`BHR_CONSOLE_CHECKLIST.md` were updated.

No `bhr-console.vercel.app` references remain in `src/**` (grep
returned 0 hits in the frontend source tree — the app already relies on
`window.location.origin` and `VITE_SUPABASE_URL`).

## Phase 5 — Live verification ✅

1. `curl -sSI https://app.banani-hr.com/login` → `HTTP/1.1 200 OK`.
2. `POST /auth/v1/admin/generate_link` with
   `{type:'magiclink', email:'bananioren@gmail.com',
   options:{redirect_to:'https://app.banani-hr.com/'}}` returned an
   action_link on the Supabase host with
   `redirect_to=https://app.banani-hr.com`.
3. `POST /functions/v1/invite-user` for a seeded
   `qa.domain+test@banani-hr.test / recruiter` test user returned
   `success:true · email_sent:true · email_warning:null` and an
   `action_link` with
   `redirect_to=https://app.banani-hr.com/set-password`. User id
   `8b758f76-6a2e-4e2d-8a5d-c8b4544d2ff3`.
4. `curl -sSI https://bhr-console.vercel.app/login` → `HTTP/1.1 200 OK`
   — legacy safety net still intact; both domains serve the same app.

Cleanup: the test user's `profiles` row and `auth.users` row were
deleted via service role; follow-up GET returns `[]`.

## Phase 6 — Retire `bhr-console.vercel.app`

Explicitly **not in this batch**. §34 added to `BHR_CONSOLE_CHECKLIST.md`.

## Commit SHAs

| Step | Commit | Notes |
|------|--------|-------|
| Phases 1–2 artifacts + groundwork (pre-DNS) | `2b310f0` | spec, checklist §§ 30-31-34, DNS instructions, invite-user env fallback, VITE_SITE_URL on Vercel + .env.local |
| Report SHA backfill | `28b7e91` | |
| Phases 3–5 completion (post-DNS) | (this commit) | auth PATCH, PUBLIC_SITE_URL secret, invite-user redeployed, live-verified, checklist §§ 30.last + 31 flipped |

## Future work

§34 in `BHR_CONSOLE_CHECKLIST.md` tracks retiring
`bhr-console.vercel.app` once all employees have switched to
`app.banani-hr.com`: remove the vercel.app entries from Supabase's
`uri_allow_list` and optionally wire a 301 redirect from the legacy
URL to the new one.

DOMAIN SETUP COMPLETE
