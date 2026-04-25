# Import preview — 2026-04-23

- Total data rows in CSV: 30
- Junk rows skipped: 2 (row ids: 4, 5)
- Valid rows to import: 28
- Unique client names in CSV: 14
- Matched client names: 14
- Unmatched client names: 0

## Per-kind breakdown of valid rows
- השמה: 18
- מש"א במיקור חוץ: 8
- הדרכה: 2

Total net_invoice_amount sum: ‏222,950.00 ‏₪
hours_log lines to insert: 40

## Matched client mapping
- "נובה" → "עמותת שבט הנובה" (via confirmed)
- "קסטרו אבטחת תנועה, תחזוקה ושירותים בע"מ" → "קסטרו אבטחת תנועה, תחזוקה ושירותים בע"מ" (via confirmed)
- "שיבומי אסטרטגיה בע"מ" → "שיבומי אסטרטגיה בעמ" (via prefix)
- "קרייזיליין" → "קרייזי ליין בע"מ" (via confirmed)
- "שיבומי מרץ" → "שיבומי אסטרטגיה בעמ" (via prefix)
- "קסטרו מרץ" → "קסטרו אבטחת תנועה, תחזוקה ושירותים בע"מ" (via confirmed)
- "GROW" → "גרואו פיימנטס בע"מ" (via prefix)
- "עיריית תל אביב" → "עיריית תל אביב-יפו" (via confirmed)
- "אגד" → "אגד חברה לתחבורה בע"מ" (via confirmed)
- "אלדר שיווק" → "אלדר שיווק פרוייקטים (2000) בע"מ" (via confirmed)
- "אלדר מגורים" → "אלדר מגורים" (via prefix)
- "מאסטרפוד" → "מאסטר פוד" (via confirmed)
- "טיקוצקי" → "דורון טיקוצקי עורכי דין" (via confirmed)
- "קבוצת אלדר" → "קבוצת אלדר (ר.ה.ד) בע"מ" (via confirmed)

## Activity-log parse anomalies
(none)

Rows will be inserted with notes tag `[IMPORT-2026-04-23-row-<N>]` for idempotency + rollback.
