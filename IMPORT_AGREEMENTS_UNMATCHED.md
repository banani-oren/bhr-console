# IMPORT_AGREEMENTS_FROM_EXCEL — unresolved cards

21 Excel cards have no confident DB target. Per the spec gate condition,
the live import is **STOPPED** until a decision is made on each row below.

To resolve a row: pick a `clients.id` (or write `SKIP`) and add it to the
`MANUAL_OVERRIDES` map in `scripts/import-agreements.mjs`. Then re-run
`node scripts/import-agreements.mjs --dry-run` and confirm 0 unmatched
before running without `--dry-run`.

Date: 2026-04-26

## Group A — no DB candidate at all (probably new clients)

These don't appear in `clients` under any spelling I could find. Either:
- The client exists but under a name I haven't searched (provide the DB id), or
- The client is genuinely new (write `SKIP` — agreement terms can't import without a row).

| Excel name | Top-3 fuzzy candidates (all below threshold) | Decision |
|---|---|---|
| `IDEEZ` | BSH (0%), CAL (5%), Miniso (5%) | _____ |
| `IDIGITAL` | CAL (7%), all others < 5% | _____ |
| `LAYAM` | BSH (0%), … | _____ |
| `PWC` | BSH (0%), … | _____ |
| `R2M` | BSH (0%), … | _____ |
| `WOBI` | חן בנימין אלדד c.jobs (11%), … | _____ |
| `iplan` | BSH (0%), … | _____ |
| `אבני דרך` | שלו ובניו בע"מ (27%), … | _____ |
| `איזי` | קרייזי ליין בע"מ (29%), … | _____ |
| `אסותא` | אלדר משכנתאות בע"מ (22%), … | _____ |
| `דומינוס` | ח.י. פתרונות חכמים (21%), … | _____ |
| `דורון ברדה - פיסגה` | אורון נדל"ן בע''מ (33%), דורון טיקוצקי עורכי דין (26%) | _____ |
| `דר. פישר` | ח.י שרות ולוגיסטיקה (20%), ישראייר (17%) | _____ |
| `הכרם משקאות חריפים` | ח.י. פתרונות חכמים (29%), טמפו משקעות (22%) | _____ |
| `הקואליציה הישראלית לטראומה` | אלטמן בריאות (26%), CAL (25%) | _____ |
| `לידר` | עידן הדרכה בע"מ (29%), אלייד לוגיסטיקה (21%) | _____ |
| `מדיטרנד` | דיבור מדיה בע"מ (25%), י.שטרן הנדסה (22%) | _____ |
| `קר פרי` | קרייזי ליין בע"מ (27%), כלפרופיל (18%) | _____ |
| `קרפרי` | (same as above; might be a duplicate of `קר פרי`) | _____ |

## Group B — multiple DB candidates, ambiguous

| Excel name | Candidates | Decision |
|---|---|---|
| `קטה יזמות` | `93173c4b…` קטה התחדשות עירונית · `81977b58…` קטה חברה לבנייה | _____ |
| `שבירו` | `619c07cf…` רמי שבירו החברה לניהול נכסים מניבים בע"מ · `db8ab81d…` רמי שבירו הנדסה וחן ואיתי גינדי ישראל · `4ffaf184…` רמי שבירו, הנדסת בניה והשקעות בע"מ | _____ |

## Group C — fuzzy match accepted but probably WRONG

These passed the 40% threshold but the matcher chose the wrong target.
**Without intervention, the import will write Excel agreement terms onto
the wrong DB row.** Confirm or override.

| Excel name | Auto-picked (≥ 40%) | Better candidate (probably correct) | Decision |
|---|---|---|---|
| `ניוטון` | `19c5fb6b…` צ'מפיון מוטורס (50%) | `2b3ad026-0ae7-475f-83be-ea9782554e23` ניוטון מרכזים חינוכיים בע"מ | _____ |
| `קבוצת גורמה` | `480a918b…` קבוצת זאפ (50%) | `e75d5ffb-9fd6-4d80-8938-55ce7ef85324` גורמה ארוחות בע"מ | _____ |
| `קבוצת שליו` | `480a918b…` קבוצת זאפ (53%) | `e3e9cad5-f3cc-4966-9e26-dfab212e8139` שלו ובניו בע"מ | _____ |

## Next step

Fill in the `Decision` column above (DB id, or `SKIP`), then add the
non-`SKIP` mappings to `MANUAL_OVERRIDES` in
`scripts/import-agreements.mjs`. Re-run the dry-run; when it reports
**0 unmatched**, the live import can proceed.
