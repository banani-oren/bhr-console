# IMPORT_AGREEMENTS_FROM_EXCEL — execution report

This report covers two runs of `scripts/import-agreements.mjs` on
2026-04-26 against the live Supabase project `szunbwkmldepkwpxojma`.
The second run was an idempotency check after the spec was updated
to remove the unmatched-card gate.

## Run 1 — initial import (2026-04-26 ~20:32)

### Counts

| Bucket | Count |
|---|---:|
| Excel cards parsed | 55 |
| Fuzzy-matched (Dice ≥ 40%) | 23 |
| Manual override | 11 |
| **Total updates written** | **34** |
| Already-set (skipped non-overwrite) | 0 |
| Unmatched (no DB candidate / ambiguous, skipped) | 21 |
| Update errors | 0 |

### Per-field write breakdown

The `cardToFields()` builder produces up to 9 columns per card. Non-overwrite
is enforced at the row level — the script only fills DB columns currently
null/empty/false.

| DB column | Cards that contributed |
|---|---|
| `agreement_type` | 34 |
| `commission_percent` | 30 |
| `salary_basis` | 30 |
| `warranty_days` | 32 |
| `payment_terms` | 11 |
| `payment_split` | 7 |
| `advance` | 3 |
| `exclusivity` | 6 |
| `hourly_rate` | 1 (קסטרו / ח.י. פתרונות חכמים — 400 ₪/h) |

### Group C — fuzzy-matched-to-WRONG-target, fixed before live

Three cards passed the 40% threshold but pointed at the wrong DB row.
Re-routed via `MANUAL_OVERRIDES` to the correct target:

| Excel name | Fuzzy picked (wrong) | Forced via override (correct) |
|---|---|---|
| `ניוטון` | צ'מפיון מוטורס (50%) | `2b3ad026…` ניוטון מרכזים חינוכיים בע"מ |
| `קבוצת גורמה` | קבוצת זאפ (50%) | `e75d5ffb…` גורמה ארוחות בע"מ |
| `קבוצת שליו` | קבוצת זאפ (53%) | `e3e9cad5…` שלו ובניו בע"מ |

## Run 2 — idempotent re-run (2026-04-26 ~21:47, after spec update)

### Counts

| Bucket | Count |
|---|---:|
| Excel cards parsed | 55 |
| **Updates written** | **0** |
| **Skipped (already set — non-overwrite rule held)** | **34** |
| Unmatched (silently skipped per updated spec) | 21 |
| Update errors | 0 |

### What this proves

- **The non-overwrite rule works.** Re-running the script does not touch
  any of the 34 previously-imported clients. No clobbering of any value
  Oren may have manually edited since the first run.
- **The script is fully idempotent.** Safe to re-run as a no-op.
- **The new no-gate behavior works.** The 21 unmatched cards no longer
  trigger a STOP — they are listed in the trailing log and the run completes
  cleanly with `errors=0`.

## Unmatched (21, unchanged across both runs)

```
Group A (no DB candidate at all — likely brand-new clients)
  IDEEZ, IDIGITAL, LAYAM, PWC, R2M, WOBI, iplan,
  אבני דרך, איזי, אסותא, דומינוס, דורון ברדה - פיסגה,
  דר. פישר, הכרם משקאות חריפים, הקואליציה הישראלית לטראומה,
  לידר, מדיטרנד, קר פרי, קרפרי

Group B (ambiguous — multiple DB candidates)
  קטה יזמות   (קטה התחדשות עירונית | קטה חברה לבנייה)
  שבירו       (3 רמי שבירו entities)
```

These are listed in `IMPORT_AGREEMENTS_UNMATCHED.md` with their top-3
fuzzy candidates for follow-up. They stay skipped until either the
underlying client is created in `clients` or a mapping is added to
`MANUAL_OVERRIDES`.

## Verification

### Service-role re-read of all 34 imported clients (after Run 2)

```text
imported_clients_with_agreement_type = 34 of 34
missing_agreement_type               = 0
```

Sample (first 5):
```
BSH                              | type=השמה | comm=100 | warranty=60
civieng                          | type=השמה | comm=100 | warranty=60
אגד חברה לתחבורה בע"מ            | type=גיוס | comm=80  | warranty=60
איל מקיאג'                       | type=השמה | comm=90  | warranty=null
אלדר השקעות                      | type=השמה | comm=90  | warranty=90
```

All 34 imported rows still hold their first-run values. No drift.

### Browser spot-check (first run, 2026-04-26)

Admin magic-link login → `/clients` → opened `ניוטון מרכזים חינוכיים בע"מ`
edit dialog. Imported fields rendered exactly:

```
agreement_type     = השמה
commission_percent = 100
salary_basis       = "1 משכורות"
warranty_days      = 60
payment_terms      = "שוטף + 60"
advance            = "3,500 ₪"
```

Pre-existing fields (name, ח.פ. 512166885, address, contact) preserved
untouched — confirming the non-overwrite rule held for fields the
import didn't touch.

## Files produced

- `IMPORT_AGREEMENTS_MATCH_REPORT.md` — manual override audit + suspect-fuzzy review
- `IMPORT_AGREEMENTS_UNMATCHED.md` — 21 still-unmatched cards with top-3 candidates
- `IMPORT_AGREEMENTS_PREVIEW.md` — preview (regenerated for Run 2)
- `IMPORT_AGREEMENTS_REPORT.md` — this file
- `scripts/import-agreements.mjs` — `MANUAL_OVERRIDES` map populated with 11 mappings

## Rollback recipe

Per-client rollback (replace `<CLIENT_ID>`):

```bash
curl -sS -X PATCH "${VITE_SUPABASE_URL}/rest/v1/clients?id=eq.<CLIENT_ID>" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agreement_type":null,"commission_percent":null,"salary_basis":null,"warranty_days":null,"payment_terms":null,"payment_split":null,"advance":null,"exclusivity":false,"hourly_rate":null}'
```

Full rollback for all 34 imported rows:

```bash
IDS=(
  # Manual overrides (11)
  fa7922ee-3fdb-4d5d-b86e-157de7d0ceac  # אגד
  e5594dee-e41b-40a6-be9b-e0419e675638  # אלטמן
  9cace69b-6ea0-4446-82ed-be9ede33c06d  # קבוצת גינדי
  480a918b-e9c4-48db-9ca8-647e85e37612  # קבוצת זאפ (ZAP)
  bfa6c0f5-a39e-42dd-8521-22f80d8a4a6c  # CAL (כאל)
  23f8d813-0ea8-4bd9-b095-c456b906f334  # קוואליטי
  0ac8fe2c-0969-40bb-9c45-9cf221a00240  # ריבאר (REBAR)
  b105e345-ad27-42bf-adee-a6b8fc20f361  # שילב
  2b3ad026-0ae7-475f-83be-ea9782554e23  # ניוטון מרכזים
  e75d5ffb-9fd6-4d80-8938-55ce7ef85324  # גורמה ארוחות
  e3e9cad5-f3cc-4966-9e26-dfab212e8139  # שלו ובניו
  # Fuzzy hits (23)
  f7d235f3-8f7a-49d8-8614-44ab0b9fa37b  # BSH
  ae64768e-f68c-40b2-9290-8615515ec48c  # civieng (CIVILENG)
  701d5498-659e-45e0-9d47-1f260b5e4397  # איל מקיאג'
  5e033d54-8efd-40d4-8e48-34dee7e33e91  # אלדר השקעות (אלדר)
  cfa160a5-4a2d-4e74-8c10-23b991fd8e98  # ח.י טכנולוגיות (ברן)
  556fe61c-5ab6-49e9-8acf-0f7aa111ba89  # בשביל הזהב
  c16008eb-3aff-4320-8ab2-ca1fd90fc56a  # גל מכשירי שמיעה
  1737e9e9-4cf0-4bbb-9e82-4f049920c5b0  # דיפלומט מפיצים (דיפלומט)
  75d2fe85-08cb-471a-8603-9d2671f957d3  # דלק מוטורס
  903f5609-ba24-406a-bc31-026aaee948c3  # היפוסופט
  833b5693-b29e-4b6f-8288-80d02856c84c  # עמותת חינוך לפסגות (חינוך לפסגות)
  5679ac47-6974-4b67-9666-40e0347781fc  # דורון טיקוצקי (טיקוצקי)
  670e84d1-127d-4e26-b0d0-63de45667d3c  # טמפו משקעות (טמפו)
  4657a819-eb2c-42e0-af3d-933298938c8a  # ישראייר תעופה (ישראייר)
  acb2a4b6-7d73-4ac4-848f-6c3b7a57fde1  # גיאו מוביליטי (כלמוביל)
  95c87f3c-90e5-476d-ba65-7ad91434e94f  # מאסטר פוד
  dc7efa97-eed4-40d4-b66b-f60aced56164  # מטרופוליס (פפא)
  617aaa11-2b42-4c4b-8845-6cc066cd346e  # עמותת שבט הנובה (עמותת נובה)
  19c5fb6b-4746-4220-94c3-ef0fcca3d326  # צ'מפיון מוטורס
  5ebfecf1-6155-4ad2-8b0d-53847930fd26  # ח.י. פתרונות חכמים (קסטרו)
  63c44093-0bca-40e0-9dc1-8de1a1a26f50  # קרייזי ליין
  2a1b952f-a268-4826-b490-9a0de2498020  # שיפוצים פלוס
  3f8add98-45de-4030-a17c-bec9299552a7  # שיבומי אסטרטגיה
)
PAYLOAD='{"agreement_type":null,"commission_percent":null,"salary_basis":null,"warranty_days":null,"payment_terms":null,"payment_split":null,"advance":null,"exclusivity":false,"hourly_rate":null}'
for id in "${IDS[@]}"; do
  curl -sS -X PATCH "${VITE_SUPABASE_URL}/rest/v1/clients?id=eq.$id" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" > /dev/null
done
```

AGREEMENT IMPORT COMPLETE
