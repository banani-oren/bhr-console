# Portal — Hours tab (`/portal?token=…`)

**Captured:** Round 2 autonomous run.
**Employee:** `QA Test Employee` (round-2 seed).

**Header:** `פורטל עובד / QA Test Employee` (purple accent).

**Tabs:** `בונוס | שעות` (right-to-left, שעות active).

**Month/year selector:** default `4 / 2026` — current month.

**Table headers (RTL order):** `תאריך | שעות | קטגוריה | תיאור` — the `קטגוריה` column
appears because `hours_category_enabled=true` on this profile.

**Empty state:** `אין דיווחים לחודש זה` (since round-1 autotest inserts were cleaned
up and this is a fresh autotest employee in round 2).

**`+ הוסף דיווח`** button visible (purple, plus icon). Inserting from this button
was live-verified in round 1 (hours_log row with correct `profile_id` landed in the
DB).

**Auth:** the portal works without admin auth (`supabasePublic` client; storageKey
is distinct so a stale admin session in localStorage doesn't block queries).

**Console:** clean.
