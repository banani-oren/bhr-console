# Improvements batch 2 — Noa bug, agreements PDF extraction, hourly billing, configurable service types

Seven phases. Execute in the order listed. Each phase ends with: `npm run build` →
commit → push → wait ~90 s → live verification in Chrome via the magic-link admin
login from `CLAUDE_CODE_AUTONOMOUS.md`. Do not stop, do not ask, do not summarize
mid-run. Produce `IMPROVEMENTS_2_REPORT.md` at the end.

## Read first

1. `BHR_CONSOLE_PROJECT.md`
2. `BHR_CONSOLE_CHECKLIST.md`
3. `SECURITY_FIX_AND_ROLES.md` (role model — source of truth)
4. `IMPROVEMENTS_BATCH.md` (the prior batch, for established patterns)
5. This file.

## Hard rules

- English only for reasoning and commit messages.
- No deferrals — live-verify every change on the production URL.
- Never print or commit secrets.
- Update `BHR_CONSOLE_PROJECT.md` in the same commit as any spec-affecting change.
- RLS stays tight: do not loosen any policy when adding new tables or columns.

---

## Phase A — Diagnose and fix the `noa@banani-hr.com` invite bug

**Symptom:** Oren invited `noa@banani-hr.com` via `/users` twice, saw the success
prompt, but she is not in the users list. He suspects a leftover hard-coded row from
the BASE44-era migration.

**Diagnosis (run each step, record the answer in the report):**

```bash
# From .env.local, load SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL (do not print).

# 1. Does an auth user exist?
curl -sS "${VITE_SUPABASE_URL}/auth/v1/admin/users?filter=email:eq.noa@banani-hr.com" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"

# 2. Does a profiles row exist (by email or by name starting with נועה)?
curl -sS "${VITE_SUPABASE_URL}/rest/v1/profiles?or=(email.eq.noa@banani-hr.com,full_name.ilike.%25נועה%25)" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"

# 3. Is the handle_new_user trigger installed in prod and does it use ON CONFLICT DO NOTHING?
#    Query pg_trigger / information_schema via the Management API query endpoint.
```

**Branching fixes:**

- **If auth user exists but no profiles row:** the trigger's `ON CONFLICT DO NOTHING`
  swallowed a conflict. Insert the profile manually via service role with
  `id = <auth user id>`, `full_name = 'נועה ...'`, `email = 'noa@banani-hr.com'`,
  `role = 'recruiter'`. Reload `/users` — she should appear.
- **If a profiles row exists with a dangling `id` that doesn't match any auth.users row**
  (the suspected "hard-coded" case): delete that profile row. Re-invite via the
  edge function. Confirm both rows are created cleanly.
- **If both exist but she's filtered out of `/users`:** inspect the query. Likely
  cause is an implicit filter like `.eq('role', 'admin|administration|recruiter')`
  rejecting an outdated role value on her row (e.g. `role='employee'` leftover).
  Update her role to `recruiter` and fix the query to not silently drop unexpected
  role values.
- **If the `handle_new_user` trigger isn't installed in prod at all:** install it
  (see `BHR_CONSOLE_PROJECT.md` schema section), then clean up and re-invite.

**Live check:** after the fix, `/users` shows Noa with role `רכז/ת גיוס` (default).
Use the Users table (from the prior batch's Feature 2) to set her role to
`רכז/ת גיוס` if she needs to be a recruiter, and configure her bonus model on
`/team` with the 6-tier model from `BHR_CONSOLE_PROJECT.md`. Clean up any orphan
rows encountered during diagnosis.

Commit: `fix: reconcile noa@banani-hr.com auth/profile mismatch (Phase A)`.

---

## Phase B — Add `hourly_rate` to clients and surface it in the edit dialog

Feature 3 from Oren's list.

Schema:

```sql
alter table clients add column if not exists hourly_rate numeric;
```

Frontend:

- Add a new input in the client edit dialog under the agreement-terms section:
  label `תעריף שעת עבודה (₪)`, type `number`, step `1`, nullable.
- Column in `/clients` table: add `תעריף/שעה` between `סוג הסכם` and `סטטוס`,
  formatted as `₪1,234` or `—` if null.
- Update the TypeScript `Client` type.
- Update the Excel import from the prior batch: if a future Excel has a
  `תעריף שעת עבודה` column, map it to `hourly_rate`. If no such column, ignore.

Live check: set hourly rate on one imported client, reload, confirm it persists
and displays in the table.

Commit: `feat: clients.hourly_rate with edit dialog + list column (Phase B)`.

---

## Phase C — Configurable service types (Feature 5)

Goal: let the admin define service types and the fields that appear on the
Transaction dialog for each type. Seed with `השמה` (placement) using the current
dialog's fields as its config so nothing regresses.

### Schema

```sql
create table if not exists service_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_order integer not null default 0,
  fields jsonb not null default '[]'::jsonb,
  -- fields item shape:
  --   { "key": "position", "label": "משרה", "type": "text",
  --     "required": true, "options": null, "default": null, "width": "half" }
  -- type ∈ { "text", "textarea", "number", "currency", "percent",
  --         "date", "month", "year", "select", "boolean", "employee" }
  -- width ∈ { "full", "half" } (half = 2-column grid)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Seed השמה with the existing Transaction dialog's custom fields
-- (client, dates, invoice, billable, notes are universal, NOT in fields):
insert into service_types (name, display_order, fields) values
  ('השמה', 1, '[
    {"key":"position_name","label":"משרה","type":"text","required":true,"width":"half"},
    {"key":"candidate_name","label":"מועמד","type":"text","required":true,"width":"half"},
    {"key":"commission_percent","label":"עמלה %","type":"percent","required":true,"width":"half"},
    {"key":"salary","label":"שכר","type":"currency","required":true,"width":"half"},
    {"key":"net_invoice_amount","label":"סכום נטו","type":"currency","required":true,"width":"half"},
    {"key":"commission_amount","label":"עמלת ספק","type":"currency","required":false,"width":"half"},
    {"key":"service_lead","label":"ליד שירות","type":"employee","required":true,"width":"full"}
  ]'::jsonb);

alter table transactions add column if not exists service_type_id uuid references service_types(id);
alter table transactions add column if not exists custom_fields jsonb not null default '{}'::jsonb;

-- Backfill existing rows to the השמה service type.
update transactions set service_type_id = (select id from service_types where name='השמה')
  where service_type_id is null;

-- RLS: service_types is admin-read-write, everyone-read.
alter table service_types enable row level security;
create policy "service_types_auth_read" on service_types for select to authenticated
  using (true);
create policy "service_types_admin_write" on service_types for all to authenticated
  using ((select role from profiles where id = auth.uid()) = 'admin')
  with check ((select role from profiles where id = auth.uid()) = 'admin');
```

### `/services` admin page (new)

Add a new admin-only sidebar item `שירותים` between `צוות` and `ניהול משתמשים`.
Route: `/services`. Guarded with `RequireRole allow={['admin']}`.

The page lists existing service types (cards or a table) with display_order.
"Add service type" opens a dialog with:

- Name (text)
- Display order (number)
- Fields editor — a repeater where each row is:
  `key` (auto-generated from label, editable) · `label` (Hebrew) · `type` (select
  with the enum above) · `required` (checkbox) · `width` (half/full) · `options`
  (only for type=select — comma-separated list) · `default` (optional) · `🗑 remove`
  with an "Add field" button at the bottom.

Save persists to `service_types`. Delete service type shows a confirmation; block
delete if any transaction references that service_type_id (offer a merge-into-another
action if needed, but keep it simple for v1 — just block with a toast).

### Live check

- `/services` loads for admin only; forbidden for administration/recruiter.
- The seeded `השמה` row appears with 7 fields.
- Create a new service type `הד האנטינג` with different fields (e.g., `position`,
  `candidate`, `fee_amount currency`, `retainer_amount currency`).
- Re-open it, edit a field label, save, reload — change persists.

Commit: `feat: service_types table + /services admin page (Phase C)`.

---

## Phase D — Transaction dialog redesign (Feature 6)

The current single-flat-form dialog becomes a 3-step wizard driven by the selected
service type's `fields` config.

### Wizard steps

1. **Client** — searchable combobox populated from `clients` (RLS-respecting).
   Selecting a client pre-fills any universal fields that have a client default
   (commission_percent, warranty_days, payment_terms, payment_split from the
   client's agreement terms). Pre-fills are editable.
2. **Service type** — radio group or dropdown of `service_types` ordered by
   `display_order`.
3. **Details** — the dynamic form:
   - **Universal fields** (always shown, same as today): `entry_date`,
     `billing_month`, `billing_year`, `close_date`, `closing_month`,
     `closing_year`, `payment_date`, `payment_status`, `invoice_number`,
     `is_billable`, `notes`.
   - **Custom fields** (from `service_type.fields`) rendered in the half/full
     grid defined by `width`. `type=employee` is a combobox of active
     employees (profiles where role in recruiter/administration). `type=select`
     renders a combobox from `options`. `type=date/month/year/currency/percent/
     number/text/textarea/boolean` render obvious inputs. Required fields block
     submit until filled.

### Storage

- Universal fields continue to write to their dedicated columns on `transactions`.
- Custom fields write to `transactions.custom_fields` as a JSON object keyed by
  field `key`. Also mirror the well-known custom keys into their dedicated
  columns when present — specifically: `position_name`, `candidate_name`,
  `commission_percent`, `salary`, `net_invoice_amount`, `commission_amount`,
  `service_lead` — so existing dashboard/filter queries keep working without
  schema churn. For service types that introduce NEW keys (e.g. `retainer_amount`),
  those live only in `custom_fields`.

### Transactions list

- Show the service-type name as a new column `סוג שירות` between `לקוח` and
  the current columns (replacing the old free-text `service_type` string).
- Filters: keep the 6 existing filters, but change `סוג שירות` filter to be a
  dropdown of `service_types.name` values.
- Row edit opens the same 3-step wizard pre-filled (with the client and service
  type already chosen).

### Live check

- Click "+ הוספת עסקה" → step 1 shows client search; select a seeded QA client
  → step 2 shows at least `השמה` (and anything Phase C added); pick `השמה` →
  step 3 renders the 7 הshama fields + the universal ones. Save → row appears
  in `/transactions` with the correct `סוג שירות`.
- Add a second service type on `/services` with different fields; create a
  transaction with it; confirm the custom_fields JSON is populated and the
  row renders on `/transactions`.
- Edit an existing transaction → wizard opens pre-filled; saving without
  changes is a no-op (no diff in DB).

Commit: `feat: transactions 3-step wizard driven by service_types (Phase D)`.

---

## Phase E — Hourly-billing / time-log feature (Feature 4)

### Schema

```sql
alter table clients add column if not exists time_log_enabled boolean not null default false;

create table if not exists client_time_log_permissions (
  client_id uuid not null references clients(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, profile_id)
);

alter table hours_log
  add column if not exists client_id uuid references clients(id),
  add column if not exists start_time time,
  add column if not exists end_time time;

-- Backfill client_id from client_name where possible.
update hours_log hl set client_id = c.id
  from clients c
  where hl.client_id is null and lower(btrim(hl.client_name)) = lower(btrim(c.name));

-- RLS: client_time_log_permissions: admin full; authenticated read own rows.
alter table client_time_log_permissions enable row level security;
create policy "ctlp_admin_write" on client_time_log_permissions for all to authenticated
  using ((select role from profiles where id = auth.uid()) = 'admin')
  with check ((select role from profiles where id = auth.uid()) = 'admin');
create policy "ctlp_self_read" on client_time_log_permissions for select to authenticated
  using (profile_id = auth.uid()
         or (select role from profiles where id = auth.uid()) in ('admin','administration'));
```

### Clients page UI additions

In the client edit dialog, add a `דיווח שעות` section:

- Toggle: `הפעל דיווח שעות ללקוח זה`. Disabled toggle hides the rest.
- When enabled: multi-select combobox `עובדים מורשים לדיווח` populated with
  `profiles where role in ('administration','recruiter')`. Saves to
  `client_time_log_permissions` on save (delete removed, insert new).
- Note under the toggle: `דיווח השעות מתומחר לפי תעריף שעת העבודה של הלקוח`
  — if `hourly_rate` is null while `time_log_enabled` is true, show a warning
  on save but do not block.

### Hours page UI additions

When a user opens `/hours`:

- Admin: keep existing multi-client tabbed view.
- Recruiter / Administration: single personal view, with a client picker at the
  top (only clients where I am in `client_time_log_permissions` AND
  `time_log_enabled = true`).
- Time-entry form: `לקוח` (prefilled from the picker) · `תאריך` · `משעה`
  (start_time) · `עד שעה` (end_time) · `תיאור`. Submit inserts a row; `hours`
  is computed as `(end_time − start_time)` minutes / 60, rounded to two decimals,
  stored in the existing `hours` column for backward compatibility.
- Table shows: date, start→end, hours, description, total row at the bottom.

### Report generator (admin only)

New page `/hours/report`, sidebar item not required — link from `/hours` with a
button `הפקת דוח שעות`. Admin enters:

- Client (dropdown, only `time_log_enabled = true`).
- Period (from-date / to-date).
- Optionally: employees to include (default all permitted).

On "הפק דוח":

- Render a branded A4 PDF (client-side with `jspdf` + `jspdf-autotable`, or
  server-side edge function). Header: BHR Console logo placeholder + client
  name + period + issue date. Body: table rows (date, start→end, hours,
  description, employee). Footer: totals (hours · hourly_rate · ₪ total).
- Offer "שמור PDF" (download) and "צור עסקה מהדוח".

On "צור עסקה מהדוח":

- Open the transaction wizard pre-filled:
  - client = chosen client
  - service_type = `דיווח שעות` (create this service type if missing — add
    to the Phase C seed: fields = `[{ key: 'period_start', ... date, required },
    { key: 'period_end', ... date, required }, { key: 'hours_total',
    ... number, required }, { key: 'hourly_rate', ... currency, required }]`)
  - custom_fields pre-populated with period and totals
  - net_invoice_amount = `hours_total * hourly_rate`
  - close_date = period_end
  - closing_month/year derived from period_end

### Live check

- As admin, enable time log on a seeded client, set hourly_rate = 200, assign
  2 test employees.
- Sign in as one of those employees → `/hours` shows only that client in the
  picker; log a 09:00–12:30 entry → shows as 3.5 hours.
- As admin, open `/hours/report`, pick the client + period that includes the
  entry, "הפק דוח" → PDF downloads with the correct row. Click "צור עסקה
  מהדוח" → wizard opens with service_type=`דיווח שעות`, amount = 3.5 × 200 =
  ₪700. Save. Confirm the transaction appears in `/transactions`.
- Clean up seeded rows.

Commit: `feat: hourly time-log + branded PDF report + transaction from report (Phase E)`.

---

## Phase F — PDF agreement upload with LLM extraction (Feature 2)

**Prerequisites:**

- An Anthropic API key. Check `.env.local` for `ANTHROPIC_API_KEY`. If not
  present, halt Phase F and write a clear note in the phase report telling
  Oren to add `ANTHROPIC_API_KEY=sk-ant-...` to `.env.local` AND to the
  Supabase edge-function secrets (`npx supabase secrets set
  ANTHROPIC_API_KEY=... --project-ref szunbwkmldepkwpxojma`). Do not attempt to
  fabricate or proceed without it.

### Storage

- Create (via Management API) a Supabase Storage bucket `client-agreements`,
  private (not public-read), with RLS:
  - Read: admin + administration only.
  - Write: admin only.
- Path convention: `client-agreements/<client_id>/<original-filename>.pdf`.
- Add column: `alter table clients add column if not exists agreement_storage_path text;`

### Edge function `extract-agreement`

**Do not use local text extraction (pdf-parse, pdfplumber, etc.).** A substantial
fraction of Oren's contracts are scanned image PDFs (verified against his live
folder), and pdfplumber also reverses Hebrew characters on text PDFs. Both
problems are bypassed by handing the raw PDF directly to Claude as a `document`
content block — Claude's API handles OCR and RTL Hebrew natively in one code
path.

Design:

- POST `{ storage_path }` — the path within the `client-agreements` bucket.
- Service-role client downloads the object bytes.
- Base64-encode and send to Anthropic's Messages API:
  ```ts
  const body = {
    model: Deno.env.get('AGREEMENT_EXTRACTION_MODEL') ?? 'claude-sonnet-4-6',
    max_tokens: 1024,
    temperature: 0,
    system: SYSTEM_PROMPT,          // imported from prompt.md as a constant
    messages: [{
      role: 'user',
      content: [
        { type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf }
        },
        { type: 'text', text: 'Extract per the system prompt. Return ONLY the JSON object.' }
      ]
    }]
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  ```
- The SYSTEM_PROMPT is the contents of
  `supabase/functions/extract-agreement/prompt.md` (already written, versioned in
  the repo, tuned to Banani HR's contract patterns). Parse it into a string at
  build time or embed it inline — either works.
- Parse Claude's reply as JSON; strip code fences if present; validate schema.
  Reject `document_kind="agreement"` with null `matched_client_name` — treat as
  extraction failure and surface to the admin.

Returns `{ extracted, document_kind, fuzzy_matches: [{client_id, name, score}, ...] }`.
Fuzzy matching: Dice coefficient of character trigrams against `clients.name`,
after stripping whitespace. Return top 3 with score > 0.6.

### Client matching & confirm UI

On the admin-only `/clients` page, add `העלה הסכמים` button (separate from the
Excel import). Flow:

1. File picker accepts multiple `.pdf` files.
2. For each PDF in parallel (with progress): upload to Storage (temp path
   `pending/<uuid>.pdf`), call `extract-agreement`, append to a preview list.
3. Preview dialog per PDF shows:
   - Filename
   - Extracted fields
   - Matched client (pre-selected if top score > 0.85, else dropdown of the
     top 3 fuzzy matches + option to pick any other client or create a new one).
   - Action buttons: `אשר`, `דלג`, `פתח PDF`.
4. On `אשר`: move the PDF from `pending/` to `client-agreements/<client_id>/
   <filename>.pdf`, update `clients.agreement_storage_path` and the agreement
   fields (same non-overwrite-populated rule as the Excel import), set
   `agreement_file = <filename>.pdf`.
5. Bulk summary toast at the end: `X עודכנו · Y דולגו · Z שגיאות`.

### Client detail view

- Add a `קבצי הסכם` section in the client edit dialog listing the attached PDF
  with a download link (signed URL via storage.createSignedUrl for 60 seconds).
- Re-upload replaces the existing file.

### Extraction prompt — already tuned from real samples

`supabase/functions/extract-agreement/prompt.md` has already been written based
on a sample of Oren's actual contracts (CIVILENG text PDF, BSH + חינוך לפסגות
scanned PDFs, vendor-form false positives). It encodes:

- Hebrew phrasing patterns for commission %, salary basis, warranty,
  payment terms, advance, exclusivity, non-solicit.
- A `document_kind` field so vendor-onboarding PDFs are classified and
  skipped (don't mistake them for agreements).
- Anti-hallucination rules including "never output 039230214 as company_id"
  (that's Banani HR's own number — would cause every extraction to claim the
  client is Banani HR).
- A per-PDF token-cost estimate (~$0.015–$0.025 with Sonnet 4.6).

Use this file as the system prompt verbatim. If extraction quality is poor on
a specific contract variant, iterate on that file and redeploy — do not change
the edge-function code for prompt tweaks.

During live verification, sample at least one scanned PDF (e.g. BSH) and one
text PDF (e.g. CIVILENG) to confirm both paths work through the same
Claude-native pipeline.

### Live check

- Upload 3 PDFs from the sample folder.
- Preview dialog shows each with extracted fields; top-match client is auto-selected
  for all three (assuming the clients are already imported).
- Confirm all three → verify `/clients` shows updated agreement terms and the PDF
  is downloadable via signed URL.
- Re-run upload with the same PDFs → preview shows "already attached" state or
  warns before overwriting.

Commit: `feat: bulk PDF agreement upload + LLM extraction (Phase F)`.

---

## Phase G — Spec and checklist updates

Update `BHR_CONSOLE_PROJECT.md`:

- New columns, tables, storage bucket, edge function.
- New routes (`/services`, `/hours/report`).
- Transaction wizard (3 steps) and how `custom_fields` is used.
- Time-log permissions model.
- PDF extraction pipeline and cost note (LLM tokens per PDF).

Extend `BHR_CONSOLE_CHECKLIST.md`:

- §19 Noa fix (resolved) with root-cause note.
- §20 Service types — CRUD works, seeded השמה correct, RLS blocks non-admin writes.
- §21 Transaction wizard — 3 steps, dynamic fields, edit flow.
- §22 Hourly billing — client toggle + permissions, time entry with start/end,
  report PDF, transaction-from-report.
- §23 PDF agreements — bucket policy, extraction accuracy on sample PDFs,
  non-overwrite rule, signed URL download.

Each new line is a pass/fail live check.

## Termination

1. Print all phase commit SHAs.
2. Write `IMPROVEMENTS_2_REPORT.md` with per-phase summary:
   - Noa root cause + fix
   - Counts: service types created, clients updated via hourly rate, time-log
     permissions assigned, test transactions created, PDFs processed.
   - Screenshots in `./qa-screenshots/batch2/` of: new `/services` page,
     transaction wizard all 3 steps, hours-log report PDF, PDF-upload preview
     dialog.
   - Any deferred items (e.g., Phase F blocked if `ANTHROPIC_API_KEY` missing)
     clearly flagged.
3. Print `IMPROVEMENTS BATCH 2 COMPLETE` and stop.
