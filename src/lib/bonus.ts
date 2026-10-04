import type { SupabaseClient } from '@supabase/supabase-js'
import type { BonusTier } from './types'

// ---------------------------------------------------------------------------
// Tier math (unchanged — non-cumulative, highest tier reached per month)
// ---------------------------------------------------------------------------

export function calculateBonus(revenue: number, tiers: BonusTier[]): number {
  if (!tiers || tiers.length === 0) return 0
  const sorted = [...tiers].sort((a, b) => a.min - b.min)
  let bonus = 0
  for (const t of sorted) {
    if (revenue >= t.min) bonus = t.bonus
    else break
  }
  return bonus
}

export type BonusBreakdown = {
  revenue: number
  currentTier: BonusTier | null
  nextTier: BonusTier | null
  bonus: number
  progressPct: number
  amountToNext: number
  tierIndex: number
}

export function bonusBreakdown(revenue: number, tiers: BonusTier[]): BonusBreakdown {
  if (!tiers || tiers.length === 0) {
    return { revenue, currentTier: null, nextTier: null, bonus: 0, progressPct: 0, amountToNext: 0, tierIndex: -1 }
  }
  const sorted = [...tiers].sort((a, b) => a.min - b.min)
  let tierIndex = -1
  for (let i = 0; i < sorted.length; i++) {
    if (revenue >= sorted[i].min) tierIndex = i
    else break
  }
  const currentTier = tierIndex >= 0 ? sorted[tierIndex] : null
  const nextTier = tierIndex + 1 < sorted.length ? sorted[tierIndex + 1] : null
  const bonus = currentTier ? currentTier.bonus : 0
  let progressPct = 0
  let amountToNext = 0
  if (nextTier) {
    const lowerBound = currentTier ? currentTier.min : 0
    const span = Math.max(1, nextTier.min - lowerBound)
    progressPct = Math.min(100, Math.max(0, ((revenue - lowerBound) / span) * 100))
    amountToNext = Math.max(0, nextTier.min - revenue)
  } else if (currentTier) {
    progressPct = 100
  }
  return { revenue, currentTier, nextTier, bonus, progressPct, amountToNext, tierIndex }
}

export type ActualForecastProgress = {
  currentTier: BonusTier | null
  nextTier: BonusTier | null
  actualPct: number
  forecastPct: number
  amountToNext: number
}

/**
 * Shared progress-bar math for every two-layer actual/forecast bar in the
 * app (RecruiterDashboard hero, BonusWidget rows, Bonuses cards) — one
 * formula so they can never drift from each other. currentTier/nextTier are
 * always chosen by ACTUAL revenue (never forecast) so "how close am I" means
 * the same thing everywhere.
 */
export function actualForecastProgress(
  actualRevenue: number,
  forecastRevenue: number,
  tiers: BonusTier[],
): ActualForecastProgress {
  const sorted = [...tiers].sort((a, b) => a.min - b.min)
  let idx = -1
  for (let i = 0; i < sorted.length; i++) {
    if (actualRevenue >= sorted[i].min) idx = i
    else break
  }
  const currentTier = idx >= 0 ? sorted[idx] : null
  const nextTier = idx + 1 < sorted.length ? sorted[idx + 1] : null
  if (!nextTier) {
    return { currentTier, nextTier: null, actualPct: 100, forecastPct: 100, amountToNext: 0 }
  }
  const lowerBound = currentTier?.min ?? 0
  const span = Math.max(1, nextTier.min - lowerBound)
  const actualPct = Math.max(0, Math.min(100, ((actualRevenue - lowerBound) / span) * 100))
  const forecastPct = Math.max(0, Math.min(100, ((forecastRevenue - lowerBound) / span) * 100))
  const amountToNext = Math.max(0, nextTier.min - actualRevenue)
  return { currentTier, nextTier, actualPct, forecastPct, amountToNext }
}

// ---------------------------------------------------------------------------
// Repair 16 (2026-10-03) — one bonus engine, actual vs. forecast.
//
// Business rules confirmed by Oren, 2026-10-03 (see prompts/repair16-bonus-engine.md §2):
//
// ACTUAL (בפועל): revenue = net (amount - supplier_amount) of billing_events
// with status = 'paid', for approved transactions, where the employee is the
// מוביל (transactions.service_lead). Month attribution = the month the money
// was ACTUALLY received (payment_date) — this REVERSES the 2026-09-13 (D5)
// rule that attributed by due_date. "בונוס משולם לפי התאריך שבו התקבל הכסף
// בפועל ... אם התקבל תשלום ב-1/9, הסכום לבונוס ישולם כבר במשכורת ספטמבר."
// Fallback for a paid event with NULL payment_date (legacy rows): due_date,
// then billing_date.
//
// FORECAST (תחזית): forecast revenue for month M = actual paid revenue in M
// + expected revenue in M, where expected = net of every OPEN event
// (status IN pending/to_bill/billed, approved transactions only) whose
// due_date falls in M. An open event dated before the first day of the
// current month is rolled forward into the CURRENT month (flagged overdue)
// rather than left stranded in a closed past month. Past months are
// closed: forecast = actual there.
//
// Repair 18 (2026-10-04): an open event with NO due_date (the client's
// payment terms are missing/unparseable — see billingEvents.ts's
// parsePaymentTermDays) is EXCLUDED from every month's forecast —
// `monthKey` stays null and buildBonusLedger already skips null-monthKey
// events — rather than falling back to billing_date (the system's PLAN,
// not a real due date). That fallback used to exist here and silently
// forecast money against a date nobody actually committed to. Excluded
// events are still returned (`excludedFromForecast: true`) so callers can
// report the total instead of letting it vanish — see the Bonuses page note.
//
// Month keys are always derived from the 'YYYY-MM-DD' date STRING
// (`.slice(0, 7)`), never `new Date(...).getMonth()`, to avoid timezone
// drift turning a payment on the 1st into the previous month.
// ---------------------------------------------------------------------------

export type BonusEventStatus = 'pending' | 'to_bill' | 'billed' | 'paid'

export type BonusEvent = {
  id: string
  transaction_id: string
  service_lead: string | null
  client_name: string | null
  position_name: string | null
  candidate_name: string | null
  service_type: string | null
  description: string | null
  status: BonusEventStatus
  amount: number
  supplier_amount: number
  net: number // amount - supplier_amount
  payment_date: string | null
  due_date: string | null
  billing_date: string | null
  monthKey: string | null // 'YYYY-MM', per the rules above
  kind: 'actual' | 'expected'
  overdue: boolean
  // true only for an 'expected' event with a billing_date but no due_date —
  // i.e. excluded from the forecast specifically because the client's
  // payment terms are missing/unparseable (Repair 18), as opposed to a
  // genuinely dateless row (no billing_date either, very rare).
  excludedFromForecast: boolean
}

/** Today's 'YYYY-MM' in Asia/Jerusalem, independent of the browser's local timezone. */
export function currentMonthKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date()).slice(0, 7)
}

/** Trim, collapse inner whitespace, lowercase — for comparing service_lead to profile.full_name. */
export function normalizeLead(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

type RawTxn = {
  service_lead: string | null
  client_name: string | null
  position_name: string | null
  candidate_name: string | null
  service_type: string | null
  needs_approval: boolean
  approved_at: string | null
}

type RawBillingEventRow = {
  id: string
  transaction_id: string
  amount: number | string | null
  supplier_amount: number | string | null
  status: string
  description: string | null
  payment_date: string | null
  due_date: string | null
  billing_date: string | null
  transactions: RawTxn | RawTxn[] | null
}

function toBonusEvent(row: RawBillingEventRow, todayMonthKey: string): BonusEvent | null {
  const t = Array.isArray(row.transactions) ? row.transactions[0] : row.transactions
  if (!t) return null
  if (t.needs_approval && t.approved_at == null) return null

  const amount = Number(row.amount) || 0
  const supplierAmount = Number(row.supplier_amount) || 0
  const net = Math.round((amount - supplierAmount) * 100) / 100
  const status = row.status as BonusEventStatus // query already excludes 'cancelled'

  const base = {
    id: row.id,
    transaction_id: row.transaction_id,
    service_lead: t.service_lead ?? null,
    client_name: t.client_name ?? null,
    position_name: t.position_name ?? null,
    candidate_name: t.candidate_name ?? null,
    service_type: t.service_type ?? null,
    description: row.description,
    status,
    amount,
    supplier_amount: supplierAmount,
    net,
    payment_date: row.payment_date,
    due_date: row.due_date,
    billing_date: row.billing_date,
  }

  if (status === 'paid') {
    // §2.1 fallback chain for legacy rows with no payment_date. Unaffected
    // by Repair 18 — actual bonus is keyed off payment_date, not terms.
    const dateStr = row.payment_date ?? row.due_date ?? row.billing_date
    return { ...base, monthKey: dateStr ? dateStr.slice(0, 7) : null, kind: 'actual', overdue: false, excludedFromForecast: false }
  }

  // Open event: expected revenue, placed by due_date ONLY (Repair 18 — no
  // billing_date fallback; that's the system's plan, not a real due date).
  const dateStr = row.due_date
  let monthKey = dateStr ? dateStr.slice(0, 7) : null
  let overdue = false
  if (monthKey && monthKey < todayMonthKey) {
    overdue = true
    monthKey = todayMonthKey
  }
  const excludedFromForecast = !row.due_date && !!row.billing_date
  return { ...base, monthKey, kind: 'expected', overdue, excludedFromForecast }
}

/**
 * Fetches every non-cancelled billing event (paid = actual, open = expected)
 * for approved transactions, joined to the transaction's service_lead/client/
 * position/candidate/service_type. Pass `leadName` to filter server-side (the
 * RecruiterDashboard's own-employee view); omit it to fetch every event
 * app-wide (Bonuses page / BonusWidget), which callers then group per
 * employee client-side via `normalizeLead`.
 */
export async function fetchBonusEvents(
  supabaseClient: SupabaseClient,
  opts?: { leadName?: string },
): Promise<BonusEvent[]> {
  let query = supabaseClient
    .from('billing_events')
    .select(`
      id, transaction_id, amount, supplier_amount, status, description,
      payment_date, due_date, billing_date,
      transactions!inner (
        service_lead, client_name, position_name, candidate_name, service_type,
        needs_approval, approved_at
      )
    `)
    .neq('status', 'cancelled')

  if (opts?.leadName) {
    query = query.ilike('transactions.service_lead', opts.leadName)
  }

  const { data, error } = await query
  if (error) throw error

  const todayMonthKey = currentMonthKey()
  const rows = (data ?? []) as unknown as RawBillingEventRow[]
  return rows
    .map((row) => toBonusEvent(row, todayMonthKey))
    .filter((e): e is BonusEvent => e != null)
}

export type LedgerMonth = {
  actualRevenue: number
  expectedRevenue: number
  forecastRevenue: number
  actualBonus: number
  forecastBonus: number
  isPast: boolean
  isCurrent: boolean
  events: BonusEvent[]
}

/**
 * Groups events by monthKey and computes actual/expected/forecast revenue +
 * tier bonus for each month present. A month with zero events (for this
 * employee) simply has no entry — callers default to zero/₪0 for those.
 * Sums in agorot integers to avoid float drift, per §3.1.
 */
export function buildBonusLedger(
  events: BonusEvent[],
  tiers: BonusTier[],
  todayKey: string,
): Map<string, LedgerMonth> {
  const byMonth = new Map<string, BonusEvent[]>()
  for (const e of events) {
    if (!e.monthKey) continue
    if (!byMonth.has(e.monthKey)) byMonth.set(e.monthKey, [])
    byMonth.get(e.monthKey)!.push(e)
  }

  const result = new Map<string, LedgerMonth>()
  for (const [monthKey, monthEvents] of byMonth) {
    const isPast = monthKey < todayKey
    const isCurrent = monthKey === todayKey

    const actualCents = monthEvents
      .filter((e) => e.kind === 'actual')
      .reduce((s, e) => s + Math.round(e.net * 100), 0)
    // The overdue roll-forward in fetchBonusEvents already guarantees no
    // 'expected' event can land in a genuinely past month — this filter is
    // the defensive, not the load-bearing, guarantee of that invariant.
    const expectedCents = monthEvents
      .filter((e) => e.kind === 'expected')
      .reduce((s, e) => s + Math.round(e.net * 100), 0)

    const actualRevenue = actualCents / 100
    const expectedRevenue = isPast ? 0 : expectedCents / 100
    const forecastRevenue = isPast ? actualRevenue : actualRevenue + expectedRevenue

    const actualBonus = calculateBonus(actualRevenue, tiers)
    const forecastBonus = isPast ? actualBonus : calculateBonus(forecastRevenue, tiers)

    result.set(monthKey, {
      actualRevenue,
      expectedRevenue,
      forecastRevenue,
      actualBonus,
      forecastBonus,
      isPast,
      isCurrent,
      events: monthEvents,
    })
  }
  return result
}

/** Convenience accessor — returns an empty-but-valid month when nothing exists yet. */
export function ledgerMonth(ledger: Map<string, LedgerMonth>, monthKey: string, isPast: boolean, isCurrent: boolean): LedgerMonth {
  return (
    ledger.get(monthKey) ?? {
      actualRevenue: 0,
      expectedRevenue: 0,
      forecastRevenue: 0,
      actualBonus: 0,
      forecastBonus: 0,
      isPast,
      isCurrent,
      events: [],
    }
  )
}
