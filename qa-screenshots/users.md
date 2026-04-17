# Users — `/users` (admin only)

**Captured:** Round 2, clean DB, logged in as admin.

**Header:** `ניהול משתמשים` right-aligned. Purple `הזמן משתמש` button top-right (plus icon).

**Table:** `אימייל | שם | תפקיד | פעולות`

| Email | Name | Role badge | Actions |
|-------|------|------|---------|
| `bananioren@gmail.com` | `Oren Banani` | `מנהל` (purple) | delete, reset, toggle-role icons |
| `nadia@banani-hr.com` | `נדיה צימרמן` | `עובד` (gray) | delete, reset, toggle-role icons |

Admin-only route guard (`AdminRoute`) verified in round 1 by signing in as a role=employee user → redirected to `/`.

**Sidebar:** `ניהול משתמשים` highlighted.

**Console:** clean.
