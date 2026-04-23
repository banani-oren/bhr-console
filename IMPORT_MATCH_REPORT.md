# Client match report — one-time CSV import (2026-04-23, final)

Authoritative CSV `שם לקוח` → `clients.name` mapping, resolved with Oren.
Claude Code must use this mapping verbatim in Phase 1 of
`ONE_TIME_CSV_IMPORT.md` instead of running the fuzzy matcher.

## Confirmed mappings

| CSV `שם לקוח`                                | Target client in `clients.name`                                                       | How resolved |
|---------------------------------------------|---------------------------------------------------------------------------------------|--------------|
| קסטרו אבטחת תנועה, תחזוקה ושירותים בע"מ      | קסטרו אבטחת תנועה, תחזוקה ושירותים בע"מ                                              | exact |
| קסטרו מרץ                                   | קסטרו אבטחת תנועה, תחזוקה ושירותים בע"מ                                              | month-tag stripped |
| קרייזיליין                                  | קרייזי ליין בע"מ                                                                      | fuzzy |
| GROW                                        | גרואו פיימנטס בע"מ - GROW PAYMENTS LTD                                                | fuzzy |
| עיריית תל אביב                              | עיריית תל אביב-יפו                                                                    | prefix |
| אגד                                         | אגד חברה לתחבורה בע"מ                                                                 | prefix |
| מאסטרפוד                                    | מאסטר פוד                                                                             | fuzzy |
| טיקוצקי                                     | דורון טיקוצקי עורכי דין                                                               | fuzzy |
| קבוצת אלדר                                  | קבוצת אלדר (ר.ה.ד) בע"מ                                                               | prefix |
| נובה                                        | עמותת שבט הנובה                                                                       | **confirmed by Oren** |
| אלדר שיווק                                  | אלדר שיווק פרוייקטים (2000) בע"מ                                                      | **confirmed by Oren**: all 4 rows have invoice contact `דנית שחף`, which belongs to the main corporate entity (the `- ליה/אנה` variant is a different contact scope) |

## Resolved by adding new clients

Oren added these directly via `/clients`. Claude Code must look them up by
**prefix match** on the current live `clients` table at runtime — the exact
full names Oren used are not captured here, so a lookup is required.

| CSV `שם לקוח`         | Action taken                            | Runtime lookup |
|---------------------|-----------------------------------------|----------------|
| אלדר מגורים         | Oren added as a new client              | Match by `clients.name ILIKE 'אלדר מגורים%'`. Expect exactly one hit. |
| שיבומי אסטרטגיה בע"מ | Oren added as a new client              | Match by `clients.name ILIKE 'שיבומי%'`. Expect exactly one hit. |
| שיבומי מרץ          | Same entity as above (month-tag variant) | Same lookup; strip the "מרץ" tag first. |

If either prefix returns ≠1 row, stop the import and surface the
candidates in `IMPORT_UNMATCHED.md` for Oren to resolve.

## Other context for the run (not a mapping)

- `מיכל רוקר` was added as an employee (`profiles.role` probably
  `recruiter` or `administration`). Does not affect this import — all
  time-log entries in the CSV are Oren's — but is relevant for the
  hours-log seeding step (`profile_id` is looked up by
  `email = 'bananioren@gmail.com'`, not by name, so this shouldn't cause
  mismatches).

## Usage in `ONE_TIME_CSV_IMPORT.md`

1. Phase 1 uses this file's "Confirmed mappings" table verbatim for the
   11 deterministic rows.
2. For the three runtime-lookup rows, Code queries `clients` with the
   specified `ILIKE` patterns and proceeds automatically if each returns
   exactly one row. Otherwise it stops per the gate.
3. After a clean import, keep this file as a historical audit record.
