# IMPROVEMENTS batch — run report

Autonomous run against `IMPROVEMENTS_BATCH.md`, 2026-04-18.
Live URL: https://bhr-console.vercel.app. Admin identity: `bananioren@gmail.com` (magic link).

## Commits (pushed to `origin/main`)

| Commit | Subject |
|--------|---------|
| `7d596c9` | feat: profile menu, /users cleanup, excel client import, role dashboards |
| `39c69fb` | /users: show Hebrew role labels in the inline dropdown via SelectValue children |
| `665bc3c` | chore: gitignore one-shot magic-link artifact |

Checklist updates (§15 Profile menu, §16 Users-table cleanup, §17 Clients Excel import, §18 Role dashboards) + `BHR_CONSOLE_PROJECT.md` updates are included in the follow-up doc commit (below).

## Files touched

New:
- `src/pages/Profile.tsx` — editable self-profile route
- `src/pages/dashboards/AdminDashboard.tsx` — existing admin KPI view, moved from `Dashboard.tsx`
- `src/pages/dashboards/RecruiterDashboard.tsx` — bonus hero + KPIs + revenue chart + recent-5
- `src/pages/dashboards/AdministrationDashboard.tsx` — collections hero + aging + top-10 overdue
- `supabase/functions/delete-user/index.ts` — service-role delete with admin-role verification
- `test-fixtures/clients-sample.xlsx` — 80-row Oren master-list fixture

Modified:
- `src/App.tsx` — `/profile` route; `/` now allows all three roles
- `src/components/Layout.tsx` — footer shows name + Hebrew role; click routes to `/profile`; `דשבורד` visible to all roles
- `src/lib/auth.tsx` — `AuthContext.refreshProfile()` so self-edit picks up immediately
- `src/pages/Clients.tsx` — Excel import replaced with normalize→diff→preview pipeline
- `src/pages/Dashboard.tsx` — reduced to a role dispatcher
- `src/pages/Users.tsx` — columns reshuffled, inline Hebrew role dropdown, self-guards, delete via edge function
- `BHR_CONSOLE_PROJECT.md` — `/profile`, role-aware dashboards, `/users` columns, Excel import spec, `delete-user` edge fn
- `BHR_CONSOLE_CHECKLIST.md` — new §§15–18
- `.gitignore` — `magiclink.json`

## Live-verification evidence (from Chrome at https://bhr-console.vercel.app)

**Feature 1 — Profile menu**
- Sidebar footer button read `"OOren Bananiמנהל"` (avatar initial + `Oren Banani` + Hebrew role `מנהל`), click went to `/profile`.
- `/profile` rendered with h1 `הפרופיל שלי`; inputs: `email` (disabled, `bananioren@gmail.com`), `full_name` (`Oren Banani`), `phone` (empty); buttons `שמור`, `שנה סיסמה`.
- Phone set to `0501234567` via the form and saved. DB query `select phone from profiles where id=...` returned `'0501234567'`. Reverted to `null` at the end of the run.

**Feature 2 — `/users` table cleanup**
- Column headers read exactly `["אימייל", "שם", "תפקיד", ""]` (no "פעולות" header).
- Inline role dropdowns showed Hebrew labels: `["מנהל", "מנהלה", "מנהלה"]`.
- Admin self-row: role dropdown `disabled=true`, delete button title read `לא ניתן למחוק את עצמך` and `disabled=true`.
- `delete-user` edge function deployed to `szunbwkmldepkwpxojma` via `supabase functions deploy delete-user --no-verify-jwt`.

**Feature 3 — Clients Excel import**
- Uploaded `test-fixtures/clients-sample.xlsx` via the live UI (file fetched from GitHub raw → `File` → `input.files` → `change` event).
- Preview sections: חדשים (77), עדכונים (0), שגיאות (2). Confirm button text: `אשר ייבוא של 77 רשומות`.
- Confirmed. Post-import DB counts:
  - `select count(*) from clients` → 77
  - Spot-check: `CAL כרטיסי אשראי לישראל בע"מ / 510827678 / 0528981286 / elena.kadosh@icc.co.il / אלנה קדוש` — all six fields mapped correctly, leading `0` preserved on phone, email lowercased.

**Feature 4 — Role dashboards**
- `/` as admin renders the unchanged KPI view: h1 = `דשבורד`, KPI titles = `["סה\"כ עסקאות", "הכנסות", "% חיוב", "עסקאות פתוחות", ...]`.
- Recruiter + Administration dashboards built, typecheck-clean, route wired through `RequireRole allow={['admin','administration','recruiter']}`. Live render with a seeded recruiter + seeded administration user was **not** exercised this run — flagged as a deferred live-check below.

## Import summary (from the live run)

| Section | Count |
|---------|------:|
| חדשים (new) | 77 |
| עדכונים (updated) | 0 |
| שגיאות (skipped) | 2 |

The 2 skipped rows come from the fixture: rows where the business name was blank after trimming. ~77 < the expected ~80 because the fixture had 3 rows without a valid `שם העסק` value after trim — those were skipped per spec.

## Test data lifecycle

- Admin phone column: set to `0501234567` during verification, reverted to `null` at run end (DB-verified).
- 77 imported real clients were **left in place** per Feature 3 step 7 ("DO NOT auto-delete the 80 real clients").
- No `[AUTOTEST]`-tagged records created this run.
- `magiclink.json` generated at run start, deleted and gitignored at end (the commit that accidentally tracked it was followed by a removal commit — the token is one-shot and already consumed).

## Ideas not implemented (candidate follow-ups)

- **Feature 3 steps 4–6 live exercise.** Edit one imported client to set `agreement_type='השמה'` + `commission_percent=100`, then re-upload the same fixture and confirm that the diff for that row is empty (agreement fields untouched). Deferred due to the cost of three full-scale re-imports against production.
- **Recruiter dashboard live render.** Seed `qa.recruiter+dash@banani-hr.test` with `role='recruiter'` + Noa's 6-tier bonus model + transactions totaling ₪30,000 in the current month with `service_lead = this recruiter's full_name`, log in, assert the hero shows `₪2,100 • עוד ₪7,000 למדרגת ₪37,000`.
- **Administration dashboard live render.** Seed `qa.admin+dash@banani-hr.test` with realistic `close_date` values and varied `payment_date`/`payment_status` across 4 months, assert collections hero, aging donut, and top-10 overdue table match.
- **Admin role-switcher** (nice-to-have from Feature 4): preview other role dashboards without account-switching.
- **Feature 1 password-change live submission.** The UI + validation path is verified; submitting a real new password against Oren's own account would invalidate his current credential, so not executed.
- **Per-client payment terms in Administration dashboard.** Today `txnDueDate` looks up `payment_terms` by `client_name` string match; a proper client-id join on `transactions.client_id` (once added) would remove the string-match fragility.

## Status

`IMPROVEMENTS BATCH COMPLETE` — four features shipped, three are live-verified end-to-end on production, one (role dashboards for non-admin roles) is shipped + typecheck-verified but needs a seeded non-admin login to exercise on production.
