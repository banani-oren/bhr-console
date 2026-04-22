# Domain setup — report

Run date: 2026-04-22.

Target domain: `app.banani-hr.com` (no `CUSTOM_DOMAIN` override in
`.env.local`, so the spec default applies).

## Outcome

Phases 1 + 2a (domain attached + DNS instructions written + env vars
wired) are complete. Phase 2b (DNS propagation) did **not** complete
within the 30-minute polling window because the registrar-side CNAME
has not been added yet. Per the spec, phases 3–5 are therefore deferred
to a follow-up run.

`bhr-console.vercel.app` continues to serve the app unchanged — nothing
in this batch alters the legacy domain's behavior.

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
starting at T+0 after attaching the domain:

```
poll #1  (1s)    misconfigured=true
poll #15 (855s)  misconfigured=true
poll #30 (1773s) misconfigured=true
```

Final config snapshot: `cnames: []`, `aValues: []`,
`recommendedCNAME: "cname.vercel-dns.com."`, `misconfigured: true`.

**Time to DNS propagation: not yet propagated (> 30 minutes).** Action
required: add the CNAME at the Cloudflare zone.

## Phase 3 — Supabase Auth (deferred)

Not executed. The PATCH to `/v1/projects/.../config/auth` that updates
`site_url` + `uri_allow_list` is gated on DNS being live so that
magic-link and invite-email redirects land on a resolvable host.
Follow-up command (to be run once `misconfigured` flips to `false`):

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

Current auth config (read-only sample) still points at
`https://bhr-console.vercel.app`.

## Phase 4 — URL rewrites

Changes on disk + in Vercel env:

| Target | Change | Deployed? |
|--------|--------|:--------:|
| Vercel project env | `VITE_SITE_URL=https://app.banani-hr.com` (production, preview, development) | ✅ set |
| Local `.env.local` | `VITE_SITE_URL=https://app.banani-hr.com` appended | ✅ |
| `supabase/functions/invite-user/index.ts` | `redirectTo` now reads `PUBLIC_SITE_URL` → `VITE_SITE_URL` → fallback `https://app.banani-hr.com` (was hardcoded `https://bhr-console.vercel.app`) | ⏸ redeploy deferred |
| `BHR_CONSOLE_PROJECT.md` | Live URL line + Tech Stack row + Deployment section + env-var list + edge-function-secrets list | ✅ committed |
| `BHR_CONSOLE_CHECKLIST.md` | Step-4 "Verify Deployment" URL updated; new §§ 30, 31, 34 | ✅ committed |

Deliberately **not yet done**:

- **Redeploying `invite-user`.** The source change is in the repo, but
  the currently-deployed function version still uses the old
  `bhr-console.vercel.app` fallback. If we redeployed now, invitees
  would receive action links pointing at `https://app.banani-hr.com/set-password`
  which doesn't resolve yet. Run
  `npx supabase functions deploy invite-user --project-ref szunbwkmldepkwpxojma --no-verify-jwt`
  once DNS is live (or set `PUBLIC_SITE_URL` as a Supabase secret to the
  desired value before deploying).
- **Rewriting historical report/evidence files** (`IMPROVEMENTS_REPORT.md`,
  `RUN_REPORT.md`, etc.) that reference `bhr-console.vercel.app`. Per
  the spec, historical evidence is preserved; only future checks in
  `BHR_CONSOLE_CHECKLIST.md` were updated.

No `bhr-console.vercel.app` references remain in `src/**` (grep
returned 0 hits in the frontend source tree — the app already relies on
`window.location.origin` and `VITE_SUPABASE_URL`).

## Phase 5 — Live verification (deferred)

Not run. All four bullets (login page, magic-link, invite action link,
legacy domain as safety net) require phases 3–4 (specifically the
Supabase auth update and the `invite-user` redeploy) plus DNS being
live. Defer to the follow-up run.

## Phase 6 — Retire `bhr-console.vercel.app`

Explicitly **not in this batch**. §34 added to `BHR_CONSOLE_CHECKLIST.md`.

## Commit SHAs

| Step | Commit | Notes |
|------|--------|-------|
| Spec + checklist + DNS instructions + invite-user env fallback + env var | 2b310f0 | |

## Follow-up runbook

Once Oren adds the CNAME:

1. Poll `GET /v6/domains/app.banani-hr.com/config` — confirm
   `misconfigured:false`. Typical propagation: 1–15 minutes.
2. `curl -sSI https://app.banani-hr.com | head -5` — expect HTTP/2 200.
3. Execute Phase 3 PATCH (see command above).
4. `npx supabase functions deploy invite-user --project-ref
   szunbwkmldepkwpxojma --no-verify-jwt`.
5. Run the Phase 5 Chrome verification loop.
6. Flip §31 checklist items to `[x]` with live evidence.

DOMAIN SETUP COMPLETE — pending DNS
