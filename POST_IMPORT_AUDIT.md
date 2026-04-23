# Post-import audit — 2026-04-23

| CSV row | Client | Transaction id | Expected lines | Actual hours_log | Delta | Period |
|---|---|---|---|---|---|---|
| 2 | קסטרו אבטחת תנועה, תחזוקה ושירותים בע"מ | 48c95dcc-7961-403d-841f-1dce174bfb2f | 6 | 6 | 0 | 2026-01-04 → 2026-01-28 |
| 3 | שיבומי אסטרטגיה בע"מ | 3e144011-7cbd-4388-a574-38008eb11743 | 11 | 11 | 0 | 2026-01-05 → 2026-01-29 |
| 6 | שיבומי אסטרטגיה בע"מ | 28587e31-1c39-4c20-9535-4e4db655756d | 12 | 12 | 0 | 2026-02-02 → 2026-02-26 |
| 7 | קסטרו אבטחת תנועה, תחזוקה ושירותים בע"מ | 80ca5f8b-bae9-425f-9722-ceb018e16fe5 | 11 | 11 | 0 | 2026-02-01 → 2026-02-25 |
| 9 | שיבומי מרץ | b541f3ed-6e00-4596-962d-37c93a68c375 | 0 | 0 | 0 | 2026-03-01 → 2026-03-31 |
| 10 | קסטרו מרץ | 26705ede-3c2e-4f8c-a7a9-0cce2d33a9f4 | 0 | 0 | 0 | 2026-03-01 → 2026-03-31 |
| 28 | קסטרו אבטחת תנועה, תחזוקה ושירותים בע"מ | 2f77f2fe-23ea-4dc3-a15f-7704ffccd2e4 | 0 | 0 | 0 | 2026-04-01 → 2026-04-30 |
| 29 | שיבומי אסטרטגיה בע"מ | 420e89b0-e8c9-421a-9b94-4df63329ab51 | 0 | 0 | 0 | 2026-04-01 → 2026-04-30 |

Total expected (CSV parse): 40
Total actual (hours_log):   40
Delta total: 0

## Finding

**No data repair is required.** Every `kind='time_period'` transaction
inserted by the 2026-04-23 import already has its exact expected
number of `hours_log` children (6 + 11 + 12 + 11 = 40; the four
remaining time_period transactions — rows 9, 10, 28, 29 — legitimately
have no activity log in the CSV's `מועמדים בתהליך` column, so zero
hours_log rows is correct).

Client rows for `שיבומי אסטרטגיה בעמ` and
`קסטרו אבטחת תנועה, תחזוקה ושירותים בע"מ` both already carry
`time_log_enabled = true` and `hourly_rate = 400`. `profile_id` on
every hours_log row is Oren's admin id
`03b73b4f-8f09-4bf1-9c22-f49b2b05f363`.

Month distribution of the 40 imported hours_log rows:

| month / year | count |
|---|---|
| 2026-01 | 17 |
| 2026-02 | 23 |

## Root cause of the "can't find them" symptom

The `/hours` page filters on `month + year` via its top-of-page
selector. The selector defaults to the CURRENT month (April 2026) on
mount. Since every imported hours_log row is in January or February
2026, the default view — on both the admin `ניהול שעות` tabs-per-
client layout and the admin `השעות שלי` personal layout — renders
zero rows.

**To see the rows live, change the month/year selector to 1/2026 or
2/2026.** No code fix is warranted for this batch; a sensible future
enhancement is to auto-scroll the selector to the most-recent month
that actually has entries, but it's out of scope here.

## Activity-log regex

The import-script regex `(?:שעות|שעה)` (fixed during the import run)
already accepts both plural `שעות` and singular `שעה`. The en-dash
(`U+2013`) and optional time-range are handled with the Unicode flag
`u`. No regression possible on re-import: the idempotency tag in
`notes`/`description` will skip already-imported rows.

