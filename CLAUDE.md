# BHR Console — Codebase Map (Claude Code)

> This file is the authoritative reference for Claude Code. Read it at the start of every session.
> Root `CLAUDE.md` (one level up) defines the Cowork planning role and working method.

> ⚠️ **Standing rule (Repair 19, 2026-10-06):** Any claim that something is broken,
> expired, deprecated, blocked, or anomalous must carry the date it was last
> verified. Before relying on such a claim — or building a workaround for it —
> re-verify it. Two claims in this file (a 401 token and a billing anomaly)
> were false for months; one of them nearly caused a legitimate ₪7,560
> receivable to be deleted. A dated claim that fails re-verification is
> corrected in the same session it is found. The full phase-by-phase history
> (including historical rows that were true on the day they were written but
> are not current status) lives in `DOCS/PHASE-HISTORY.md` — never read a
> historical row as a live claim; re-verify first.

---

## Project

Internal financial and operational management system for **Banani HR**.  
Used daily by Oren (CEO) and the recruitment team.

**Live URL (production domain for QA/users):** `app.banani-hr.com` — HTTP 200, serves the app.  
**Vercel URL:** `bhr-console-banani-orens-projects.vercel.app` — ⚠ behind Vercel deployment protection (SSO), returns HTTP 401 to anonymous curl; use `app.banani-hr.com` to verify a live deploy, or match the served `/assets/index-*.js` hash to your local `dist/` build.  
**Repo:** `banani-oren/bhr-console` → Vercel auto-deploys on push to `main`  
**Supabase:** project ID `szunbwkmldepkwpxojma`, Frankfurt region

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 8 + TypeScript 6 |
| Styling | TailwindCSS v4 + shadcn/ui (`components.json`) |
| Server state | @tanstack/react-query v5 |
| Routing | react-router-dom v6 |
| Backend/DB | Supabase (auth, Postgres + RLS, storage, edge functions) |
| Charts | Recharts |
| PDF export | jsPDF + jspdf-autotable |
| Excel export | xlsx |
| Email | Resend (via Supabase edge functions) |
| PWA | vite-plugin-pwa (auto-update, offline caching) |
| CI/CD | Vercel — auto-deploy on push to `main` |

---

## Critical Constraints — Never Break These

- **Hebrew RTL everywhere** — every component, dialog, table, form is `dir="rtl"`. Sidebar on the **right**.
- **Currency: ₪ ILS** — display with `₪` prefix. No floating-point arithmetic. Use Postgres `numeric`.
- **Israeli locale** — dates display as `dd/MM/yyyy`, timezone `Asia/Jerusalem`.
- **Roles**: `admin` | `administration` | `recruiter` — see route guards in `App.tsx`.
- **Build must pass** — `npm run build` before every commit. TypeScript errors = blocked.
- **No new dependencies** without explicit approval. Stack is fixed.
- **Live data** — never modify real records during testing. Only `[TEST-...]` tagged records.

### ⚠️ NO REGRESSION RULE — Enforced on Every Task

**Never remove, rename, or reorder any existing UI element, column, field, button, or component unless Oren explicitly asks for it.**

Before committing any edit to a page or component file:
1. List every column / field / section that existed before your edit
2. Confirm every one of them still exists in your output
3. If any is missing — put it back before continuing

This rule applies to all files. There are no exceptions.

---

## Canonical Column Orders (never change without explicit instruction)

### Transactions.tsx — table columns (in order)

Changed 2026-10-17 (Repair 21) — **authorized by Oren**: removed שירות + אישור, added עמלת ספק + הכנסה, relabelled סכום נטו → סכום חשבונית.

| # | Header | Source |
|---|---|---|
| 1 | לקוח (+ amber "ממתין לאישור" badge under the name when unapproved) | `t.client_name` |
| 2 | משרה / מועמד | `t.position_name` + `t.candidate_name` |
| 3 | שכר | `t.salary` |
| 4 | % עמלה | `t.commission_percent` |
| 5 | מוביל | `t.service_lead` |
| 6 | תאריך סגירה | `t.close_date` |
| 7 | תחילת עבודה | `t.work_start_date` |
| 8 | סכום חשבונית | `t.net_invoice_amount` |
| 9 | עמלת ספק — **admin + administration only** (recruiters: header, cell and footer cell omitted) | `txSupplierAmount(t)` |
| 10 | הכנסה | `txIncome(t)` |
| 11 | חיובים | billing event status dots |
| 12 | פעולות | approve icon (✓, `canApprove && isUnapproved`) / edit / delete |

Recruiters therefore see 11 columns. Service type is no longer a column but stays searchable (`resolveServiceName` is in the search predicate).

Footer: totals row (Repair 20, extended Repair 21) — count in col 1; סכום חשבונית total (+ "מתוכם ממתין לאישור" sub-line) under col 8; עמלת ספק total (admin/administration) and הכנסה total — all derived from the visible (`sorted`) set via `finance.ts`. No footer in loading/empty states.

Filters (Repair 26, requested by Oren 2026-10-18 — do NOT "restore" Repair 8's removal of the old dropdowns; these are new and deliberate): search · **שנה** · **חודש סגירה** · **מוביל** (admin/administration only; `normalizeLead`) · **סוג שירות** (service_types names + "ללא סוג שירות"; matched through `resolveServiceName`) · **מועד תשלום** (toggle צפוי=`due_date` / בפועל=`payment_date`, from/to range, any non-cancelled event in range) · **חיובים header popover** (multi-select buckets: טרם חויב, לחיוב עכשיו, ממתין לתשלום, באיחור [`isOverduePayment`, no payment_date], שולם, מבוטל, ללא חיובים — a deal matches if ANY event is in ANY selected bucket). All filters combine; the totals row follows them. **State lives in the URL query string** (`q`, `year`, `month`, `lead`, `svc`, `pm`, `from`, `to`, `bill` comma list; defaults are omitted) — no localStorage. "נקה סינונים" appears whenever any filter is active. Filter rows wrap (no horizontal scroll). Defaults: כל השנים + כל החודשים. *(The old "month filter has no year" limitation was resolved by Repair 25, 2026-10-17.)*

---|---|---|
| 1 | לקוח | `t.client_name` |
| 2 | שירות | `t.service_type` |
| 3 | משרה / מועמד | `t.position_name` + `t.candidate_name` |
| 4 | שכר | `t.salary` |
| 5 | % עמלה | `t.commission_percent` |
| 6 | מוביל | `t.service_lead` |
| 7 | תאריך סגירה | `t.close_date` |
| 8 | תחילת עבודה | `t.work_start_date` |
| 9 | סכום נטו | `t.net_invoice_amount` |
| 10 | חיובים | billing event status dots |
| 11 | אישור | approval button |
| 12 | פעולות | edit / delete buttons |

Footer: totals row (Repair 20) — count in col 1, סכום נטו total + ממתין לאישור sub-line in col 9, derived from the visible (`sorted`) set. No footer in loading/empty states.

⚠️ Known limitation (verified 2026-10-17): the חודש סגירה filter matches `closing_month` (1–12) **without a year**. Once 2027 data exists, "אוגוסט" will merge Aug 2026 and Aug 2027 — and so will the totals row. Filter intentionally unchanged; needs a separate decision. (Also: 11 of 52 transactions have no `closing_month` and appear only under כל החודשים.)

---

## File Map

```
App Dev/
├── src/
│   ├── main.tsx                        # Entry — mounts App into #root
│   ├── App.tsx                         # Router + QueryClientProvider + AuthProvider + all routes
│   ├── index.css                       # Global styles, TailwindCSS v4 tokens, CSS variables
│   │
│   ├── lib/
│   │   ├── supabase.ts                 # Supabase client singleton (VITE_SUPABASE_URL + ANON_KEY)
│   │   ├── types.ts                    # All shared TypeScript types
│   │   ├── auth.tsx                    # AuthProvider + useAuth hook (user, profile, loading, recoveryMode)
│   │   ├── utils.ts                    # cn() helper (clsx + tailwind-merge)
│   │   ├── clients.ts                  # Client CRUD: getClients, getClientById, upsertClient, deleteClient
│   │   ├── finance.ts                  # Money definitions — single source of truth (Repair 21): agorot math, event/tx invoice·supplier·income, isGiyus/isGiyusName, dealDate, paidEventsInRange (by payment_date), jerusalemYearMonth, and (Repair 28) `collectionMonth()` + `paidLastMonths()` for the collections dashboard, and (Repair 29) `ungeneratedRemainderAgorot()`/`ungeneratedRemainder()` = net_invoice_amount − Σ non-cancelled events (floored at 0). See "Money terminology" and "Collections dashboard math (Repair 28)".
│   │   ├── auditLabels.ts              # Repair 24: Hebrew field-label map + value formatting + Jerusalem timestamp/boundary helpers for the audit log
│   │   ├── bonus.ts                    # Bonus engine — single source of truth for every bonus surface (Repair 16). fetchBonusEvents() → buildBonusDeals() → buildLedgerFromDeals(): a DEAL counts only when fully collected, at full value, in the month of its last payment (Repair 27); paymentIncomeByMonth() = per-payment INCOME (not bonus). See "Bonus Engine".
│   │   ├── billingBuckets.ts           # Repair 29: BILL_BUCKETS (טרם חויב · לחיוב עכשיו · ממתין לתשלום · באיחור · שולם · מבוטל) with `match(event, today)` — the ONE definition shared by Transactions (חיובים popover) and BillingReports (סטטוס popover)
│   │   ├── dealEvents.ts               # Repair 31: buildDealEvents() — the billing-event drafts of a deal save (extracted verbatim from TransactionDialog.handleSave); run in the browser for admin/administration and server-side by recruiter-save-deal
│   │   ├── bonusOverview.ts            # Repair 31: buildBonusOverview() — recruiter bonus payload (amounts + deal COUNTS only) on top of bonus.ts; runs in my-bonus-overview
│   │   ├── ilCalendar.ts               # Repair 32: THE Israeli working-day calendar — IL_NON_WORKING_DAYS (19 days, 2026–2027), isWorkday / isNonWorkingDay / isErevHoliday / addBusinessDays / workdaysBetween / expectedHours / workdaysLeftInMonth. Matched pair with il_non_working_days + bhr_is_workday + bhr_add_business_days; `npm run test:calendar` fails on any drift
│   │   ├── workHours.ts                # Repair 32 (D6): STANDARD_WORKDAY_HOURS = 8.4, EREV_HOLIDAY_HOURS = 7 — Oren to confirm
│   │   ├── bonusBar.ts                 # Repair 33: barGeometry() — counted / expected / estimate fractions of an upcoming-month bar (pure; runs in my-bonus-overview; npm run test:bonus-bar)
│   │   ├── attendanceMonth.ts          # Repair 32: buildMonthDays()/monthTotals() — one month of attendance day by day (present/missing/holiday/erev/future/weekend); shared by the dashboard cards and the recruiter /attendance table
│   │   ├── billingEvents.ts            # Billing event helpers — generation, status, שוטף+X calculation
│   │   ├── attendance.ts               # Attendance helpers — Israel-tz today/time, status, pair-matching hours (dayHours), dayPairs() (check_in→check_out AttendancePair[]), toLocalInputValue() (UTC→browser-local for datetime-local inputs)
│   │   ├── hoursService.ts             # Repair 25: HOURS_SERVICE_NAME ('שירות משאבי אנוש'), resolveHoursServiceTypeId/findHoursServiceTypeId, hoursCloseFields() (close_date = end of period_end's month + closing month/year). Both hours paths (MyHoursView, HoursReportDialog→TransactionDialog) use it.
│   │   ├── dates.ts                    # Date/timezone utilities — Israeli locale helpers
│   │   ├── pdf.ts                      # PDF export helpers (jsPDF)
│   │   ├── serviceTypes.ts             # ServiceType/ServiceField types + evalDerived() formula evaluator
│   │   ├── offlineQueue.ts             # idb-keyval offline mutation queue
│   │   └── excelExport.ts              # exportSheetsToExcel() — shared xlsx multi-sheet export helper (Batch 8 Phase 4)
│   │
│   ├── hooks/
│   │   ├── useSupabaseQuery.ts         # Generic hooks: useTable, useInsert, useUpdate, useDelete
│   │   ├── useSafeMutation.ts          # Mutation wrapper with offline queue support
│   │   └── useIsMobileDevice.ts        # detectMobileDevice()/useIsMobileDevice() — UA regex OR narrow-width+coarse-pointer, reactive. Single source of truth for the mobile hard lock (Batch 8 Phase 1)
│   │
│   ├── components/
│   │   ├── ui/                         # shadcn/ui primitives — regenerate via CLI, do not edit directly
│   │   ├── Layout.tsx                  # Desktop shell: RTL sidebar (right) + main content
│   │   ├── RequireRole.tsx             # Route guard — checks profile.role
│   │   ├── TransactionDialog.tsx       # Add/edit transaction (dynamic fields from ServiceType)
│   │   ├── DeleteTransactionDialog.tsx # Repair 26: deliberate deal delete — shows what is deleted with the deal (billed/paid warning), forces release/move choice for linked hours, calls delete_transaction RPC, inline Hebrew errors, 10s abort
│   │   ├── AgreementUploader.tsx       # PDF upload + extract-agreement edge function
│   │   ├── BonusWidget.tsx             # Compact per-employee bonus card (current month, actual + תחזית) on AdminDashboard — mounted there since Repair 16 (previously built but never wired in anywhere)
│   │   ├── ClientPicker.tsx            # Autocomplete client selector. Repair 31: for role recruiter it searches through the `search_clients_for_picker` RPC (clients has no recruiter SELECT). Repair 29: arrow-key/Enter navigation (Esc closes), optional `popoverClassName` (BillingReports passes `min-w-[16rem] max-h-72`); defaults unchanged — TransactionDialog still doesn't auto-open
│   │   ├── SortableHead.tsx            # Shared sortable <TableHead> + SortState/toggleSortKey/compareBySort (Repair 8). Repair 30: label + indicator sit at the RIGHT edge (`justify-start` in RTL; indicator aligned with the label's last line) on every table that uses it
│   │   ├── BrandLogo.tsx               # Repair 30: THE React placement of the company logo — `<BrandLogo variant="navy|white" size={px height} />` (navy on light, white on dark). Never draw/inline the mark any other way
│   │   ├── RecruiterAttendanceMonth.tsx # Repair 32: recruiter's own attendance by month (default current, earlier months read-only, `?month=YYYY-MM&missing=1`), add/edit/delete only inside the current month (RLS-enforced)
│   │   ├── recruiter/UpcomingBonusPanel.tsx # Repair 33: the recruiter's forward-looking bonus panel (month cards, deal list, CTA, legend) — reads only the my-bonus-overview payload
│   │   ├── LabeledToggle.tsx           # Labeled switch/toggle
│   │   ├── MobileAutoRoute.tsx         # Mobile hard lock: redirects any mobile device to /m on every navigation (re-evaluates via useIsMobileDevice, no one-shot guard, no bhr_force_desktop opt-out — Batch 8 Phase 1)
│   │   ├── ProfileEditor.tsx           # Inline profile edit form
│   │   └── UserEditDialog.tsx          # Admin dialog: edit user profiles + roles
│   │
│   ├── pages/
│   │   ├── Login.tsx                   # Login form (email + password)
│   │   ├── SetPassword.tsx             # Password reset / first-login flow. ⚠ Routing gates on `recoveryMode` ONLY (arrived via reset/magic link), NOT on `profiles.password_set` (Repair 5b) — a normal login session always goes to the app, so a stale password_set=false can never trap a user. password_set is still written true on a successful set; it is not a routing gate. PKCE recovery detected via ?code/?type=recovery query params + #type=recovery hash (Repair 5).
│   │   ├── Dashboard.tsx               # Role-aware: loads correct dashboard per role
│   │   ├── Clients.tsx                 # Client list + ClientDialog (create/edit)
│   │   ├── Transactions.tsx            # Transaction table: filters, inline edit, export
│   │   ├── AuditLog.tsx                # Repair 24: /audit-log (admin) — filters (date/user/entity/search), 50-row pages, Hebrew field diffs via get_audit_log()
│   │   ├── Attendance.tsx              # Check-in/out + daily attendance report (report = admin/administration). V2: two-phase check-out with optional note (≤250); today's-log + report show check_in→check_out pairs (report = one TableRow per pair, name/date only on first); employee 'תיקון' edit-request form (insert into attendance_edit_requests); admin pencil direct-edit + 'בקשות תיקון ממתינות' approve/reject panel. Edit forms use toLocalInputValue() so datetime-local shows Israel local time. Repair 12: admin-only AdminDeleteButton (trash, two-step inline 'מחק? כן/ביטול') in the פעולות column deletes both pair entries; /attendance sidebar link now allows admin too (Layout.tsx).
│   │   ├── BillingReports.tsx          # דוחות חיוב (Repair 29; Repair 30 header/width rules: all headers right-aligned, labels wrap to two lines (text unchanged), dates sized to dd/MM/yy or a 7.5rem input, document numbers to ~8 digits, the freed space goes to לקוח (w-36, two lines + title tooltip); client picker uses `compact` to match the h-8 neighbours). Rows = billing events + one virtual "טרם חויב" row per deal with `ungeneratedRemainderAgorot` > 0 (read-only, not selectable, click opens TransactionDialog; hidden while a date range is set). Events of unapproved deals show an amber "ממתין לאישור" badge, inputs + checkbox disabled. סטטוס header = sort + BILL_BUCKETS popover (default = all but מבוטל; cancelled events fetched only when מבוטל selected). URL: `bill=` (comma list), `client=`. Totals in agorot: טרם חויב + ממתין לתשלום + שולם = סה"כ of visible rows. Column-fit rule: all 12 columns visible at 1440px with no horizontal scroll (compact cells, wrapped תיאור/שירות, truncated לקוח); at 1024px the table scrolls inside its card with checkbox + לקוח sticky on the right. Sidebar order: … עסקאות → דוחות חיוב → יומן שעות …
│   │   ├── FinanceReport.tsx           # Repair 23: דוח כספי שנתי body (sections A/B/C + Excel export), rendered by Reports.tsx
│   │   ├── Reports.tsx                 # Admin-only דוחות section — TWO reports behind a picker (דוח גיוסים default + דוח כספי שנתי, Repair 23; both stay mounted so each keeps its filters). דוח גיוסים: KPIs + לפי מוביל/לקוח/משרה breakdowns with drill-down + Excel export (Batch 8 Phase 4)
│   │   ├── Bonuses.tsx                 # Per-employee card: actual vs. forecast stats, two-layer progress bar, sortable per-month DEALS table (one row per deal, expandable payments; click a row → TransactionDialog; Repair 27) + partial-collection and ללא צפי השלמה sections, stacked 12-month chart (Repair 16 — tier table removed, moved to Team only)
│   │   ├── Team.tsx                    # Team member management
│   │   ├── Services.tsx                # Dynamic service type builder (admin only)
│   │   ├── Suppliers.tsx               # Supplier management
│   │   ├── Users.tsx                   # User management (admin only)
│   │   ├── Profile.tsx                 # Current user's own profile
│   │   │
│   │   ├── dashboards/
│   │   │   ├── AdminDashboard.tsx          # Admin-only. Section order: PendingApprovalsCard · 4 KPI cards · YtdKpiRow (מתחילת השנה) · לוח תשלומים צפוי · monthly הכנסה chart + חיובים קרובים · ServiceTypeBreakdown · lead card (הכנסה + deals per lead) · BonusWidget · חיובים אחרונים
│   │   │   ├── YtdFinance.tsx              # Repair 22: YtdKpiRow + ServiceTypeBreakdown (own queries, per-section loading/error states)
│   │   │   ├── AdministrationDashboard.tsx # דשבורד גבייה (administration role + admin's גבייה tab). Repair 28: every number from finance.ts `collectionMonth()` on due_date / isOverduePayment (hero = C÷T, KPIs O · R_late · P · W, aging by days past due_date, top-10 late); selects invoice_date + due_date
│   │   │   └── RecruiterDashboard.tsx
│   │   │
│   │   ├── hours/
│   │   │   ├── HoursPage.tsx           # Thin header + renders unified MyHoursView (no tabs — Repair 7)
│   │   │   ├── MyHoursView.tsx         # Unified hours view. Role-aware: admin+administration see ALL employees' hours (עובד/ת filter via list_profiles_for_attendance RPC); recruiters see only their own. Admin-only הפק חיוב שעות billing + billed-row locking. (Repair 7)
│   │   │   ├── HoursEntryDialog.tsx    # Add/edit single hours entry — editable auto-calc hours field; client locked to read-only when preset from filter
│   │   │   ├── HoursReportDialog.tsx   # Hours report — browser-native print to styled RTL HTML (no jsPDF); + צור עסקה מהדוח
│   │   │   └── common.ts              # Shared types + utilities for hours module
│   │   │
│   │   └── mobile/
│   │       ├── MobileLanding.tsx       # /m index — full-screen section picker (שעות/נוכחות), zero chrome (no MobileShell wrapper)
│   │       ├── MobileShell.tsx         # /m/hours|attendance|profile layout — purple-950 header + safe-area bottom nav (no sidebar)
│   │       ├── MobileHours.tsx         # Mobile hours: month stepper, summary card, tap-to-expand cards w/ edit+delete (billed rows locked), FAB add
│   │       ├── MobileAttendance.tsx    # Mobile check-in/out (no report). V2: two-phase check-out note + pair display in today's log. Redesign: in-page title+date header.
│   │       └── MobileProfile.tsx       # Mobile profile view
│   │
│   └── assets/
│       └── hero.png
│
├── supabase/
│   ├── functions/
│   │   ├── impersonate-user/index.ts   # Edge function: admin generates one-time magiclink to log in AS a target user ("התחבר בתור"). ✅ DEPLOYED 2026-06-01 via the Supabase dashboard in-browser editor, back when `SUPABASE_ACCESS_TOKEN` was expired (verified: it now works, HTTP 200 — see the standing rule at the top of this file; deploy via CLI/Management API normally). verify_jwt=true.
│   │   ├── delete-user/index.ts        # Edge function: delete auth user (admin only)
│   │   └── extract-agreement/          # Edge function: extract agreement fields from PDF via Claude
│   │       ├── index.ts
│   │       └── prompt.md               # Versioned system prompt for extraction
│   └── migrations/                     # Applied in order — true live schema state
│       ├── 20260418_1_rls_no_recursion.sql
│       ├── 20260418_2_improvements_batch2.sql    # service_types, client_time_log_permissions, hourly_rate
│       ├── 20260418_roles_and_rls.sql             # three-role model (admin/recruiter/administration)
│       ├── 20260422_refinements_batch3.sql        # transaction.kind, billing_reports
│       ├── 20260422_2_flexible_billing_reports.sql
│       ├── 20260426_suppliers.sql                 # suppliers table + transaction supplier fields
│       ├── 20260509_phase1_clients.sql            # Phase 1: client financial fields (payment_split_json, advance_*, payment_terms, etc.)
│       ├── 20260509_phase2_transactions.sql       # Phase 2: billing_events table, transaction approval fields
│       ├── 20260512_billing_events_paid_status.sql  # Repair 2: 'paid' status added to billing_events CHECK constraint
│       ├── 20260530_attendance_log.sql              # Feature: attendance_log table, work_date trigger, RLS, list_profiles_for_attendance()
│       ├── 20260531_hours_administration_read.sql   # Repair 7: additive SELECT RLS so administration reads all hours_log rows
│       ├── 20260601_attendance_edit_requests.sql    # Feature: Attendance V2 — attendance_edit_requests table + RLS (insert/select own, admin update)
│       ├── 20260712_atomic_save_transaction.sql     # Fix: save_transaction_with_events() SECURITY DEFINER RPC — atomic transaction+billing_events save (see Billing Events § Persistence)
│       ├── 20260913_due_date.sql                    # Feature: Expected Payment Date — billing_events.due_date/due_date_is_manual, trigger-maintained, retroactive backfill
│       ├── 20260913_2_due_date_freeze_paid.sql       # Same-day fix: freeze due_date against auto-recompute once an event is paid/cancelled (see Phase History)
│       ├── 20261003_hours_billing_rpc.sql            # Repair 15: save_transaction_with_events gains period_start/period_end/hours_total/hourly_rate_used; retroactive backfill
│       ├── 20261003_collection_model.sql             # Repair 17: billing_events.invoice_date (real חשבון עסקה date, distinct from the planned billing_date); due_date from COALESCE(invoice_date, billing_date) — superseded by Repair 19, invoice_date only; drops 4 dead transactions columns
│       ├── 20261004_payment_terms_integrity.sql      # Repair 18: due_date never invented — SECURITY DEFINER fix + strict terms parser (NULL, never a 30-day default)
│       ├── 20261006_business_days_and_event_index.sql # Repair 19: two-shape payment terms (eom/business — מיידי = 5 business days Sun-Thu), invoice_date-only due_date basis, event_index unique constraint
│       ├── 20261006_2_drop_billing_percent.sql       # Repair 19: drops the dead transactions.billing_percent column
│       ├── 20261017_audit_log.sql                    # Repair 24: audit_log table + bhr_audit_row triggers (transactions/billing_events/clients) + get_audit_log()
│       ├── 20261017_hr_service_hours.sql             # Repair 25: seeds service_types 'שירות משאבי אנוש' (no dynamic fields)
│       ├── 20261018_delete_transaction.sql           # Repair 26: delete_transaction(p_id, p_hours_action, p_target_transaction) SECURITY DEFINER; hours_log joins the audit log (bhr_audit_row hours_log branch + trigger + audit_log CHECK)
│       ├── 20261019_recruiter_portal.sql / 20261019_2_recruiter_lockdown.sql  # Repair 31
│       ├── 20261020_repair32_hebrew_literals_fix.sql # Repair 32 hotfix: re-creates search_clients_for_picker + delete_transaction whose Hebrew literals were corrupted (U+FFFD) by a shell-piped apply
│       ├── 20261020_il_working_days.sql              # Repair 32: il_non_working_days (19 rows) + bhr_is_workday + holiday-aware bhr_add_business_days (STABLE, SECURITY DEFINER, anon revoked)
│       ├── 20261020_2_attendance_recruiter_window.sql # Repair 32: recruiter attendance writes limited to the current month (RLS)
│       └── 20261017_2_hours_deals_backfill.sql       # Repair 25: fill-only, idempotent backfill of hours deals (service type, kind, period, rate, net, close date, closing month/year); excludes recruitment-signal rows and probable duplicates of a paid deal
│
├── scripts/
│   └── generate-icons.mjs              # PWA icon generation
│
├── public/                             # Static assets + PWA icons
├── EMPLOYEE_MOBILE_INSTALL_GUIDE.md    # iPhone PWA install guide for team (Hebrew)
├── vite.config.ts
├── components.json                     # shadcn/ui config
├── vercel.json                         # SPA rewrite rules
├── package.json
└── .env.local                          # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (never commit)
```

**Prompts directory** (sibling of App Dev, at `C:\Users\Oren\BHR Console\prompts\`):
- Active Claude Code prompts follow the pattern `repair{N}-*.md` or `feature-*.md`
- Completed prompts are deleted after the task is live (full history: `DOCS/PHASE-HISTORY.md`)
- **`prompts/` is empty — this is the normal resting state** (verified: 2026-10-06). A prompt file that survives its own phase is a bug: delete it as the final step of every phase, right after it's live and verified. (`cleanup-d141e376-billing-event.md`, once listed here as a pending open item, was deleted 2026-10-06 — it encoded a destructive instruction derived from a stale reading of the d141e376 transaction; see Billing Events → event_index integrity below for what that transaction actually is.)

---

## Routes

| Route | Page | Roles |
|---|---|---|
| `/` | Dashboard | admin, administration, recruiter |
| `/clients` | Clients | admin, administration |
| `/transactions` | Transactions | admin, administration, recruiter |
| `/hours` | Hours | admin, administration, recruiter |
| `/attendance` | Attendance (check-in/out + report; recruiters: own reports by month) | admin, administration, recruiter (report section: admin, administration only; month table: recruiter only) |
| `/billing-reports` | Billing Reports | admin, administration |
| `/reports` | Reports (דוח גיוסים) | admin |
| `/bonuses` | Bonuses | admin |
| `/team` | Team | admin |
| `/services` | Services | admin |
| `/suppliers` | Suppliers | admin |
| `/users` | Users | admin |
| `/audit-log` | יומן שינויים (Audit log) | admin |
| `/profile` | Profile | all |
| `/login` | Login | public |
| `/set-password` | Set Password | public |
| `/m/hours` | Mobile Hours | all authenticated |
| `/m/attendance` | Mobile Attendance (check-in/out) | all authenticated |
| `/m/profile` | Mobile Profile | all authenticated |

---

## Database Schema (live — all migrations applied as of May 2026)

```
profiles
  id uuid PK → auth.users
  full_name text
  email text
  role text CHECK IN ('admin', 'recruiter', 'administration')
  bonus_model jsonb
  hours_category_enabled bool DEFAULT false
  password_set bool DEFAULT false
  phone text
  status text DEFAULT 'active'
  created_at timestamptz

clients
  id uuid PK
  name text NOT NULL
  company_id text
  tax_id text
  group_name text
  address text
  contact_name text
  phone text
  email text
  status text DEFAULT 'active'
  notes text
  -- Financial fields (added Phase 1 — 20260509_phase1_clients.sql)
  commission_percent numeric
  warranty_days int
  payment_terms text               -- stored as "שוטף+X" format (e.g. "שוטף+30")
  payment_split_json jsonb         -- array of {percent, days} — drives billing event splits
  advance_type text CHECK IN ('fixed', 'percent')
  advance_amount numeric
  hourly_rate numeric
  time_log_enabled bool DEFAULT false
  created_at timestamptz

agreements
  ⚠️ DEPRECATED — DO NOT WRITE. verified 2026-10-06: table exists, 0 rows
  (always has — not "legacy data", there never was any). The only code that
  reads it (`getClients`/`getClientById` in `lib/clients.ts`, via a join,
  feeding the `ClientWithAgreement`/`Agreement` types) has zero callers
  anywhere in the app — dead code reading a dead table. Recommend DROPPING
  the table and deleting `getClients`/`getClientById`/`ClientWithAgreement`/
  `Agreement` — nothing would break (grep-confirmed zero call sites); not
  executed this phase since Repair 19 only explicitly authorized dropping
  `billing_percent`. The real, actively-used client-agreement feature is
  unrelated: the `client-agreements` Storage bucket + `AgreementUploader.tsx`
  + the `extract-agreement` edge function — do not confuse the two.

transactions
  id uuid PK
  kind text CHECK IN ('service', 'time_period')
  client_id uuid → clients
  client_name text NOT NULL
  position_name text
  candidate_name text
  service_type text
  service_type_id uuid → service_types
  custom_fields jsonb DEFAULT '{}'      -- גיוס also carries final_salary, position_number, candidate_number: hardcoded TransactionDialog renders keyed off isGiyus, NOT entries in service_types.fields jsonb (Batch 8 Phase 2)
  salary numeric
  commission_percent numeric
  net_invoice_amount numeric
  commission_amount numeric
  service_lead text
  entry_date date
  billing_month int
  billing_year int
  close_date date                  -- added back (Repair 1) after Phase 2 removal
  closing_month int
  closing_year int
  payment_date date
  payment_status text
  is_billable bool
  invoice_number text              -- legacy field, do not use for new logic
  work_start_date date
  warranty_end_date date
  period_start date
  period_end date
  hours_total numeric
  hourly_rate_used numeric
  time_sheet_pdf_path text
  notes text
  supplier_id uuid → suppliers
  supplier_percent numeric
  work_end_date date
  -- Approval fields (added Phase 2 — 20260509_phase2_transactions.sql)
  created_by uuid → profiles
  approved_by uuid → profiles
  approved_at timestamptz
  needs_approval bool DEFAULT false
  created_at timestamptz

billing_events                     -- Source of truth for all money events (added Phase 2)
  id uuid PK
  transaction_id uuid → transactions NOT NULL
  event_index int NOT NULL         -- 1-based, order within transaction
  amount numeric NOT NULL          -- gross amount minus advance
  description text                 -- auto-generated label
  billing_date date                -- תאריך חיוב מתוכנן — the SYSTEM'S internal PLANNING field only, never shown as a document date (Repair 19 removed its last UI slot in TransactionDialog). Still drives the pending→to_bill transition and every "not yet invoiced" worklist. Set by generators only.
  invoice_date date                -- תאריך הפקה (relabelled from תאריך חיוב, Repair 19) — the REAL חשבון עסקה issue date, user-entered. Added 20261003_collection_model.sql (Repair 17). Defaults to today when invoice_number is entered with none set; cleared together with invoice_number.
  status text CHECK IN ('pending', 'to_bill', 'billed', 'paid', 'cancelled')
  invoice_number text              -- חשבון עסקה number (entered manually)
  payment_date date                -- תאריך תשלום (relabelled from תאריך תשלום בפועל, Repair 19) — ACTUAL receipt date only (when money arrived). Auto-set to today when receipt_number is entered and it was empty. Repair 17: must be NULL on every non-paid row — enforced by buildBillingEventPatch() going forward.
  due_date date                    -- תאריך תשלום צפוי (relabelled from תאריך פירעון, Repair 19) — EXPECTED payment date, trigger-maintained from invoice_date ONLY (Repair 19, Part B3.1 — no more COALESCE with billing_date: before a חשבון עסקה is issued there is no expected payment date, full stop). See below.
  due_date_is_manual bool DEFAULT false  -- true = an admin typed an explicit due_date override; the trigger leaves it alone until reset. Added 20260913_due_date.sql.
  receipt_number text              -- חשבונית מס קבלה number (entered manually → triggers paid)
  advance_applied numeric DEFAULT 0
  supplier_amount numeric DEFAULT 0
  created_at timestamptz
  updated_at timestamptz

attendance_log                     -- Employee check-in/out log (Feature: Attendance)
  id uuid PK
  profile_id uuid → profiles NOT NULL (ON DELETE CASCADE)
  action text CHECK IN ('check_in', 'check_out')
  logged_at timestamptz DEFAULT now()
  work_date date NOT NULL           -- derived from logged_at AT TIME ZONE 'Asia/Jerusalem' by BEFORE trigger
  notes text
  created_at timestamptz
  -- RLS: insert own (profile_id = auth.uid()); select own OR admin/administration (current_user_role());
  --      update/delete admin only — PLUS (Repair 32) recruiter own-row insert/update/delete restricted to the CURRENT calendar month (Asia/Jerusalem) via bhr_in_current_month_il(work_date) in policies attendance_insert_own / attendance_recruiter_update / attendance_recruiter_delete (insert/update also refuse logged_at in the future). Report names come from SECURITY DEFINER public.list_profiles_for_attendance().

attendance_edit_requests           -- Employee-submitted correction requests (Feature: Attendance V2)
  id uuid PK
  attendance_log_id uuid → attendance_log NOT NULL (ON DELETE CASCADE)
  profile_id uuid → profiles NOT NULL (ON DELETE CASCADE)
  requested_at timestamptz DEFAULT now()
  proposed_logged_at timestamptz NOT NULL
  proposed_notes text
  reason text NOT NULL
  status text DEFAULT 'pending' CHECK IN ('pending','approved','rejected')
  reviewed_by uuid → profiles
  reviewed_at timestamptz
  -- RLS: insert own (profile_id = auth.uid()); select own OR admin/administration;
  --      UPDATE admin only (approve/reject). Approve copies proposed_logged_at/proposed_notes onto the attendance_log row.
  -- NOTE: two FKs to profiles (profile_id, reviewed_by) → embeds must disambiguate:
  --       profiles!attendance_edit_requests_profile_id_fkey(full_name)

team_members
  id uuid PK
  name text
  role text
  email text
  status text
  bonus_model jsonb
  hours_category_enabled bool
  portal_token text

hours_log
  id uuid PK
  team_member_id uuid → team_members
  profile_id uuid → profiles
  client_name text
  client_id uuid → clients
  visit_date date
  hours numeric
  description text
  hours_category text
  start_time time
  end_time time
  billed_transaction_id uuid → transactions
  month int
  year int
  created_at timestamptz

service_types
  id uuid PK
  name text NOT NULL
  display_order int
  fields jsonb                     -- array of ServiceField — drives dynamic fields in TransactionDialog

client_time_log_permissions
  client_id uuid → clients
  profile_id uuid → profiles

suppliers
  id uuid PK
  first_name text
  last_name text
  email text
  mobile text
  created_at timestamptz

audit_log                          -- Repair 24, append-only, admin SELECT only (RLS policy admin_audit_log_read; no insert/update/delete policies; service_role keeps table privileges for maintenance)
  id bigserial PK, occurred_at, txid, actor_id uuid (auth.uid(); null = system), actor_name (snapshot)
  table_name IN ('transactions','billing_events','clients','hours_log'), row_id, parent_id, business_key, action IN ('insert','update','delete')
  row_label text, changes jsonb       -- update: {col:{old,new}} changed cols only (custom_fields diffed one level deeper); insert/delete: full snapshot
  -- Written ONLY by trigger bhr_audit_row() (SECURITY DEFINER, EXECUTE revoked from everyone; exception guard — a logging failure never rolls back a save).
  -- Read ONLY via get_audit_log(p_from,p_to,p_actor,p_table,p_search,p_limit,p_offset) (SECURITY DEFINER, admin check inside), which collapses the save RPC's delete+reinsert of unchanged events (same txid + business_key; identical snapshots → dropped, differing → ONE update).

billing_reports
  id uuid PK
  client_id uuid → clients
  period_start date
  period_end date
  issued_at timestamptz
  issued_by uuid → profiles
  transaction_ids uuid[]
  total_amount numeric
  pdf_storage_path text
  notes text
  filter_client_id uuid
  filter_period_start date
  filter_period_end date
  filter_payment_status text
  filter_include_service bool
  filter_include_time_period bool
```

---

## Billing Events — Business Logic

### Collection model — confirmed by Oren 2026-10-03 (Repair 17)

Oren's own description of the real process: *"אני שולח חשבונות עסקה ללקוחות
כדרישת תשלום. הם נשלחים ממערכת הנהח"ש ומתועדים כאן כחשבון עסקה עם תאריך —
זה המועד שבו נשלח החשבון אל הלקוח כדרישת תשלום. לכל לקוח יש תנאי תשלום
(שוטף, שוטף + 30 וכד). תאריך פרעון נגזר ממועד החיוב ותנאי התשלום. כשלקוח
משלם, יוצאת חשבונית מס קבלה שמתועדת במערכת עם מספר ותאריך — זה מועד תשלום
בפועל."*

**Field model — current (Repair 19, 2026-10-06, Part B).** Two documents,
each a number **and** date set/cleared together, plus one derived date, plus
one internal-only system field with no UI slot in TransactionDialog:

| Column | Hebrew label (current) | Hebrew label (before Repair 19) | Meaning | Set by |
|---|---|---|---|---|
| `billing_date` | *(no UI label — internal only)* | תאריך חיוב מתוכנן | the system's internal PLAN — when the generator expects to invoice (end of hours month; last הדרכה execution date; `work_start_date` + split days; `entry_date` for the advance). Still drives the pending→to_bill transition, BillingReports' own תאריך חיוב מתוכנן column, and every "not yet invoiced" worklist — just no longer shown or editable inside TransactionDialog's billing-event block | generators only, never the real invoice date |
| `invoice_number` + `invoice_date` | **מספר חשבון עסקה** + **תאריך הפקה** | מספר חשבון עסקה + תאריך חיוב | the REAL חשבון עסקה — when the invoice was actually issued | user, via TransactionDialog / BillingReports |
| `due_date` | **תאריך תשלום צפוי** | תאריך פירעון | expected payment date, derived from `invoice_date` ONLY (Part B3.1 — no `billing_date` fallback: before a חשבון עסקה is issued there is no expected payment date, full stop) + the client's payment-term shape (see "Payment terms" below) — **DB-trigger-maintained** | trigger (`bhr_billing_events_set_due_date`); can be manually overridden (`due_date_is_manual`) |
| `receipt_number` + `payment_date` | **מספר חשבונית מס קבלה** + **תאריך תשלום** | מספר חשבונית מס קבלה + תאריך תשלום בפועל | the REAL חשבונית מס קבלה — when money actually arrived | user |

Before Repair 19, `due_date` fell back to `billing_date` when no invoice
existed yet, so almost every open event carried a provisional expected date.
That fallback is gone: a not-yet-invoiced event now has **no** expected
payment date at all (NULL `due_date`) — this is the normal, common
lifecycle stage (טרם חויב), not an error, and every surface that shows
`due_date` has an explicit state for it (see `DueDateCell`'s `hasBasis`
prop, and TransactionDialog's `notYetInvoiced` state) distinct from the
Repair 18 "terms missing" state.

**Document-pairing rule (§3.3):** a document's number and date are always
set and cleared together — entering `invoice_number`/`receipt_number` with
no existing date defaults that date to today (still editable after);
clearing the number also clears the date. `payment_date` is never editable
on a row with no `receipt_number`. The ONLY place that applies this rule
and computes `status` is `buildBillingEventPatch()` in
`src/lib/billingEvents.ts` — every save site (TransactionDialog's
`BillingEventRow`, BillingReports' `BillingEventDashRow`) must call it,
never set `status` or a paired date/number by hand.

**Status** (`computeEventStatus`, unchanged table, now the only writer):

| Stored value | Condition | UI bucket |
|---|---|---|
| `cancelled` | set manually; nothing overrides it | מבוטל |
| `paid` | `receipt_number` present | שולם |
| `billed` | `invoice_number` present, no receipt | ממתין לתשלום |
| `to_bill` | no invoice, transaction approved, `billing_date <= today` | טרם חויב (לחיוב עכשיו) |
| `pending` | no invoice, and (not approved OR `billing_date > today`) | טרם חויב |

⚠️ `computeEventStatus`'s `status === 'billed'` branch is a deliberate
one-way lock for ITS OTHER caller (event regeneration on save, which must
never downgrade an already-billed/paid row it has no fresh invoice_number
for) — `buildBillingEventPatch` resets to a neutral baseline before calling
it (except `cancelled`, kept sticky) specifically so that clearing an
invoice number on a billed row correctly demotes it, instead of staying
"billed" forever. Caught live during Repair 17 QA — if you ever touch
either function again, re-verify this interaction.

- `payment_date` must only ever be non-null on `paid` rows — before
  2026-09-13 it was overloaded to mean both expected and actual payment
  date (see Feature: Expected Payment Date below for why they were split);
  Repair 17 (2026-10-03) found and cleared 3 more leftover rows the
  due_date migration had backfilled `due_date` from but never cleared.
- **Dropped (2026-10-03, Repair 17; re-verified gone from the live schema
  2026-10-06):** `transactions.invoice_sent_date`, `payment_due_date`,
  `invoice_number_transaction`, `invoice_number_receipt` — zero references
  then, confirmed zero references and zero columns now.
- **Dropped (2026-10-06, Repair 19):** `transactions.billing_percent` — 0
  non-null rows anywhere, 0 functional code references (only the TS type
  declaration and a comment explicitly saying it wasn't used); this had
  been "noted as dead" since Batch 8 Phase 3 (2026-08-23) without ever
  being finished. `transactions.invoice_number` (singular, legacy) remains
  dead but undropped — a separate, still-open decision.

### Payment terms — two date shapes (Repair 19, 2026-10-06)

`payment_terms` on the client resolves to exactly one of two shapes, never
both — `bhr_payment_term_spec()` (SQL) / `parsePaymentTermSpec()` (TS, in
`src/lib/billingEvents.ts`) is the one parser for both:

| Shape | Vocabulary | Formula |
|---|---|---|
| `'eom'` | `שוטף` (0 days); `שוטף+30`, `שוטף + 30`, `שוטף30`, `שוטף 30`, `שוטף+30 יום` (30 days); a bare integer e.g. `30`, `45`, `60`, or `30 יום` (that many days) | end of the invoice_date's calendar month, + N calendar days |
| `'business'` | `מיידי`, `מידי`, `לתשלום מיידי`, `תשלום מיידי` (always 5 days) | invoice_date + N **business days**, Sunday–Thursday (Israeli work week) |

All vocabulary matching strips whitespace first, so `שוטף + 30` and
`שוטף30` are the same input. Anything else (e.g. a client's terms field
containing free text that matches none of the above) → shape `NULL` → no
usable terms → `due_date` stays NULL, never a guess (Repair 18's rule,
unchanged — this is the `bhr_payment_term_days_strict(...)  IS NULL` / shape
`IS NULL` audit condition).

**Oren, 2026-10-06, on `מיידי`:** *"לתשלום מיידי אומר שהתשלום יתקבל בתוך 5
ימי עסקים."* Worked example that must hold: invoice_date Wed 2026-10-07 → +5
business days (Thu 8th, Sun 11th, Mon 12th, Tue 13th, Wed 14th) → due
**2026-10-14**.

**Israeli holidays ARE handled since Repair 32 (2026-10-19)** — the "holidays NOT handled" limitation of Repair 19 is gone. A *business day* = a **workday**: Sunday–Thursday AND not in `il_non_working_days` (see "Working days" below). `bhr_add_business_days()` / `addBusinessDays()` are a matched pair over that one calendar.

**`'eom'` example:** invoice_date = 11 May 2026, terms = שוטף+30 → 31 May + 30 = **30 June 2026** (unchanged since Repair 17/18).

Key functions in `src/lib/billingEvents.ts` (client-side PREVIEW only, shown live in TransactionDialog before a row is saved — `bhr_calc_due_date`/`bhr_payment_term_spec` in Postgres are the authoritative implementation that actually persists `due_date`; keep both in lockstep, same matched-pair discipline as Repair 18):
- `parsePaymentTermSpec(terms)` → `{ shape: 'eom' | 'business', days: number } | null`
- `calculateTaxInvoiceDate(invoiceDate, spec)` → applies whichever formula `spec.shape` selects
- `addBusinessDays(iso, days)` → the `'business'` shape's primitive

`bhr_payment_term_days_strict(terms)` (SQL) still exists as a days-only
convenience wrapper for ad-hoc audits (`IS NULL` = unrecognised terms) — it
drops the shape, so never use it for actual date math.

### Status flow

```
pending → to_bill → billed → paid
                  ↘ cancelled
```
- `pending`: created, billing_date in future (or transaction not approved)
- `to_bill`: billing_date ≤ today AND transaction is approved (automatic)
- `billed`: `invoice_number` has been entered
- `paid`: `receipt_number` has been entered
- `cancelled`: manual, or triggered by `work_end_date` being set

### Generation

**Service transactions** — events generated by `generateServiceBillingEvents()`:
- Uses `client.payment_split_json` to split commission across multiple events
- First event deducts `advance_applied` from amount
- `billing_date` = `work_start_date` + `split.days`

**Advance (מקדמה) — since Batch 8 Phase 3.** The advance is a PART OF THE
COMMISSION, never a percentage of gross salary: `resolveAdvanceAmount()`
computes `totalCommission = salary × commissionPercent/100` first, then
applies the fixed/percent advance to that (capped at the total commission
either way). For גיוס specifically, the advance is generated **instantly**
from `entry_date` (תאריך פתיחה) the moment the client has an advance
configured — it does not wait for `work_start_date` like the split events
do. `generateServiceBillingEvents()`'s `workStartDate` param is
`string | null`: when `null` (no work-start date yet), only the advance
event is emitted (event_index 1, `billing_date = advanceBillingDate ??
workStartDate`) and split generation is skipped entirely. Once a
work-start date is added, the next save takes the **full regeneration
path** (not the reconcile-final-salary path) so the advance is re-emitted
at index 1 alongside the newly-computable splits at 2+ — the RPC's
delete-then-insert of pending/to_bill rows means this never produces a
duplicate index-1 row.

**Time-period (hours billing) transactions — rule fixed by Repair 15 (2026-10-03).**
Single event generated by `generateTimePeriodBillingEvent()`, wired into
`TransactionDialog.handleSave` as its own `canGenerateTimePeriod` track (same
carry-forward-manual-survivors / locked-event-warning pattern as הדרכה) AND
into `MyHoursView`'s `hoursBillingMut` (the "הפק חיוב שעות" button — see
below, both paths now call the same generator):
- `amount` = `hours_total × hourly_rate_used`
- `billing_date` = **the last calendar day of the month the report covers**
  (end of `periodEnd`, falling back to `periodStart`, then today) — Oren,
  2026-10-03: *"בהפקת דוח שעות, תאריך החיוב הוא היום האחרון של החודש שעבורו
  הופק הדו"ח. תנאי התשלום הם בהתאם לתנאי התשלום של הלקוח."* Payment terms
  are applied **only** by the `due_date` trigger on top of this — never
  baked into `billing_date` itself (the old code did `addDays(today,
  termDays)`, which double-counted the client's שוטף+X on top of the
  trigger's own שוטף+X). Same shape as the הדרכה rule (billed once
  delivered, `billing_date` = last execution date).

**הדרכה transactions — since Batch 8 Phase 5.** A single event generated by
`generateHadrachaBillingEvent()`, wired into `handleSave` as its own
`canGenerateHadracha` track (mutually exclusive with the גיוס advance/split
tracks — different service types can never both be true). `amount` reuses
the same live total the dialog already displays (`custom.price × number of
execution dates + travel`) — never recomputed separately, so the billed
amount can't drift from what's on screen. `billing_date` = the latest valid
`custom_fields.execution_dates[].date` (validated `^\d{4}-\d{2}-\d{2}$` —
malformed strings are ignored, not trusted), falling back to `entry_date`
when there are none yet. Returns no event at all when the computed amount
is ≤ 0 (an empty/half-filled form never creates a ₪0 row). Regenerates on
every save like the גיוס tracks; a manually-added event (`+ הוסף אירוע`,
always at `event_index` ≥ 2) that hasn't progressed past `pending`/`to_bill`
is carried forward unchanged into the same save's `p_events` so the RPC's
delete-then-insert doesn't wipe it — the RPC deletes by **status**, not by
index, so anything not explicitly re-included in `p_events` is lost. An
already-`billed`/`paid` event is left untouched by the RPC's occupied-index
skip; if the recomputed amount would have differed, `handleSave` shows a
Hebrew warning instead of silently diverging.

### Approval gate
- Transactions with `needs_approval = true` and no `approved_at` are greyed out (opacity-50)
- Billing events for unapproved transactions stay `pending` regardless of billing_date
- Approved = `approved_at IS NOT NULL`

### Management permissions

Billing-event *management* — the "+ הוסף אירוע" manual-add button in
`TransactionDialog.tsx` — is available to **admin and administration**
(`canManageBillingEvents`, since Batch 8 Phase 5). Inline row edits
(`saveField`/`handleDelete` on `BillingEventRow`) were already ungated in
the UI and are RLS-governed regardless. `billing_events` RLS
(`administration_billing_events_all`, `20260509_phase2_transactions.sql`)
has always permitted `administration` full read/write — the button gate
was frontend-only (`isAdmin`) until Phase 5; no migration was ever needed.
Recruiters are excluded from management (their `billing_events` policy is
SELECT-only via `recruiter_billing_events_read` — DROPPED in Repair 31 (2026-10-19): recruiters now have NO access to billing_events) — exposing the button to
them would only produce a confusing RLS failure.

### Persistence: atomic save RPC (since 2026-07-13, see Phase History)

Neither `TransactionDialog.handleSave` nor `MyHoursView`'s `hoursBillingMut`
(the "הפק חיוב שעות" button) writes `transactions`/`billing_events` directly —
**every transaction write in the app goes through this one RPC**, no
exceptions. Each computes the billing-events draft(s) client-side (unchanged —
`generateServiceBillingEvents`/`reconcileFinalSalaryBillingEvents`/
`generateTimePeriodBillingEvent` above) and sends them, alongside the
transaction payload, to a single RPC: `supabase.rpc('save_transaction_with_events',
{ p_mode, p_id, p_payload, p_events, p_flip_to_bill, p_work_end_date })`
(migration `20260712_atomic_save_transaction.sql`, extended by
`20261003_hours_billing_rpc.sql`).
The RPC is `SECURITY DEFINER` and re-implements the `transactions_full_access` authorization
rule itself (admin/administration, or `service_lead` matches the caller) — it must be updated
in lockstep with that RLS policy if the policy ever changes. It performs the transaction
insert/update, the billing-events upsert (mirrors `upsertBillingEvents()` — deletes only
pending/to_bill rows, never billed/paid/cancelled), the past-due pending→to_bill flip, and the
work-end-date cancel-future step all in one DB transaction, so a stall or error partway through
can never leave an orphan transaction row without its billing events.

⚠️ **Any NEW column added to `transactions` or `billing_events` must be added
to the RPC's explicit column list in the SAME change** (both the `update`
`case when p_payload ? '...'` branch and the `insert` values list) — it will
otherwise be silently dropped on every save, not written, with no error.
This has now happened **twice**: `period_start`/`period_end`/`hours_total`/
`hourly_rate_used` were added to `transactions` in `20260422_refinements_batch3.sql`
but never added to the RPC until `20261003_hours_billing_rpc.sql` (Repair 15,
2026-10-03) — every hours transaction saved through the dialog silently lost
them for over two months. Treat this as a standing checklist item whenever a
column is added to either table.

---

## Money terminology (Repair 21, 2026-10-17)

Labels only — no column was renamed. **Every money number comes from `src/lib/finance.ts`** (integer-agorot arithmetic, one rounding point); never add a per-page reducer.

| UI term | Meaning | Source |
|---|---|---|
| **סכום חשבונית** (never "סכום נטו") | billed to the client, before VAT | `transactions.net_invoice_amount`, `billing_events.amount` |
| **עמלת ספק** | the sub-supplier's share | `transactions.supplier_percent`, `billing_events.supplier_amount` |
| **הכנסה** | סכום חשבונית − עמלת ספק | computed (`txIncome` / `eventIncome`), no column |
| **תקבולים** | money actually received = סכום חשבונית of paid events, by `payment_date` | `billing_events` where `status='paid'` |

The bonus engine's base (`amount − supplier_amount`) is הכנסה; its numbers are unchanged, approved-only rule stays in `bonus.ts`. Client-facing documents (billing-report export, hours report, Performa PDF) must never show עמלת ספק or הכנסה. AdminDashboard: monthly chart = הכנסה of paid events (12 Jerusalem months, string month keys); lead widget = הכנסה by lead, current calendar year, all paid events; KPI תקבולים החודש/YTD = סכום חשבונית of paid events.

---

### Admin dashboard KPIs — "מתחילת השנה" (Repair 22, 2026-10-17)

Period = current calendar year in Asia/Jerusalem. Helpers in `finance.ts`: `yearBounds`, `collectionRate`, `contractedInYear`, `groupPaidEvents`.
- **סכום חשבוניות בחוזים** = Σ `txInvoiceAmount` of deals whose `dealDate` is in the year (sub: deal count).
- **עמלות ספקים** = Σ `eventSupplierAmount` of paid events by `payment_date` YTD (sub: contracted Σ `txSupplierAmount`).
- **הכנסה** = Σ `eventIncome` of paid events YTD (sub: contracted Σ `txIncome`). Identity: תקבולים YTD − עמלות ספקים = הכנסה.
- **אחוז גבייה** = paid סכום חשבונית ÷ invoiced סכום חשבונית (invoiced = `invoice_number` set, not cancelled, `invoice_date` in year), by amount; `—` when the denominator is 0.
- **הכנסה לפי סוג שירות**: paid events YTD grouped by service type name (`service_type_id`→name, else `service_type` text, else "ללא סוג שירות"); total equals the הכנסה KPI. Lead card shows distinct deals per lead (leads matched with `normalizeLead`).

---

### דוח כספי שנתי (Repair 23, 2026-10-17)

Year Select = every year with a paid event or a deal, plus the current year (default current, Asia/Jerusalem). Helpers in `finance.ts`: `paidByMonth`, `contractedByMonth`, `openGiyusInYear`, `clientMonthMatrix`, `availableYears`, `metricAgorot`.
- **A — לפי חודש תשלום**: paid events by `payment_date` month → סכום חשבונית / עמלת ספק / הכנסה / עסקאות. Totals-row deal count = DISTINCT transactions over the year (not the sum of monthly counts).
- **B — לפי חודש סגירת עסקה**: deals by `dealDate` month at transaction level. Open גיוס (no close_date) is excluded and shown under the footnote by `entry_date` (count + סכום חשבונית).
- **C — הכנסות לפי לקוח וחודש**: paid events by `payment_date`; metric toggle הכנסה (default) / סכום חשבונית / עמלת ספק; rows grouped by `client_id` (else name text); sticky client column; grand total = A's total for the same metric.
- Excel: `דוח-כספי-{year}.xlsx`, 3 sheets (numeric cells). Identities: A total (current year) = Repair 22 YTD KPIs; C grand = A total.

---

### Hours deals = שירות משאבי אנוש (Repair 25, 2026-10-17)

Oren: hourly billing happens ONLY for this service. **Every hours deal is `שירות משאבי אנוש` (kind='time_period') and every שירות משאבי אנוש deal is an hours deal.** The text 'שעות עבודה' as a service-type name is retired (the billing-event description `שעות עבודה · …` and mobile headings are unrelated wording and stay).
- **תאריך סגירה** = last day of the month of `period_end` (falls back to period_start); `closing_month/year` follow it. Same date as the event's `billing_date`.
- **סכום חשבונית** = `hours_total × hourly_rate_used`, else the sum of the deal's non-cancelled billing events — never NULL when events exist.
- The constant + helpers live in `src/lib/hoursService.ts`; `service_types` has a real row (seeded, no dynamic fields). TransactionDialog pairs service ⇔ kind: picking שירות משאבי אנוש makes it time_period (and vice versa); a legacy hours deal shows the HR service when opened.
- Open גיוס and הדרכה deals legitimately have no close date → NULL closing month (by design).
- `save_transaction_with_events` already carried every needed column (close_date, closing_month/year, service_type_id, net_invoice_amount, period_*, hours_*, hourly_rate_used) in both INSERT and UPDATE lists (verified 2026-10-17) — no RPC change.

---

## Bonus Engine — Business Logic (Repair 16, 2026-10-03)

`src/lib/bonus.ts` is the **single source of truth** for every bonus number in
the app — Bonuses.tsx, RecruiterDashboard.tsx, and BonusWidget.tsx all call
the same `fetchBonusEvents()`/`buildBonusLedger()` pair; there is no other
bonus calculation anywhere. (Before this phase there were three independent,
disagreeing engines — see the Repair 16 Phase History row for the full
diagnosis.)

**Rule since Repair 27 (Oren, 2026-10-17 — supersedes the per-payment attribution of Repair 16/2026-10-03):** *"עסקה נספרת רק כשהיא שולמה במלואה, בשווי המלא ובחודש התשלום האחרון."* The unit is the **deal (transaction)**, not the billing event. Code: `buildBonusDeals()` → `buildLedgerFromDeals()` (`buildBonusLedger` = both composed).

**Actual (בפועל):** a deal is *fully collected* when (1) every non-cancelled billing event is `paid` AND (2) Σ `event.amount` ≥ `net_invoice_amount` − ₪1 (skipped if net is null/0 — the guard stops a גיוס whose advance is paid but whose split events are not generated yet from looking "paid in full"). **Deal value** = Σ (`amount − supplier_amount`) over its non-cancelled events (`finance.ts` agorot). **Month** = month of the **latest** `payment_date` among its events (legacy paid rows with no `payment_date` fall back to `due_date`, then `billing_date`), taken from the date STRING (`.slice(0,7)`), never `new Date().getMonth()`; payroll cut-off unchanged (last day of month → that month, the 1st → next). A partially paid deal contributes **₪0** to every month. Gates unchanged: `service_lead` via `normalizeLead`, approved transactions only, cancelled events ignored.

**Forecast (תחזית):** same unit. A not-yet-collected deal is expected to complete in the latest of: `payment_date` of paid events, `due_date` of open events; a month before the current one rolls forward to the current month and the deal is flagged **באיחור**. **Unknown completion — never invented:** any open event with no `due_date` (reason `not_invoiced` / `terms_missing`, Repair 18/19 semantics), a deal failing the coverage guard (`events_not_generated`), or a fully-paid deal with no date at all (`no_payment_date`) is listed under **"ללא צפי השלמה"** with the Hebrew reason and excluded from every month's forecast. Forecast revenue of month M = actual (deals completed in M) + deals expected in M, each at FULL value; past months: forecast = actual.

**UI (Bonuses.tsx):** one row per deal (לקוח · מס משרה · משרה/מועמד · שווי עסקה (נטו) · נגבה עד כה · סטטוס הושלמה/בגבייה חלקית · תאריך השלמה · סוג בפועל/תחזית + באיחור), each expandable to its payments; current month also shows **"בגבייה חלקית — לא נספר לבונוס"** (partially paid deals not forecast this month) and **"ללא צפי השלמה"**; stat labels "עסקאות שנגבו במלואן" / "צפוי להיגבות במלואו (תחזית)". The old "ללא תאריך" collapsible is subsumed by "ללא צפי השלמה". **Income is NOT bonus (for admin/administration; since Repair 31 recruiters read `my-bonus-overview` and see no income at all):** RecruiterDashboard's "הכנסה החודש" KPI and 6-month chart use `paymentIncomeByMonth()` (per payment, by `payment_date`) and are unchanged; only its bonus hero follows the deal rule (note: "בונוס נספר על עסקאות שנגבו במלואן").

*Historical (Repair 16, superseded 2026-10-17):* "revenue = net of paid events attributed per payment to its payment_date month". Repair 18/19's due_date rules still decide WHEN an open deal can complete.

Tier math (`calculateBonus`/`bonusBreakdown`, unchanged) is non-cumulative —
the bonus for a month is the highest tier whose `min ≤ revenue`; below the
first tier = **₪0** (fixes a real bug: `RecruiterDashboard`'s old
`calcBonusTier` fell back to the lowest tier's bonus via `?? sorted[0]` even
when revenue hadn't reached it). `actualForecastProgress()` is the one
two-layer progress-bar formula every surface uses (current/next tier always
chosen by ACTUAL revenue, never forecast).

Display rule (mandatory everywhere a bonus number appears): בפועל = solid
purple `#7c3aed`; תחזית = light purple `#c4b5fd`, always labelled "תחזית" —
never shown unlabelled. **Override (Repair 33, Oren 2026-10-19; supersedes Repair 32's emerald/amber) — RECRUITER PORTAL ONLY:** the recruiter's bonus panel and chart use the `--bonus-*` tokens in `src/index.css` (light + `.dark`): counted = solid `--bonus-counted` #6d28d9, expected = bordeaux `--bonus-expected` #b5476e drawn striped (`.bonus-stripes`, stripe `--bonus-expected-stripe`), estimate = dashed `--bonus-estimate` #8b5cf6, plus surface / row / track / text / muted / title-ink / chip tokens. Contrast is enforced by `npm run check:contrast` (WCAG AA, both themes; dark counted fill is #8553f1 so white ink stays ≥ 4.5 while the fill stays ≥ 3 against the dark surface/track). Admin, administration, Bonuses.tsx, BonusWidget and AdministrationDashboard keep the purple rule unchanged.

⚠️ Interacts with the `due_date` trigger (Feature: Expected Payment Date):
an open event's `due_date` is whatever the trigger last computed from
`invoice_date` (Repair 19 — was `billing_date` before Part B3.1) + the
client's payment terms, not whatever a caller tried to
insert — confirmed live during QA when a hand-set `due_date` silently got
recomputed by the trigger and correctly shifted which month's forecast the
event landed in.

---

## MIRRORED_KEYS Pattern (TransactionDialog → DB)

These fields exist both in `custom_fields` jsonb AND as top-level DB columns. They are mirrored on save:

```
position_name, candidate_name, commission_percent, salary,
net_invoice_amount, commission_amount, service_lead
```

`SECTION2_MANAGED_KEYS` — these date fields are rendered in their own Section 2 block and must be **skipped** in `renderField()` to avoid duplication:
```
close_date, work_start_date, work_end_date, warranty_end_date
```

---

## Key Patterns

### Auth
```tsx
const { user, profile, loading, signOut, refreshProfile } = useAuth()
// profile.role: 'admin' | 'administration' | 'recruiter'
```

### Data Fetching
```tsx
const { data, isLoading, error } = useTable<Transaction>('transactions', { orderBy: 'entry_date' })
```

### Mutation (with offline support)
```tsx
const mutation = useSafeMutation({
  mutationFn: async (payload) => {
    const { error } = await supabase.from('hours_log').insert(payload)
    if (error) throw error
  },
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hours_log'] }),
})
```

### shadcn Dialog (always dir="rtl")
```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent dir="rtl" className="max-w-lg">
    <DialogHeader><DialogTitle>כותרת</DialogTitle></DialogHeader>
  </DialogContent>
</Dialog>
```

### Role Guard
```tsx
const { profile } = useAuth()
if (profile?.role !== 'admin') return null
```

### Money Display
```tsx
const fmt = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
fmt.format(amount) // → "‏₪1,234"
```

### Date Display
```tsx
import { format } from 'date-fns'
import { he } from 'date-fns/locale'
format(new Date(dateStr), 'dd/MM/yyyy', { locale: he })
```

---

## Infrastructure Access — Non-Negotiable

Claude Code has direct API/CLI access to **Git, Vercel, Supabase, and Resend**.  
**Oren never runs any manual steps. Ever.** All infrastructure is handled autonomously.

- SQL migrations: `supabase db push` or Supabase Management API — never "paste in the SQL editor"
- Deploys: `git push` triggers Vercel; confirm via Vercel CLI or API
- Oren is never asked to perform any terminal, dashboard, or browser action
- **Hebrew in SQL / shell (Repair 32, 2026-10-19):** never pass SQL containing Hebrew through a bash variable or `curl -d "$BODY"` — Windows Git Bash corrupts it to U+FFFD (Repair 31's `c.status = 'פעיל'` became garbage → empty recruiter client picker; `delete_transaction` messages garbled). Apply migrations with a Node `fetch` to the Management API reading the file as UTF-8, and afterwards scan `pg_get_functiondef` for U+FFFD / `???`.

---

## Every Phase Ends with Full QA by Claude Code

Claude Code runs QA — not Oren. QA must be executed (not just listed) before declaring a phase done.

QA must cover:
- DB: query Supabase to confirm new columns, FK links, data integrity
- Live URL: confirm Vercel deploy is up and the app loads
- Functional flows: walk every changed user flow using browser/API tools
- RTL rendering on all changed dialogs/forms
- Empty states, error states, loading states
- Widths: desktop pages at 1440px and 1024px (RTL, no horizontal page scroll). 375px applies ONLY to `/m/*` routes and only when the phase changes them — every mobile device is hard-locked to `/m`, and at 375px the desktop sidebar leaves ~50px of content. Not checking 375px on a desktop-only change is NOT an open item and must not be reported as one (Oren, 2026-10-18, Repair 26)
- **Regression check**: confirm all columns/fields listed in "Canonical Column Orders" are still present

Print `QA COMPLETE ✓` with evidence, then `PHASE N COMPLETE ✓`.

---

## Completion Checklist (mandatory for every task)

1. `npm run build` — zero errors, zero new warnings
2. `npx tsc --noEmit` — clean
3. Apply DB migration via `supabase db push` or Management API — query DB to confirm
4. Commit — atomic, clear message (what changed + why)
5. `git push` to GitHub — triggers Vercel auto-deploy
6. Confirm deploy via Vercel CLI or API — verify live URL responds
7. **Regression check** — count columns in Transactions.tsx table, confirm all 12 present
8. Run full QA (see above) — print `QA COMPLETE ✓`
9. Print `PHASE N COMPLETE ✓`

---

## Architectural Decisions (already made — don't revisit without reason)

- **No Redux / Zustand** — @tanstack/react-query handles all server state; local UI state is `useState`
- **No CSS modules** — TailwindCSS utility classes only, with `cn()` for conditionals
- **shadcn/ui, not custom UI** — add via `npx shadcn@latest add <component>`
- **`agreements` table is deprecated** — do not write to it. 0 rows, 0 live callers (verified 2026-10-06) — see the Database Schema entry above for the drop recommendation.
- **Transaction kinds** — `service` (placements, HR work) and `time_period` (hourly billing). Fields are dynamic via `service_types` + `custom_fields` jsonb.
- **Mobile is a hard lock, not just hours-only** (Batch 8 Phase 1) — any device detected as mobile (`useIsMobileDevice()`: UA regex OR narrow-width+coarse-pointer) is redirected to `/m` on every navigation, enforced at both the `MobileAutoRoute` router effect and the `RequireRole` render boundary (so the desktop shell can't paint even one frame first). There is no opt-out by design — the old `bhr_force_desktop` localStorage escape hatch was removed entirely, not just hidden. `/m/*` itself is still scoped to hours entry + attendance + profile — no admin surfaces.
- **PWA** — standalone app, workbox NetworkFirst for Supabase API calls
- **Bonus model** — JSONB in `team_members` for flexibility
- **Billing events are the financial source of truth** — dashboards and bonus calculations should read from `billing_events`, not `transactions` legacy fields (Phase 3 migration pending)
- **Payment terms resolve to a shape + day count, never a bare integer** — parse with `parsePaymentTermSpec()` (TS) / `bhr_payment_term_spec()` (SQL); `'eom'` (שוטף/שוטף+N/bare integer) or `'business'` (מיידי = 5 business days, Sun-Thu) (Repair 19, 2026-10-06 — see Billing Events → Payment terms above).
- **`billing_events.due_date` = expected payment date (trigger-maintained), `payment_date` = actual receipt date — never conflate them again** (Feature: Expected Payment Date, 2026-09-13).
- **A `due_date` is only ever produced from payment terms the system can actually read and parse, from a חשבון עסקה that has actually been issued — never invented (Repair 18 + Repair 19, 2026-10-04/06).** NULL/missing terms, terms hidden by an RLS bug, terms that don't match a recognized shape, and a not-yet-issued חשבון עסקה (Part B3.1, Repair 19) must all collapse to the SAME `NULL` due_date, never to a guessed one — `?? 30`/`COALESCE(..., 30)` must never be reintroduced on the live path, and `due_date` must never fall back to `billing_date` (`bhr_payment_term_spec`/`bhr_calc_due_date` in SQL, `parsePaymentTermSpec`/`calculateTaxInvoiceDate` in `lib/billingEvents.ts` — a matched pair, change together). The reason: a silent default or fallback makes "no terms configured," "terms I can't see," "terms I can't parse," and "not yet invoiced" all indistinguishable from each other and from a real, committed date — exactly the bug that showed a real-looking תאריך פירעון on קסטרו's account when it had no payment terms at all. Every surface that reads `due_date` must have an explicit state for each of these (see `DueDateCell`'s `hasBasis` prop — invoice_date only, never `?? billing_date` — and TransactionDialog's `termsMissing`/`notYetInvoiced` states) instead of silently showing nothing or a wrong date.
- **Any trigger function that reads a second table must be `SECURITY DEFINER` or it will silently see less than the data owner does (Repair 18, 2026-10-04)** — general architecture trap, not specific to one function. RLS doesn't error when it filters a row out of a join; it just returns fewer rows. A trigger runs under the CALLING role unless the function is `SECURITY DEFINER`, so a trigger-context join to a table the caller doesn't have full RLS visibility into can silently return NULL/fewer rows for a perfectly valid, fully-populated row — with no error anywhere, only quietly wrong data. This is exactly what happened to `bhr_billing_event_payment_terms` (the `due_date` trigger's lookup of a transaction's client's terms): a recruiter's own trigger context couldn't see the client row, so terms that definitely existed looked NULL. Fixed by marking it `SECURITY DEFINER SET search_path = public`. When marking any function `SECURITY DEFINER`, also do an EXPLICIT `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` before re-granting only the roles that should call it — Supabase's schema-level default privileges can hand a function a *direct* grant to `anon`/`authenticated` at creation time, which a bare `REVOKE ALL FROM PUBLIC` does not strip.
- **`bhr_parse_payment_term_days` is DEPRECATED (Repair 18, 2026-10-04)** — kept only as a `COALESCE(bhr_payment_term_days_strict(terms), 30)` wrapper for callers not yet migrated off it. `bhr_payment_term_days_strict` itself (Repair 19, 2026-10-06) is now a derived, days-only view of `bhr_payment_term_spec` — fine for `IS NULL` audits, wrong for date math (drops the shape). Do not call either from new code that computes a date; use `bhr_payment_term_spec` (SQL) / `parsePaymentTermSpec` (TS) directly.
- **`(transaction_id, event_index)` is a DB-enforced unique constraint (Repair 19, 2026-10-06)** — `billing_events_transaction_event_index_unique`. Added after the 2026-10-04 full-database sweep found exactly one legitimate collision (אלדר השקעות's 30/70 split, never incremented past index 1) and confirmed it was the only one. `upsertBillingEvents`'s delete-then-insert already avoided writing into occupied indices defensively; this constraint makes a duplicate impossible to insert at all, from any path, rather than merely unlikely.
- **Bonus unit = the fully-collected DEAL (Repair 27, 2026-10-17)** — supersedes the per-payment attribution below; month = latest payment_date of the deal.
- **Bonus month attribution reversed back to `payment_date` (Repair 16, 2026-10-03)** *(per-payment unit superseded by Repair 27)* — the 2026-09-13 `due_date`-based rule (D5, row above) was wrong per Oren: a bonus is paid with the salary for the month the money actually arrived, cut off at month-end (payment on 31/08 → August bonus; 01/09 → September). `due_date` is used ONLY for the forecast (expected revenue of still-open events) — see Repair 16's Phase History row and the "One Bonus Engine" note in the Billing Events section below.

---

## Deleting a deal (Repair 26, 2026-10-18)

**Root cause of "deals cannot be deleted" (confirmed 2026-10-18):** `hours_log.billed_transaction_id → transactions(id)` has no ON DELETE action, so any deal with linked hours fails with FK 23503 (hours deals — שיבומי / קסטרו); `Transactions.tsx` called the delete mutation with no try/catch, so the failure was silent. `billing_events.transaction_id` is ON DELETE CASCADE (paid events go with the deal). `billing_reports.transaction_ids` is an array with no FK (0 rows reference deals as of 2026-10-18).
- Delete = `DeleteTransactionDialog` → RPC `delete_transaction(p_id, p_hours_action 'release'|'move', p_target_transaction)`: one DB transaction relinks/releases the hours then deletes the deal. SECURITY DEFINER; ⚠ its authorization is **admin and administration only since Repair 31 (2026-10-19)** and must stay in lockstep with RLS policy `transactions_staff_access` (Repair 26's "the deal's own service_lead may delete" is superseded, Oren 2026-10-18). EXECUTE: authenticated only (anon/service_role revoked). The move target must be a `time_period` deal of the same client.
- The FK was deliberately NOT changed to SET NULL — silently releasing billed hours invites double billing; the user chooses.
- `hours_log` is now audited (entity "שעות", link change shown as "קישור לעסקה"). Standing rule from Repair 24 applies.
- Recruiters can't always see the linked hours (hours_log RLS): the dialog then can't show the choice up front; the RPC refuses and the dialog reveals the choice with an inline message.

---

## Audit log (Repair 24, 2026-10-17)

- **Standing rule: any new table that holds business data gets the `bhr_audit_row` trigger in the SAME migration** (and a label entry in `src/lib/auditLabels.ts`).
- `save_transaction_with_events` was deliberately NOT modified (checksum `8c013f4f63988f491dc972e83877de9a` before and after); noise from its delete+reinsert is collapsed on the read side.
- ⚠️ **Known limitation (dated 2026-10-17):** during "התחבר בתור" (impersonation) the session belongs to the impersonated user, so entries are attributed to that user. No workaround built.
- Writes by the service role / Management API / migrations have no `auth.uid()` and show as "מערכת" — including bulk backfills (e.g. Repair 25's).

---

## Collections dashboard math (Repair 28, 2026-10-18)

Trigger: the dashboard showed "גבייה החודש 100% — ₪62,198 מתוך ₪43,600" next to "חורג מתאריך חיוב ₪11,200" (numerator = all payments received in the month; denominator = events whose internal `billing_date` fell in the month; overdue by `billing_date`). Oren's rule: **while a due amount is unpaid, collection is not 100%.** Single helper: `collectionMonth(events, today)` in `finance.ts` (agorot; reuses `isOverduePayment`; `today` = Asia/Jerusalem string; month bounds are strings, never `new Date`). Cancelled events are ignored; "invoiced" = `invoice_number` and `invoice_date` both set; M = current month [mStart, mEnd].

| Name | Definition |
|---|---|
| **T** יעד גבייה החודש | invoiced, `due_date ≤ mEnd`, not settled before the month: `billed`, or `paid` with `payment_date ≥ mStart` (includes overdue carry-over) |
| **C** נגבה מתוך היעד | events in T that are paid with `payment_date` in M |
| **R** נותר לגבייה | T − C |
| ↳ R_late | R with `due_date < today` (= `isOverduePayment`) |
| ↳ R_upcoming | R with `today ≤ due_date ≤ mEnd` |
| **E** התקבל לפני המועד | paid in M, invoiced, `due_date > mEnd` |
| **N** התקבל ללא תאריך צפוי | paid in M, not in T or E |
| **P** נגבה החודש | all paid with `payment_date` in M = C + E + N |
| **O** סכום לגבייה כעת | all `billed` events |
| **W** ממתינים לחשבונית | `to_bill` events: amount + count |

% = C ÷ T, integer, **never clamped**; T = 0 → "—". Aging (donut) = R_late only, by days past `due_date` (1–30/31–60/61–90/90+); unpaid billed events with null `due_date` are shown as a muted line, never dropped. KPI "חורג מתאריך חיוב" was renamed "באיחור תשלום"; top-10 column "תאריך חיוב" → "תאריך תשלום צפוי" (both authorized).

**Identities (hold by construction, verified live 2026-10-18):** C + R = T · R = R_late + R_upcoming · P = C + E + N = AdminDashboard "תקבולים החודש" · R_late = aging total = top-list sum (≤10 rows) = Transactions filter "באיחור" · O = Σ billed.

---

## Brand & logo (Repair 30, 2026-10-18)

- **Single source:** `public/brand/bhr-logo-source.png` (1080×1080 RGBA, transparent; lowercase "b" + superscript "hr"). Brand navy **`#150c82`**. Never redraw the mark.
- **Derived assets** (all produced by `npm run generate:icons` = `scripts/generate-icons.mjs`; commit the outputs): `public/brand/bhr-logo.png` (navy, trimmed, 512px), `bhr-logo-white.png` (pure white, alpha kept), `public/favicon.svg` (navy PNG embedded on a white rounded square), `public/favicon.ico` (16/32/48), `public/icons/*` (icon-192/512, maskable at 55% logo, apple-touch 180 opaque white), and `src/lib/brandLogoData.ts` (generated base64 + aspect for jsPDF and the print window).
- **Usage:** React → `<BrandLogo>` only. Placements: sidebar header (white, 34px, "BHR Console" text kept), Login + SetPassword (navy 72px), `/m` landing + shell (white 28px), hours-report print view (navy), all three PDFs in `pdf.ts` (`addBrandLogo`; text lines kept). Manifest `background_color` #ffffff, `theme_color` stays #7c3aed. PWA precache includes the two logo PNGs, favicon.ico/svg.
- Installed PWAs / iOS home-screen icons cache aggressively: already-installed phone icons may only update after the app is removed and re-added (iOS limitation, not an open item).

---

## Recruiter portal (Repair 31, 2026-10-19)

**Rule (Oren, 2026-10-18):** a recruiter (role `recruiter`, e.g. נועה פולק) opens and updates the deals she works on, reports hours/attendance, and sees her bonus live. She never sees accounting data: סכום חשבונית, הכנסה, עמלת ספק, invoice/receipt numbers, any payment date, billing events/status dots, collection wording, totals rows, company revenue. **שכר and % עמלה stay visible and editable.** Admin and administration are unchanged.

**Data layer (the UI hiding is NOT the control — RLS is):**
- RLS: `transactions_staff_access` (admin + administration only) replaced `transactions_full_access`; `recruiter_billing_events_read` dropped; `clients` never had a recruiter policy. Direct REST by a recruiter returns nothing (verified 2026-10-19). Migrations `20261019_recruiter_portal.sql` (additive RPCs) + `20261019_2_recruiter_lockdown.sql` (RLS + `delete_transaction`, applied after the UI deployed).
- Reads: `my_deals(p_id)` (own service_lead, non-accounting columns, `custom_fields` minus net_invoice_amount/commission_amount), `search_clients_for_picker(p_query, p_id)` (id, name, ח.פ., % עמלה, ימי אחריות — a deliberate small extension of "id, name, ח.פ." because the dialog prefills commission % and warranty), `my_time_log_clients()`. All SECURITY DEFINER, EXECUTE = authenticated only.
- Writes: `recruiter-save-deal` Edge Function — reads the client's billing terms and the deal's events with the service role, runs `buildDealEvents` (same code as the admin dialog), calls `save_transaction_with_events` under the recruiter's own JWT (own-lead authorization unchanged), strips supplier fields from her payload, preserves hidden custom_fields totals, returns only the id. Parity proven 2026-10-19: גיוס insert (advance + 30/70 splits), הדרכה insert and final-salary reconcile produce identical events for a recruiter-saved and an admin-saved deal; a recruiter cannot save another lead's deal.
- Edge Functions share the engine through GENERATED copies: `npm run sync:edge` (scripts/sync-edge-shared.mjs → `supabase/functions/*/lib`, import specifiers rewritten for Deno) then `npm run deploy:edge -- <slug>` (Management API, no CLI). Never edit the copies.

**Bonus:** `my-bonus-overview` (verify_jwt) resolves the caller's service_lead from the JWT and returns (Repair 32 shape) `{ month, months[6 back..2 fwd]{locked_bonus, expected_bonus, locked/expected_deals_count}, locked{bonus,deals_count}, expected{bonus,deals_count,deals[{deal_id,client_name,position_name,candidate_name}]}, current_tier{bonus}|null, next_tier{bonus,deals_to_tier_estimate}|null, top_tier:'locked'|'expected'|null, has_model, workdays_left, pending_unknown_count }` — bonus amounts, counts and deal identifiers only (no revenue, no deal amounts, no shekel thresholds). Same Repair 27 engine (`bonus.ts`), no second rule. `current_tier` follows ACTUAL (locked) revenue (Repair 16); `next_tier` is the first tier ABOVE the month's FORECAST revenue so "expected deals to complete + about N more" is one target; `deals_to_tier_estimate` = ⌈ (next tier min − forecast revenue) ÷ average value of her completed deals in the last 12 months ⌉, min 1, `null` with no history; `next_tier = null` = top tier / no model. `workdays_left` = Israeli workdays after today in the month. Parity vs `bonus.ts`: 100 lead×month rows incl. current-month checks, 0 mismatches (2026-10-19). Only a service_role JWT may pass `lead_name`/`today`/`tiers` (QA parity) — never a browser. **Repair 33 adds** `upcoming[4]` (current month, +1, +2, +3: `{month, counted_bonus, expected_bonus, expected_deals[{deal_id,client_name,position_name,candidate_name}], next_tier_bonus|null, deals_to_next_tier_estimate|null, avg_deal_bonus|null, top_tier_reached, bar{counted,expected,estimate}}`) and `current_month_closed: true`; `expected_bonus` = Repair 27 forecast − counted for that month (parity: 112 lead×month rows, 0 mismatches, 2026-10-19); the next tier is the first tier above that month's forecast revenue; `avg_deal_bonus` = her 12-month locked bonus ÷ completed deals (display + bar). Bar geometry = `src/lib/bonusBar.ts` `barGeometry()` (fill_counted = counted/next, fill_expected = expected/next capped at 1−counted, fill_estimate = min(remaining, n×avg_deal_bonus/next); tested by `npm run test:bonus-bar`). The payload still contains no revenue, no per-deal amounts, no dates.

**Recruiter UI:**
- Dashboard (`RecruiterDashboard.tsx`, Repair 33): the bonus hero of Repair 32 (headline + מובטח/צפוי chips, deal tiles, "נותרו X ימי עבודה") is REPLACED by `src/components/recruiter/UpcomingBonusPanel.tsx` — "הבונוסים הבאים שלך": forward-looking, the current calendar month is treated as closed (nothing asks her to act on it). Four month cards (current month marked "החודש" with a 2px counted border and "נספר לבונוס עד כה: ₪X", then the next three; 4 per row from `xl`, 2 per row `md`–`lg`, stacked below `md`): month name · "{n} עסקאות בדרך" / "עוד לא נפתחו עסקאות" · big expected bonus · "צפוי · ממתין לתשלום מלא" · bar (counted solid / expected striped / estimate dashed, 14px) · requirement line ("לדרגה הבאה (₪X): עוד כ-N עסקאות לפי הממוצע שלך" / "לדרגה הבאה: נדרשות עוד עסקאות" when the estimate is null / "הגעת לדרגה הגבוהה" / for a month with 0 expected deals "פתיחת עסקה אחת עכשיו נותנת ל{חודש} את הצעד הראשון"). Below: "העסקאות שכבר בדרך לבונוס" (one row per deal forecast to complete in the four months, once, month order: client · position/candidate, "ממתינה לתשלום מלא", chip "נכנסת ל{חודש}"; not clickable), a CTA band "פתיחת עסקה חדשה היום נכנסת ל{last month}" + button "פתיחת עסקה" (opens the recruiter new-deal dialog), and a legend. **No conditional wording ("אם", "במידה", "בהנחה") anywhere in the panel (D4).** Strings are feminine as in the design sketch (`docs/design/recruiter-bonus-sketch/Main.dc.html` + `Mobile.dc.html`, the visual source of truth; phones are hard-locked to /m so there is no mobile dashboard). KPIs unchanged from Repair 32: העסקאות הפתוחות שלי · נסגרו החודש · שעות החודש (= attendance hours, D4) · ימי נוכחות חסרים (links to `/attendance?month&missing=1`). Chart "הבונוס שלי": 6 back + current + 2 forward; counted solid (past + counted part), expected bordeaux-striped on top, legend "נספר לבונוס" / "צפוי". Table "העסקאות הפתוחות שלי" unchanged. Admin's "דשבורד עובד" preview renders this same component for the admin's own lead.
- ⚠️ Cache-key rule (Repair 33): a recruiter's `my_deals` result lives under query key `['transactions','mine']`; the admin list is `['transactions']`. They once shared `['transactions']`, so an admin who opened the "דשבורד עובד" preview and then Transactions saw an empty list (found in Repair 33 QA, live since Repair 31). Never reuse one key for two different queryFns.
- Transactions: 8 columns — לקוח (+ממתין לאישור) · משרה / מועמד · שכר · % עמלה · מוביל · תאריך סגירה · תחילת עבודה · פעולות; no totals row, no מועד תשלום row, no חיובים popover, no delete; URL params `pm`/`from`/`to`/`bill` are ignored and stripped; search placeholder/predicate without invoice numbers; deals via `my_deals`.
- TransactionDialog (recruiter): no ספק section, no מקדמה, no billing-events block, no billing texts, no סכום חשבונית / הדרכה total / hours rate+amount, no payment terms / hourly rate under the client; saves via `recruiter-save-deal`; a final-salary change reconciles server-side without a confirm prompt.
- Hours: client list via `my_time_log_clients`; the "הפק דוח" button (rate + amount) is hidden; no shekel figure anywhere on `/hours`, `/attendance`, `/m/*`.
- Routes: recruiters reach only `/`, `/transactions`, `/hours`, `/attendance`, `/profile`, `/m/*`; every other route redirects to `/` (`DEFAULT_LANDING.recruiter = '/'`). Sidebar = דשבורד, עסקאות, יומן שעות, נוכחות.

**Known, dated (2026-10-19), not changed:** הדרכה deals still show מחיר הדרכה and חיוב נסיעות inputs to the recruiter (inputs, not totals — Oren's rule names totals); `team_members` has an "Authenticated full access" policy (ALL, true) and `suppliers` a SELECT-true policy that recruiters can still hit directly; her own profile row (incl. her `bonus_model` tiers) is readable by her. Each is a separate decision.

---

## Working days (Repair 32, 2026-10-19)

**One calendar for the whole system (D1).** A *workday* = Sunday–Thursday that is not an official non-working day. Friday/Saturday are never workdays for any count (missing attendance, expected hours, business days); a report entered on a weekend still shows but is never "missing". Eve days (ערב חג) and Chol HaMoed are workdays.
- Table `il_non_working_days(day pk, name, kind)` — RLS SELECT for authenticated only, writes only through migrations. Seeded with exactly 19 days (18 from Repair 32 + election day 2026-10-27, Oren 2026-10-19, migration `20261021_election_day_2026.sql`): 2026 (Pesach 04-02, 04-08 · Independence Day 04-22 · Shavuot 05-22 · Rosh Hashanah 09-12/09-13 · Yom Kippur 09-21 · Sukkot 09-26 · Simchat Torah 10-03; verified against timeanddate / officeholidays / Bank of Israel) and 2027 (rayclock.co.il/work-hours-2027.html: 04-22, 04-28, 05-12, 06-11, 10-02, 10-03, 10-11, 10-16, 10-23). Not seeded: Purim, Tisha B'Av, Chanukah, Lag BaOmer, Yom HaShoah/HaZikaron, Jerusalem Day, Chol HaMoed, erev days.
- SQL: `bhr_is_workday(date)`, `bhr_add_business_days(date,int)` (STABLE, SECURITY DEFINER, EXECUTE = authenticated + service_role, anon revoked); `bhr_calc_due_date` was made STABLE. TS: `src/lib/ilCalendar.ts` (re-exported `addBusinessDays` in `billingEvents.ts`; Edge copies via `sync:edge`). Tests: `npm run test:calendar` (Pesach/Rosh Hashanah/Yom Kippur cases, TS list == DB table, 200 random dates SQL == TS).
- Effect on data (dry run 2026-10-19): 0 open, non-manual billing events belong to a מיידי client → no `due_date` changed; paid / cancelled / manual events are frozen as before.
- **Expected hours (D6, Oren to confirm):** 8.4 h per workday, 7 h on an erev-holiday workday (`workHours.ts`).

## Recruiter attendance (Repair 32, 2026-10-19)

- `/attendance` for a recruiter = the check-in/out card (no edit-request button) + **"הדיווחים שלי לפי חודש"**: month stepper (default current month, earliest = her first report month), totals (שעות · ימים מדווחים · ימים חסרים), one row per calendar day: תאריך (weekday) · סטטוס (נוכח / חסר / חג / ערב חג · 7 שעות צפויות / היום / עתיד; Fri/Sat show no status) · כניסה · יציאה · סה"כ · הערה · פעולה. `?missing=1` filters to exactly the missing dates.
- **Edit window (D5):** add / edit / delete only for dates in the current month; earlier months are read-only (missing days there read "החודש נסגר — לא ניתן לדווח"). Enforced by RLS (see schema); verified over REST: insert into an earlier month → 403, update/delete of an earlier-month row → 0 rows affected, current-month insert/update/delete → OK. `attendance_edit_requests` UI is hidden for recruiters; admin/administration flow unchanged.
- A "missing" workday = before today, no COMPLETE check-in→check-out pair (an open check-in counts as missing, shown "חסר — חסרה יציאה"). Dashboard card and page use the same `buildMonthDays()`.

---

## Phase History

Full detail for every phase (diagnosis, QA evidence, commits) lives in
**`DOCS/PHASE-HISTORY.md`** — read that file, not this index, before relying
on any historical detail. ⚠️ Numbering rule: each `Repair N` number is used
once — check the highest number already there before writing a new phase;
see `DOCS/PHASE-HISTORY.md`'s own header for the two times this was nearly
broken.

| Phase | One-line summary |
|---|---|
| Baseline → Phase 3 | Roles/RLS, service_types, suppliers, billing_reports, client financial fields, billing_events table, approval workflow, bonus engine v1 |
| `billing_percent` column | Added (later dropped — Repair 19, dead code) |
| Repair 1–14, Repair 5b, 5 (Complete) | Bug fixes: duplicate dates, billing event generation, payment-terms field, two-document billing UI, bonus accrual rules, password-reset loop, UI polish, filters/sorting, save-timeout abort coverage |
| Feature: Impersonation | Admin "התחבר בתור" one-time magiclink login-as |
| Feature: Attendance, Attendance V2 | Check-in/out log, pair display, edit requests, admin approval |
| Feature: Billing Events Engine | Advance as its own event, final_salary reconciliation, manual event add |
| Feature: Billing Reports Accuracy | לגבייה/חויב/שולם totals corrected, AdminDashboard payment-schedule widget |
| Feature: Attendance Admin | Edit both sides of a pair, weekday display, month filter |
| Feature: Approval Notification | Sidebar badge + AdminDashboard card for pending-approval transactions |
| Feature: Form Improvements | גיוס expected/final salary split, הדרכה multi-date billing |
| Fix: Save-Timeout Root Cause | auth.tsx reentrant-lock deadlock; one atomic `save_transaction_with_events` RPC |
| Feature: Mobile Redesign | `/m` landing page, bottom nav, hours/attendance redesign |
| Batch 8 Phase 1–5 | Mobile hard lock; השמה→גיוס merge; advance-as-%-of-commission fix; `/reports` (דוח גיוסים); מנהלה billing permission + הדרכה auto-generation |
| Feature: Expected Payment Date | `due_date`/`due_date_is_manual` columns, trigger-maintained, paid-row freeze |
| Repair 15: Hours Billing Fields | `save_transaction_with_events` gains period/hours columns; hours billing_date = end of report month |
| Repair 16: Bonus Engine | One engine (`bonus.ts`) replaces 3 disagreeing ones; actual=payment_date, forecast=due_date |
| Repair 17: Collection Model | `invoice_date` (real) vs `billing_date` (plan) split; `computeEventStatus` the only status writer; `CollectionForecastDialog` |
| Repair 18: Payment Terms Integrity | `due_date` never invented — SECURITY DEFINER fix + strict terms parser, NULL not 30 |
| Repair 19: מיידי Terms, event_index Integrity, Doc Truth Pass | Two-shape terms (eom/business, 5-business-day מיידי); due_date from invoice_date only (no billing_date fallback); event_index unique constraint; `billing_percent` dropped; this file split out of `CLAUDE.md` |
| Repair 20: Transactions Totals Row | Dynamic סה"כ footer on עסקאות (count + סכום נטו + ממתין לאישור sub-line) from the visible set |
| Repair 21: Amount Terminology & One Finance Engine | `finance.ts`; Transactions columns (−שירות −אישור, +עמלת ספק +הכנסה); סכום נטו → סכום חשבונית / הכנסה / תקבולים everywhere; AdminDashboard widgets on finance.ts |
| Repair 22: Dashboard YTD Finance | Admin dashboard: מתחילת השנה KPI row (contracted סכום חשבוניות, עמלות ספקים, הכנסה, אחוז גבייה), הכנסה by service type (table + donut), deals per lead |
| Repair 23: Annual Finance Report | /reports gains דוח כספי שנתי: by payment month, by deal-close month, client × month matrix + Excel export |
| Repair 24: Audit Log (יומן שינויים) | audit_log + triggers on transactions/billing_events/clients, admin-only /audit-log page, read-side collapse of RPC noise |
| Repair 25: Hours Deals Integrity + Year Filter | שירות משאבי אנוש seeded + one constant; hours deals get service type, end-of-month close date, net amount (forward + backfill of 18); Transactions gains שנה filter |
| Repair 26: Deal Delete, Transactions Filters, QA Width Rule | Root-caused + fixed silent delete failure (hours_log FK): delete_transaction RPC + dialog (release/move hours, billed/paid warning); hours_log audited; Transactions filters (מוביל, סוג שירות, מועד תשלום, חיובים buckets) in the URL; QA widths = desktop 1440/1024, 375 only for /m |
| Repair 27: Bonus = Fully Collected Deals | Bonus engine unit changes from billing event to deal: counts only when every event is paid and covers the contract, at full value, in the last payment month; Bonuses deals table + partial/unknown sections; income figures untouched |
| Repair 28: Collections Dashboard Math | דשבורד גבייה: one helper `collectionMonth` — % = collected ÷ due-this-month (incl. overdue carry-over), never clamped; overdue by `due_date`/`isOverduePayment`, aging + top-10 follow it; W shows amount; no migration |
| Repair 29: Billing Reports Upgrade | Remainder rows (טרם חויב), סטטוס header bucket filter shared with Transactions (`billingBuckets.ts`), תיאור sort, 12 columns fit at 1440, client picker fixed (Card overflow-hidden clipped the dropdown), sidebar reorder; no migration |
| Repair 30: Billing Reports Polish + Company Logo | SortableHead right-aligned everywhere; דוחות חיוב two-line headers + tighter columns + compact client picker (same height as neighbours); company logo (favicon, PWA icons, sidebar, login, mobile, print view, PDFs) via `BrandLogo` + generated assets; no migration |
| Repair 31: Recruiter Portal | Recruiters lose all accounting data at the data layer (RLS lockdown + my_deals / client-picker / hours-clients RPCs); bonus via my-bonus-overview Edge Function (same engine, counts + bonus only); recruiter-save-deal generates billing events server-side (parity proven); new recruiter dashboard (bonus hero, KPIs, chart, open deals), 8-column Transactions, trimmed deal dialog, delete = admin/administration only |
| Repair 32: Recruiter Portal Corrections + Israeli Working Days | Client picker fixed (root cause: corrupted Hebrew literal in the RPC); il_non_working_days + holiday-aware business days (SQL + TS, parity-tested); recruiter bonus hero rewritten (מובטח/צפוי/הערכה, tiles, no conditional wording); שעות החודש = attendance, missing-days card links to the exact dates; recruiter attendance by month with server-enforced current-month edit window |
| Repair 33: Recruiter "Upcoming Bonuses" Panel | Forward-looking panel (current month + next three: counted / expected / estimate), deal list with "נכנסת ל{חודש}" chips, CTA band; new --bonus-* palette (recruiter portal only) + contrast script; payload `upcoming[4]` + bonusBar geometry; chart restyled; admin-visible fix for the ['transactions'] cache-key collision; design sketches versioned in docs/design/ |

