# Import agreement terms from Excel → `clients` table

Execute end-to-end, four phases: match, preview/gate, import, verify.
Do not stop between phases unless the gate condition triggers.
Report in `IMPORT_AGREEMENTS_REPORT.md`.

## Read first

1. `BHR_CONSOLE_PROJECT.md` — schema reference (especially the `clients` table).
2. `IMPORT_AGREEMENTS_MATCH_REPORT.md` — confirmed manual mappings (if present).
3. This file.

## Hard rules

- **English only** for all commit messages and script output.
- Never print secrets. Load `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
  from `.env.local`.
- **Target table: `clients`** — the `agreements` table is DEPRECATED.
  Do not read from or write to it.
- **Non-overwrite rule:** only update DB columns that are currently `null`,
  empty string, or `false` (for booleans). Never clobber a value Oren
  has already entered manually.
- This is a DATA import. No code changes, no `git push`.
- Idempotent: if run again, columns already filled are left untouched.

## Source

Excel file:
```
C:\Users\Oren\Banani HR\Shared Folders - מסמכים\BANANI HR\CLAUDE\ניהול עסק BHR\מעקב השמות 2026.xlsx
```
Sheet: `כרטיסי לקוחות` (55 client cards in vertical format).

Script to run:
```bash
cd "C:\Users\Oren\BHR Console\App Dev"
node scripts/import-agreements.mjs --dry-run
node scripts/import-agreements.mjs              # live run (Phase 3 only)
```

## Column mapping (Excel → `clients` DB column)

| Excel field      | DB column            | Transform                                      |
|------------------|----------------------|------------------------------------------------|
| `סוג הסכם`       | `agreement_type`     | verbatim                                       |
| `אחוז עמלה`      | `commission_percent` | × 100 (0.9 → 90, 1 → 100, 0.8 → 80)          |
| `אחוז עמלה`      | `salary_basis`       | `"{n} משכורות"` text (e.g. 0.9 → "0.9 משכורות")|
| `תקופת אחריות`   | `warranty_days`      | parse integer from "60 ימים" → 60             |
| `תנאי תשלום`     | `payment_terms`      | verbatim                                       |
| `חלוקת תשלום`    | `payment_split`      | verbatim                                       |
| `מקדמה`          | `advance`            | verbatim (string, e.g. "1,500 ₪")             |
| `בלעדיות`        | `exclusivity`        | "כן" → true                                   |
| `תשלום שעתי`     | `hourly_rate`        | numeric (400 → 400)                            |
| `ח.פ.`           | *(skip)*             | `clients.company_id` is already populated      |

## Phase 1 — Client matching

Run `node scripts/import-agreements.mjs --dry-run` and capture the full output.

The script uses **Dice coefficient bigram fuzzy matching** with threshold 0.4.
Cards that fall below the threshold are listed as `NO MATCH`.

For each `NO MATCH` card:
1. **Check `IMPORT_AGREEMENTS_MATCH_REPORT.md`** (if it exists) — if the
   Excel name appears in the confirmed mappings table, use that client directly
   by patching the script's `MANUAL_OVERRIDES` map (see below) and re-running.
2. If no manual mapping exists, search DB with:
   ```bash
   curl -sS "${VITE_SUPABASE_URL}/rest/v1/clients?select=id,name&name=ilike.*TERM*" \
     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
   ```
   Try the first 3–4 Hebrew characters of the Excel name as `TERM`.
3. Collect all still-unresolved names and list them in the Phase 2 gate.

### Adding manual overrides to the script

Open `scripts/import-agreements.mjs`. Before the `for (const card of cards)` loop,
inject a `MANUAL_OVERRIDES` map keyed by the exact Excel card name, valued by the
target `clients.id`:

```js
// MANUAL_OVERRIDES: Excel card name → exact clients.id
// Populated by Phase 1 resolution (see IMPORT_AGREEMENTS_MATCH_REPORT.md)
const MANUAL_OVERRIDES = {
  'BSH': 'uuid-from-db',
  'IDEEZ': 'uuid-from-db',
  // … etc
}
```

Then, inside the loop, before `bestMatch()`:
```js
const overrideId = MANUAL_OVERRIDES[card.name]
const matchedClient = overrideId
  ? clients.find(c => c.id === overrideId) ?? null
  : null
const { client, score } = matchedClient
  ? { client: matchedClient, score: 1 }
  : bestMatch(card.name, clients)
```

## Phase 2 — Preview & gate

Write `IMPORT_AGREEMENTS_PREVIEW.md`:

```
Total Excel cards parsed: 55
Confidently matched (score ≥ 40%): N  [list with Excel name → DB name + score]
Via manual override: M              [list]
Still unmatched: X                  [list with top-3 candidates + scores]
Fields that would be written: [breakdown per matched card]
```

**No gate on unmatched cards.** Unmatched cards are silently skipped.
Log them in the report but proceed automatically to Phase 3.
Oren has confirmed: cards without a DB match should be skipped for now.

## Phase 3 — Live import

Run `node scripts/import-agreements.mjs` (no `--dry-run`).

Observe output line by line. On any `❌ Update error`, note the client name
and error message — do not abort the entire run, let it continue to the end,
then report errors in `IMPORT_AGREEMENTS_REPORT.md`.

## Phase 4 — Verify live

Log in as admin via magic-link (see `CLAUDE_CODE_AUTONOMOUS.md`).
Open `https://app.banani-hr.com/clients`.

1. Pick 5 clients from the matched list. Open each client's edit dialog.
2. Verify that `agreement_type`, `commission_percent`, `warranty_days`, and
   any other imported fields now show the expected values.
3. Verify that clients whose DB fields were already populated still have
   their original values (non-overwrite rule held).

Take 2–3 representative screenshots and save to `./qa-screenshots/import-agreements/`.

## Termination

Write `IMPORT_AGREEMENTS_REPORT.md`:
- Date / time of run.
- Total cards: parsed / matched (fuzzy + manual) / skipped (already-set) / unmatched / errors.
- Per-field breakdown: how many clients had each field filled in for the first time.
- Any update errors (client name + error).
- Verification results (which clients were spot-checked, what was seen).
- Screenshot path.
- **Rollback recipe** — the following sets all imported fields back to NULL
  on every client whose `company_id` matches an imported card's ח.פ. value.
  For a targeted rollback by client name:
  ```bash
  # Example: reset agreement fields on one client
  curl -sS -X PATCH "${VITE_SUPABASE_URL}/rest/v1/clients?id=eq.<CLIENT_ID>" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d '{"agreement_type":null,"commission_percent":null,"salary_basis":null,"warranty_days":null,"payment_terms":null,"payment_split":null,"advance":null,"exclusivity":false,"hourly_rate":null}'
  ```
  A full rollback script (all 55 clients) can be generated from the report's
  matched-clients list.

Print `AGREEMENT IMPORT COMPLETE` and stop.
