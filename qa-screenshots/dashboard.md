# Dashboard — `/`

**Captured:** Round 2 autonomous run, clean-DB state (0 txns, 0 clients).

**Viewport:** 1568×698 (Chrome MCP default).

**Layout:**
- `<html lang="he" dir="rtl">`
- Dark purple sidebar on the RIGHT (Banani B logo + `BHR Console`).
- 6 nav items in order, with `דשבורד` active (purple background).
- Main content on the left.

**KPI cards (right-to-left):**
| Card | Value |
|------|-------|
| סה"כ עסקאות | 0 |
| הכנסות | ₪ 0.00 |
| % חיוב | 0% |
| עסקאות פתוחות | 0 |

**Charts:**
- `הכנסות חודשיות – 12 חודשים אחרונים` — 12-month x-axis `מאי 25 … אפר 26`; empty bars.
- `עסקאות לפי סטטוס תשלום` — empty donut.
- `הכנסות לפי ליד שירות` — empty horizontal bar chart.

**Console:** clean (no `error`, no `warn`). Importantly, the earlier
`GoTrueClient@sb-… Multiple GoTrueClient instances detected` warning is **gone**
after the `storageKey` fix — only `/auth/v1/user 200`, `/profiles 200`,
`/transactions 200` network calls.

**No regressions** vs round 1.
