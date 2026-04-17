# Clients — `/clients`

**Captured:** Round 2 autonomous run (clean DB state).

**Layout / controls:**
- Title `לקוחות` right-aligned.
- Top-right actions: `ייבוא מאקסל` (upload icon) + `לקוח חדש` (purple button, plus icon).
- Search box placeholder `חיפוש לפי שם...` with search icon (right-side).
- `all` status filter dropdown beside the search.

**Table headers (right-to-left order):**
`שם לקוח | איש קשר | נייד | סוג הסכם | סטטוס | פעולות`

Phone column (`נייד`) present — matches spec. Group/ח.פ columns removed in commit
388ca7b.

**Empty state:** `לא נמצאו לקוחות`.

**Sidebar:** `לקוחות` highlighted purple (active route).

**Console:** clean.
