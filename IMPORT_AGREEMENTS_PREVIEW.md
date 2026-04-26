# IMPORT_AGREEMENTS_FROM_EXCEL — Phase 2 preview (re-run)

Date: 2026-04-26 (second run, same day as first import)
Source: `מעקב השמות 2026.xlsx` sheet `כרטיסי לקוחות`
Script: `scripts/import-agreements.mjs --dry-run`

## Counts

| Bucket | Count |
|---|---:|
| Total Excel cards parsed | 55 |
| Confidently matched (fuzzy ≥ 40%) | 23 |
| Via manual override | 11 |
| **Already-set rows (skipped, non-overwrite rule)** | **34** |
| Would write to DB | 0 |
| Unmatched (silently skipped per updated spec) | 21 |

## Gate

**No gate** — per the updated spec ("No gate on unmatched cards. Unmatched
cards are silently skipped. Log them in the report but proceed automatically
to Phase 3.").

The 34 fuzzy/manual-matched cards are now **all already-set** in the DB
(from the first run). The non-overwrite rule fully short-circuits each one,
so nothing gets touched. The 21 unmatched cards remain unmatched.

This run is a clean idempotency check: re-running the import after a
successful first pass should produce 0 writes and 0 errors. Confirmed.

## What would be written

Nothing. The first run on 2026-04-26 already wrote the 34 confident matches.
See `IMPORT_AGREEMENTS_REPORT.md` for the full first-run breakdown.

## Unmatched (21, unchanged from first run)

```
Group A (no DB candidate at all)
  IDEEZ, IDIGITAL, LAYAM, PWC, R2M, WOBI, iplan,
  אבני דרך, איזי, אסותא, דומינוס, דורון ברדה - פיסגה,
  דר. פישר, הכרם משקאות חריפים, הקואליציה הישראלית לטראומה,
  לידר, מדיטרנד, קר פרי, קרפרי

Group B (ambiguous — multiple DB candidates)
  קטה יזמות   (קטה התחדשות עירונית | קטה חברה לבנייה)
  שבירו       (3 רמי שבירו entities)
```

These will continue to be silently skipped on every re-run until either
(a) the underlying client is created in `clients`, or (b) a manual mapping
is added to `MANUAL_OVERRIDES` in the script.
