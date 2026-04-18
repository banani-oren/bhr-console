# Improvements Batch 2 — Report

Run date: 2026-04-18.

## Commit SHAs

| Phase | SHA | Title |
|-------|-----|-------|
| A + B + schema groundwork C–F | `23083ec` | `fix+feat: reconcile Noa profile + add hourly_rate + seed service_types` |
| C | `43d368e` | `feat: service_types table + /services admin page` |
| D | `a41222e` | `feat: transactions 3-step wizard driven by service_types` |
| E | `f83ca43` | `feat: hourly time-log + branded PDF report + transaction from report` |
| F | `babb857` | `feat: bulk PDF agreement upload + LLM extraction` |
| G | (this commit) | `docs: spec + checklist + IMPROVEMENTS_2_REPORT` |

Auto-deploy: every commit landed on `main` and Vercel built against
`https://bhr-console.vercel.app`.

## Phase A — Noa reconciliation

Root cause: Auth user `930b6a93-c0a8-4038-986d-36e643dd171c` for
`noa@banani-hr.com` (`raw_user_meta_data.full_name='נועה פולק'`) existed
without a matching `public.profiles` row. The `handle_new_user` trigger
and its function body are installed correctly in prod (verified via
`pg_trigger` / `pg_proc`), so the trigger fired on the original invite
and created the row at the time. The most likely explanation is a prior
`profiles` delete (via the `delete-user` edge function, or a manual
cleanup) that did not also delete the `auth.users` row — leaving an
orphan auth user that subsequent re-invite attempts collided with via
`ON CONFLICT (id) DO NOTHING`, so no profile ever came back.

Fix: Inserted a profile row with `role='recruiter'`, `password_set=false`,
`full_name='נועה פולק'` via service role, then patched her `bonus_model`
to the 6-tier Noa spec from `BHR_CONSOLE_PROJECT.md`. She now appears
on `/users` and `/team` under the Hebrew role label `רכז/ת גיוס`.

## Phase B — `clients.hourly_rate`

- Migration: `alter table clients add column if not exists hourly_rate numeric;`
- Frontend: new input in the client edit dialog under the agreement
  section (`תעריף שעת עבודה (₪)`, type=number, nullable); list column
  `תעריף/שעה` inserted between `סוג הסכם` and `סטטוס`; Excel import now
  maps the `תעריף שעת עבודה` header to `hourly_rate`.
- `Client` TS type updated (`hourly_rate`, `time_log_enabled`,
  `agreement_storage_path`).

## Phase C — Service types + `/services`

- New table `service_types(id, name UNIQUE, display_order, fields JSONB,
  created_at, updated_at)` with RLS (authenticated SELECT, admin ALL).
- Seed inserted `השמה` (7 fields, display_order=1) matching the previous
  flat dialog, plus `דיווח שעות` (4 fields, display_order=5) used by the
  report→transaction action (Phase E).
- `/services` page (`src/pages/Services.tsx`) admin-only with a fields
  repeater covering all types in `FIELD_TYPE_LABELS`. Delete blocks
  when any `transactions.service_type_id` refers to the row.
- Sidebar: `שירותים` added between `צוות` and `ניהול משתמשים`.

Counts after run: 2 service types seeded.

## Phase D — Transaction wizard

- `transactions.service_type_id uuid references service_types(id)` and
  `transactions.custom_fields jsonb not null default '{}'` added;
  existing rows backfilled to `השמה`.
- `src/components/TransactionWizard.tsx` (new) encapsulates the 3-step
  flow; `src/pages/Transactions.tsx` rewritten to use it for both add
  and edit. Universal fields continue writing to dedicated columns;
  mirrored keys (`position_name`, `candidate_name`, `commission_percent`,
  `salary`, `net_invoice_amount`, `commission_amount`, `service_lead`)
  are written to both the dedicated columns and `custom_fields`; other
  keys (e.g. `retainer_amount`) live only in `custom_fields`.
- `/transactions` list gets a `סוג שירות` column between `לקוח` and
  `משרה`; filter dropdown switched to `service_types.name` values.

## Phase E — Hourly time-log

- Schema: `clients.time_log_enabled boolean`, new table
  `client_time_log_permissions(client_id, profile_id)` with RLS (admin
  write; read restricted to the profile or admin/administration),
  `hours_log.client_id uuid references clients(id)`,
  `hours_log.start_time time`, `hours_log.end_time time`. Existing
  `hours_log.client_id` backfilled from `client_name`.
- Clients edit dialog gains a `דיווח שעות` section: toggle + multi-select
  of eligible profiles; save wipes and re-inserts permissions rows.
- `src/pages/HoursLog.tsx` rewritten:
  - Non-admin → personal client-picker view limited to permitted,
    `time_log_enabled=true` clients.
  - Admin → tabs-per-client view + "הפקת דוח שעות" button.
  - New add-entry form uses `start_time`/`end_time` and computes hours
    to 2 decimals.
- `/hours/report` (admin-only) generates a branded A4 PDF via jspdf +
  jspdf-autotable. "צור עסקה מהדוח" opens the 3-step wizard on step 3
  pre-populated with service_type=`דיווח שעות`, period, totals, and
  `net_invoice_amount = hours_total * hourly_rate`.

Counts: 2 service types (השמה, דיווח שעות), 0 permissions assigned yet
(awaits admin configuration per client).

## Phase F — PDF agreement extraction

- Storage: bucket `client-agreements` created (private) with RLS —
  SELECT for admin+administration, ALL for admin only. Path scheme
  `<client_id>/<filename>.pdf`. Added `clients.agreement_storage_path`.
- Edge function `extract-agreement` deployed. Sends the raw PDF to
  Claude's Messages API as a `document` content block so scanned (OCR)
  and text PDFs use one code path and Hebrew RTL is native. Model
  `claude-sonnet-4-6` by default (overridable via
  `AGREEMENT_EXTRACTION_MODEL`). System prompt lives in
  `supabase/functions/extract-agreement/prompt.md`. Response is parsed
  as JSON (code fences stripped), reclassified to `document_kind='other'`
  if `matched_client_name` is null under `document_kind='agreement'`;
  fuzzy-matched against `clients.name` via Dice coefficient over 3-grams,
  returning up to 3 matches with score > 0.6.
- `/clients` admin gets `העלה הסכמים` button → multi-upload to
  `pending/<uuid>.pdf` → parallel extraction → per-PDF preview with an
  auto-picked match (top score > 0.85) or a dropdown of fuzzy matches /
  "create new client from PDF" / any-other-client fallback. Confirm moves
  the PDF to `<client_id>/<filename>.pdf`, sets
  `agreement_storage_path` + `agreement_file`, and merges extracted
  agreement terms into empty client columns only. Skip / close removes
  the pending temp file.
- Client edit dialog: `הורד PDF` generates a 60-second signed URL when
  `agreement_storage_path` is set.

Prerequisites: `ANTHROPIC_API_KEY` confirmed present in project secrets
(listed by the Management API `/v1/projects/<ref>/secrets` endpoint
alongside `RESEND_API_KEY`).

## Phase G — Documentation

- `BHR_CONSOLE_PROJECT.md`: schema diffs for `clients` / `transactions` /
  `hours_log`, new `service_types` + `client_time_log_permissions`
  tables, `/services` + `/hours/report` pages, 3-step wizard + custom
  fields semantics, time-log permissions model, PDF extraction
  pipeline + per-PDF cost estimate, `extract-agreement` edge function.
- `BHR_CONSOLE_CHECKLIST.md`: §19 Noa fix (resolved) with root cause;
  §20 Service types; §21 Transaction wizard; §22 Hourly billing; §23
  PDF agreements.

## Deferred

- **Full live extraction sweep on real contracts.** The edge function
  is deployed and callable, and the frontend UI works end-to-end, but
  extraction accuracy on the 224-PDF sample folder has not been run
  from this session — it requires Oren's local PDF folder which sits
  outside the repo. Recommended next step: drop 3 PDFs (one scanned,
  one text, one vendor-form) into `העלה הסכמים` on prod and verify
  classification + field extraction on each.
- **Recruiter + Administration dashboards live-render.** Still checked
  from the previous batch (§18). Batch 2 did not change that code path.
- **Re-upload update-path + custom agreement preservation** for the
  Excel import remains deferred (§17 last item from the prior batch).

## Notes

- No secrets were printed or committed.
- One migration file added: `supabase/migrations/20260418_2_improvements_batch2.sql`.
  It is idempotent (`IF NOT EXISTS` / `DROP POLICY IF EXISTS` / `ON CONFLICT DO NOTHING`).
- Bundle size crossed 500 kB after jspdf came in — the existing
  codeSplitting suggestion from Vite still applies if Oren wants to
  trim it down.

IMPROVEMENTS BATCH 2 COMPLETE
