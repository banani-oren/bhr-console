# IMPORT_AGREEMENTS_FROM_EXCEL — manual mapping audit

Source: `מעקב השמות 2026.xlsx` sheet `כרטיסי לקוחות` (55 cards)
DB: `clients` (79 rows at run time)
Fuzzy threshold: Dice coefficient ≥ 0.40 on character bigrams
Date: 2026-04-26

## Resolution summary

| Bucket                                             | Count |
|----------------------------------------------------|-------|
| Fuzzy-matched (score ≥ 40%)                        | 26    |
| Manual override (DB ilike found a confident match) | 8     |
| Still unmatched (need user input)                  | 21    |
| **Total cards parsed**                             | **55**|

## Manual overrides — confirmed via DB ilike search

These mappings are encoded in `scripts/import-agreements.mjs` `MANUAL_OVERRIDES`.

| Excel name | DB id | DB name | Why |
|---|---|---|---|
| `אגד` | `fa7922ee-3fdb-4d5d-b86e-157de7d0ceac` | אגד חברה לתחבורה בע"מ | Single ilike hit; obvious shortform of the same company. |
| `אלטמן` | `e5594dee-e41b-40a6-be9b-e0419e675638` | אלטמן בריאות שותפות כללית | Single hit; only "אלטמן" in DB. |
| `גינדי` | `9cace69b-6ea0-4446-82ed-be9ede33c06d` | קבוצת גינדי חן ואיתי גינדי בע"מ | Two hits but the other ("רמי שבירו…") is a different family; "קבוצת גינדי" is the canonical "גינדי". |
| `ZAP` | `480a918b-e9c4-48db-9ca8-647e85e37612` | קבוצת זאפ | English ZAP = Hebrew זאפ. |
| `כאל` | `bfa6c0f5-a39e-42dd-8521-22f80d8a4a6c` | CAL כרטיסי אשראי לישראל בע"מ | "כאל" is the Hebrew transliteration of CAL (the credit-card company). |
| `קואליטי` | `23f8d813-0ea8-4bd9-b095-c456b906f334` | קוואליטי סוכנות לביטוח (2017) בע"מ | One hit; spelling variant (one ו vs two). |
| `REBAR` | `0ac8fe2c-0969-40bb-9c45-9cf221a00240` | ריבאר בעמ | "REBAR" → "ריבאר" transliteration; only "ריבאר" in DB. |
| `שילב` | `b105e345-ad27-42bf-adee-a6b8fc20f361` | שילב שיווק ישיר לבית היולדת בע"מ | One hit; obvious shortform. |

## Unmatched

See `IMPORT_AGREEMENTS_UNMATCHED.md` for the 21 cards that have either no DB candidate or are ambiguous between multiple candidates. Those need user input before Phase 3 can run.

## Fuzzy matches (for reference, not edited)

The fuzzy matcher chose these without help — kept for traceability:

```
100%  BSH                   → BSH
 77%  CIVILENG              → civieng
100%  איל מקיאג'            → איל מקיאג'
 50%  אלדר                  → אלדר השקעות
 78%  ברן - טכנולוגיות      → ח.י טכנולוגיות
100%  בשביל הזהב            → בשביל הזהב
100%  גל מכשירי שמיעה       → גל מכשירי שמיעה
 57%  דיפלומט               → דיפלומט מפיצים בע"מ
100%  דלק מוטורס            → דלק מוטורס
100%  היפוסופט              → היפוסופט
 83%  חינוך לפסגות          → עמותת חינוך לפסגות
 50%  טיקוצקי               → דורון טיקוצקי עורכי דין
 40%  טמפו                  → טמפו משקעות בע"מ
 50%  ישראייר               → ישראייר תעופה ותיירות בע"מ
 40%  כלמוביל               → גיאו מוביליטי בע"מ
100%  מאסטר פוד             → מאסטר פוד
 42%  מטרופוליס             → מטרופוליס (פפא) 2011 יזמות אורבנית בע"מ
 50%  ניוטון                → צ'מפיון מוטורס      ⚠ check — likely WRONG (should be ניוטון מרכזים?)
 70%  עמותת נובה            → עמותת שבט הנובה
100%  צ'מפיון מוטורס        → צ'מפיון מוטורס
 50%  קבוצת גורמה           → קבוצת זאפ           ⚠ check — there's "גורמה ארוחות בע\"מ" in DB
 53%  קבוצת שליו            → קבוצת זאפ           ⚠ check — fuzzy probably wrong
 67%  קסטרו פתרונות חכמים   → ח.י. פתרונות חכמים
 84%  קרייזי ליין           → קרייזי ליין בע"מ
 87%  שיפוצים פלוס          → שיפוצים פלוס בע"מ
100%  שיבומי אסטרטגיה בע"מ  → שיבומי אסטרטגיה בעמ
```

### ⚠ Three fuzzy matches that look suspect

1. **`ניוטון` → `צ'מפיון מוטורס` (50%)** — DB has `ניוטון מרכזים חינוכיים בע"מ` (id `2b3ad026-0ae7-475f-83be-ea9782554e23`). The Excel "ניוטון" is almost certainly that, not Champion Motors. **Add manual override**.
2. **`קבוצת גורמה` → `קבוצת זאפ` (50%)** — DB has `גורמה ארוחות בע"מ` (id `e75d5ffb-9fd6-4d80-8938-55ce7ef85324`). Should map to Gourme, not Zap. **Add manual override**.
3. **`קבוצת שליו` → `קבוצת זאפ` (53%)** — DB has `שלו ובניו בע"מ` (id `e3e9cad5-f3cc-4966-9e26-dfab212e8139`). The closest "שליו"/"שלו" client. **Add manual override** (subject to user confirmation).

These three are silently wrong matches that the fuzzy threshold accepted. Without intervention they would write Excel terms onto the WRONG client. They are flagged here and listed in `IMPORT_AGREEMENTS_UNMATCHED.md` so the user can confirm before the live run.
