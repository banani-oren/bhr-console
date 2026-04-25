# DNS record to add — `app.banani-hr.com` → Vercel

The domain `app.banani-hr.com` has been attached to the `bhr-console` Vercel
project. The last remaining step is a DNS record at your registrar.

`banani-hr.com` is currently served by **Cloudflare nameservers**
(`maya.ns.cloudflare.com`, `aldo.ns.cloudflare.com`) — add the record in the
Cloudflare dashboard for the `banani-hr.com` zone.

## Record

| Field | Value |
|-------|-------|
| Type  | `CNAME` |
| Name / Host | `app` (the Cloudflare UI may display it as `app.banani-hr.com`) |
| Target / Content | `cname.vercel-dns.com.` (trailing dot optional) |
| TTL   | Auto (or 3600) |
| Proxy status (Cloudflare only) | **DNS only (grey cloud)** — do NOT orange-cloud it, or Vercel's cert issuance will fail and requests will 520. |

## Why a CNAME and not A

Vercel prefers CNAME records for subdomains because they follow Vercel's
edge routing automatically. An A record pointing at `76.76.21.21` also works,
but changes over time — CNAME is the documented recommendation.

## Verification

Once the record is live Vercel will:

1. Detect the CNAME within 1–15 minutes.
2. Issue a Let's Encrypt certificate automatically.
3. Flip `misconfigured` from `true` to `false` on the domain's config
   endpoint.

This batch's Phase 2 polls that endpoint every 60 seconds for up to 30
minutes and proceeds to phases 3–5 as soon as it flips.

## Current Vercel status

At the time this file was written, the domain config reports:

- `verified: true` (ownership confirmed via the existing project attachment)
- `misconfigured: true` (awaiting the DNS record above)
- Recommended CNAME: `cname.vercel-dns.com.`
- Recommended IPv4 (alternative): `76.76.21.21`

Adding the CNAME is the only remaining manual step.
