# Archived prompts and reports — historical audit trail

Each entry below was an autonomous-run prompt or its accompanying
report. They are kept verbatim for traceability of every decision /
schema change / data import the system has gone through. The
authoritative current state lives in:

- `BHR_CONSOLE_PROJECT.md` — system spec
- `BHR_CONSOLE_CHECKLIST.md` — acceptance criteria
- `CLAUDE_CODE_AUTONOMOUS.md` — autonomous-run rules
- `EMPLOYEE_MOBILE_INSTALL_GUIDE.md` — employee onboarding

## Prompts

| File | When | Scope |
|---|---|---|
| `prompt_clients_unified.md` | early v1 | first stab at the unified clients-page spec; superseded by the IMPROVEMENTS series |
| `IMPROVEMENTS_BATCH.md` | 2026-04-18 | profile menu, /users cleanup, Excel client import, role dashboards (Features 1–4) |
| `IMPROVEMENTS_BATCH_2.md` | 2026-04-18 | Noa fix #1, hourly_rate, service_types, transactions wizard, time-log, PDF agreement extraction |
| `REFINEMENTS_BATCH_3.md` | 2026-04-22 | service_types purge, admin-is-employee, single-panel transaction dialog, time_period kind, billing reports |
| `REFINEMENTS_BATCH_4.md` | 2026-04-22 | UX fixes (ClientPicker, useSafeMutation, dialog widths, LabeledToggle), hours-dialog flow, flexible billing reports, PWA + /m + Face-ID-friendly login |
| `REFINEMENTS_BATCH_5.md` | 2026-04-25 | dd/mm/yy dates, bonus dashboard, mobile rethink, ClientCombobox everywhere, sidebar footer, full QA pass |
| `URGENT_FIXES_NOA_HOURS_BONUS.md` | 2026-04-25 | Noa root-cause + always-upsert profile, hours picker always visible, /bonuses rebuild |
| `QUICK_FIXES_NAME_HOURS.md` | 2026-04-25 | admin-update-user edge function + UserEditDialog, ClientPicker swappable in place, mobile guide v1 |
| `SECURITY_FIX_AND_ROLES.md` | 2026-04-18 | three-role access model + role-aware RLS + invite-link bypass closure |
| `DOMAIN_SETUP.md` | 2026-04-18 | move from bhr-console.vercel.app to app.banani-hr.com |
| `DOMAIN_BLANK_FIX.md` | 2026-04-22 | white-screen fix on the new domain |
| `DOMAIN_DNS_INSTRUCTIONS.md` | 2026-04-18 | step-by-step DNS record for the Cloudflare zone |
| `MOBILE_AND_PROFILE_FIX.md` | 2026-04-23 | mobile double-shell fix + profile email/password change |
| `ONE_TIME_CSV_IMPORT.md` | 2026-04-23 | one-shot import of the מעקב השמות sheet |
| `POST_IMPORT_FIXES.md` | 2026-04-23 | hours_log audit, transactions free-text search, DateInput component |
| `VERCEL_BUILD_FIX.md` | 2026-04-22 | vite-plugin-pwa peer-dep conflict + .npmrc fix |
| `DEPLOY_EMAIL_SENDER_FIX.md` | 2026-04-18 | Resend sender domain configuration |

## Reports

| File | When | What it documents |
|---|---|---|
| `IMPROVEMENTS_REPORT.md` | 2026-04-18 | execution log for IMPROVEMENTS_BATCH |
| `IMPROVEMENTS_2_REPORT.md` | 2026-04-18 | execution log for IMPROVEMENTS_BATCH_2 |
| `REFINEMENTS_3_REPORT.md` | 2026-04-22 | execution log for REFINEMENTS_BATCH_3 |
| `REFINEMENTS_4_REPORT.md` | 2026-04-22 | execution log for REFINEMENTS_BATCH_4 |
| `REFINEMENTS_5_REPORT.md` | 2026-04-25 | execution log for REFINEMENTS_BATCH_5 |
| `URGENT_FIXES_REPORT.md` | 2026-04-25 | Noa real-user IDs + scenario evidence |
| `QUICK_FIXES_REPORT.md` | 2026-04-25 | admin-update-user scenario tests + combobox fix walkthrough |
| `SECURITY_FIX_REPORT.md` | 2026-04-18 | RLS policy listings + role-test evidence |
| `DOMAIN_SETUP_REPORT.md` | 2026-04-22 | DNS poll output + auth config diff + invite-user redeploy |
| `MOBILE_AND_PROFILE_FIX_REPORT.md` | 2026-04-23 | layout split + email-change reconciliation evidence |
| `IMPORT_MATCH_REPORT.md` | 2026-04-23 | CSV-name → clients.name authoritative mapping for the import |
| `IMPORT_PREVIEW.md` | 2026-04-23 | dry-run preview before the import committed |
| `IMPORT_REPORT_2026-04-23.md` | 2026-04-23 | post-import counts (28 transactions / 40 hours_log) + rollback recipe |
| `POST_IMPORT_AUDIT.md` | 2026-04-23 | per-row reconciliation showing 40 expected = 40 actual hours_log children |
| `POST_IMPORT_FIXES_REPORT.md` | 2026-04-23 | audit + search + DateInput summary |
| `EMAIL_FIX_REPORT.md` | 2026-04-18 | Resend sender configuration verification |
| `VERCEL_BUILD_FIX_REPORT.md` | 2026-04-22 | why Fix C (.npmrc) was the surgical option |
| `RUN_REPORT.md` | 2026-04-18 | first autonomous full-checklist run |
