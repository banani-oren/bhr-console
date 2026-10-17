import type { SupabaseClient } from '@supabase/supabase-js'
import type { BonusTier } from './types'
import { toAgorot, fromAgorot, eventIncomeAgorot } from './finance'

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
// Repair 27 (2026-10-17/18) — the bonus counts a DEAL only when it is fully
// collected. Supersedes the per-payment attribution of Repair 16.
//
// Oren, verbatim (2026-10-17): "עסקה נספרת רק כשהיא שולמה במלואה, בשווי המלא
// ובחודש התשלום האחרון."
//
// UNIT = the deal (transaction), not the billing event.
//
// ACTUAL (בפועל), approved transactions, employee = מוביל (normalizeLead):
//   A deal is FULLY COLLECTED when (1) every non-cancelled billing event is
//   'paid' AND (2) Σ event.amount ≥ net_invoice_amount − ₪1 (guards a גיוס whose
//   advance is paid but whose split events are not generated yet; skipped when
//   net_invoice_amount is null/0). Deal value = Σ (amount − supplier_amount) of
//   its non-cancelled events (finance.ts agorot helpers). Month = the month of
//   the LATEST payment_date among its events (legacy paid rows with no
//   payment_date fall back to due_date, then billing_date) — month key from the
//   date STRING (.slice(0,7)), never new Date().getMonth(). Payroll cut-off is
//   unchanged: a payment on the last day of a month counts for that month, on the
//   1st for the next. A partially paid deal contributes ₪0 to every month.
//   Gates unchanged: unapproved transactions excluded, cancelled events ignored
//   (a deal whose events are all cancelled is not a deal).
//
// FORECAST (תחזית), same unit: a deal not yet fully collected is expected to
//   complete in the LATEST of: payment_date of paid events, due_date of open
//   events. A month before the current one rolls forward to the current month
//   and the deal is flagged באיחור. If any open event has no due_date (not
//   invoiced yet, or terms missing — Repair 18/19), OR the deal fails the
//   coverage guard (events not generated yet), the completion month is UNKNOWN:
//   the deal is listed under "ללא צפי השלמה" with the reason and excluded from
//   every month's forecast — a date is never invented. Forecast revenue of
//   month M = actual (deals completed in M) + deals expected to complete in M,
//   each at FULL deal value. Past months: forecast = actual.
//
// Unchanged: tier math (non-cumulative, highest tier reached, ₪0 below the
// first), solid purple = בפועל / light purple = תחזית, tiers editable only in
// Team, actualForecastProgress().
// ---------------------------------------------------------------------------

export type BonusEventStatus = 'pending' | 'to_bill' | 'billed' | 'paid'

export type BonusEvent = {
  id: string
  transaction_id: string
  service_lead: string | null
  client_name: string | null
  position_name: string | null
  position_number: string | null
  candidate_name: string | null
  service_type: string | null
  net_invoice_amount: number | null
  description: string | null
  status: BonusEventStatus
  amount: number
  supplier_amount: number
  net: number // amount - supplier_amount
  payment_date: string | null
  due_date: string | null
  billing_date: string | null
  invoice_date: string | null
  /** Per-PAYMENT month (income reporting, Repair 16 semantics): paid → payment_date, open → due_date rolled forward. */
  monthKey: string | null
  kind: 'actual' | 'expected'
  overdue: boolean
  excludedFromForecast: boolean
  excludedReason?: 'not_invoiced' | 'terms_missing'
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
  id?: string
  service_lead: string | null
  client_name: string | null
  position_name: string | null
  candidate_name: string | null
  service_type: string | null
  net_invoice_amount: number | string | null
  custom_fields: Record<string, unknown> | null
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
  invoice_date: string | null
  transactions: RawTxn | RawTxn[] | null
}

function toBonusEvent(row: RawBillingEventRow, todayMonthKey: string): BonusEvent | null {
  const t = Array.isArray(row.transactions) ? row.transactions[0] : row.transactions
  if (!t) return null
  if (t.needs_approval && t.approved_at == null) return null

  const amountAg = toAgorot(row.amount)
  const supplierAg = toAgorot(row.supplier_amount)
  const amount = fromAgorot(amountAg)
  const supplierAmount = fromAgorot(supplierAg)
  const net = fromAgorot(amountAg - supplierAg)
  const status = row.status as BonusEventStatus // query already excludes 'cancelled'
  const pn = (t.custom_fields ?? {})['position_number']
  const contract = t.net_invoice_amount == null || t.net_invoice_amount === '' ? null : Number(t.net_invoice_amount)

  const base = {
    id: row.id,
    transaction_id: row.transaction_id,
    service_lead: t.service_lead ?? null,
    client_name: t.client_name ?? null,
    position_name: t.position_name ?? null,
    position_number: pn == null || pn === '' ? null : String(pn),
    candidate_name: t.candidate_name ?? null,
    service_type: t.service_type ?? null,
    net_invoice_amount: contract != null && Number.isFinite(contract) ? contract : null,
    description: row.description,
    status,
    amount,
    supplier_amount: supplierAmount,
    net,
    payment_date: row.payment_date,
    due_date: row.due_date,
    billing_date: row.billing_date,
    invoice_date: row.invoice_date,
  }

  if (status === 'paid') {
    const dateStr = row.payment_date ?? row.due_date ?? row.billing_date
    return { ...base, monthKey: dateStr ? dateStr.slice(0, 7) : null, kind: 'actual', overdue: false, excludedFromForecast: false }
  }

  const dateStr = row.due_date
  let monthKey = dateStr ? dateStr.slice(0, 7) : null
  let overdue = false
  if (monthKey && monthKey < todayMonthKey) {
    overdue = true
    monthKey = todayMonthKey
  }
  const excludedFromForecast = !row.due_date && !!row.billing_date
  const excludedReason = excludedFromForecast
    ? (row.invoice_date ? 'terms_missing' as const : 'not_invoiced' as const)
    : undefined
  return { ...base, monthKey, kind: 'expected', overdue, excludedFromForecast, excludedReason }
}

/**
 * Fetches every non-cancelled billing event (paid + open) for approved
 * transactions, joined to the transaction's service_lead/client/position/
 * candidate/service_type/net_invoice_amount/custom_fields. Pass `leadName` to
 * filter server-side (RecruiterDashboard); omit it to fetch every event
 * app-wide (Bonuses page / BonusWidget), grouped per employee client-side.
 */
export async function fetchBonusEvents(
  supabaseClient: SupabaseClient,
  opts?: { leadName?: string },
): Promise<BonusEvent[]> {
  let query = supabaseClient
    .from('billing_events')
    .select(`
      id, transaction_id, amount, supplier_amount, status, description,
      payment_date, due_date, billing_date, invoice_date,
      transactions!inner (
        service_lead, client_name, position_name, candidate_name, service_type,
        net_invoice_amount, custom_fields, needs_approval, approved_at
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

// ── Deal layer (Repair 27) ─────────────────────────────────────────────────

export type BonusDealUnknownReason = 'not_invoiced' | 'terms_missing' | 'events_not_generated' | 'no_payment_date'

export type BonusDeal = {
  transaction_id: string
  service_lead: string | null
  client_name: string | null
  position_name: string | null
  position_number: string | null
  candidate_name: string | null
  service_type: string | null
  contractAmount: number | null // net_invoice_amount
  dealIncome: number // Σ net of the deal's non-cancelled events
  collectedIncome: number // Σ net of its paid events
  events: BonusEvent[] // the deal's payments, sorted by date
  status: 'complete' | 'partial' | 'open'
  completionMonthKey: string | null // actual (complete) or expected (else); null = unknown
  completionDate: string | null // latest payment_date / expected due_date (dd/MM/yyyy display)
  kind: 'actual' | 'expected' | 'unknown'
  overdue: boolean
  unknownReason?: BonusDealUnknownReason
}

const eventSortDate = (e: BonusEvent) => (e.status === 'paid' ? (e.payment_date ?? e.due_date ?? e.billing_date) : (e.due_date ?? e.billing_date)) ?? ''

/** Groups events into deals and classifies each per the Repair 27 rules above. */
export function buildBonusDeals(events: BonusEvent[], todayKey: string): BonusDeal[] {
  const byTxn = new Map<string, BonusEvent[]>()
  for (const e of events) {
    const arr = byTxn.get(e.transaction_id)
    if (arr) arr.push(e); else byTxn.set(e.transaction_id, [e])
  }

  const deals: BonusDeal[] = []
  for (const [transaction_id, evs] of byTxn) {
    const sorted = [...evs].sort((a, b) => eventSortDate(a).localeCompare(eventSortDate(b)))
    const first = sorted[0]
    const amountAg = sorted.reduce((s, e) => s + toAgorot(e.amount), 0)
    const incomeAg = sorted.reduce((s, e) => s + eventIncomeAgorot(e), 0)
    const paid = sorted.filter((e) => e.status === 'paid')
    const open = sorted.filter((e) => e.status !== 'paid')
    const collectedAg = paid.reduce((s, e) => s + eventIncomeAgorot(e), 0)
    const contractAg = first.net_invoice_amount != null ? toAgorot(first.net_invoice_amount) : 0
    const coverageOk = contractAg <= 0 || amountAg >= contractAg - 100 // ₪1 tolerance
    const allPaid = open.length === 0
    const complete = allPaid && coverageOk

    const status: BonusDeal['status'] = complete ? 'complete' : paid.length > 0 ? 'partial' : 'open'
    let completionMonthKey: string | null = null
    let completionDate: string | null = null
    let kind: BonusDeal['kind'] = 'unknown'
    let overdue = false
    let unknownReason: BonusDealUnknownReason | undefined

    if (complete) {
      // latest payment month; legacy paid rows with no payment_date fall back to due_date, then billing_date
      const dates = paid.map((e) => e.payment_date ?? e.due_date ?? e.billing_date).filter((d): d is string => !!d).sort()
      const last = dates[dates.length - 1] ?? null
      if (last) {
        completionMonthKey = last.slice(0, 7)
        completionDate = last
        kind = 'actual'
      } else {
        unknownReason = 'no_payment_date'
      }
    } else if (!coverageOk) {
      unknownReason = 'events_not_generated'
    } else if (open.some((e) => !e.due_date)) {
      unknownReason = open.some((e) => !e.invoice_date) ? 'not_invoiced' : 'terms_missing'
    } else {
      const dates = [
        ...paid.map((e) => e.payment_date ?? e.due_date ?? e.billing_date),
        ...open.map((e) => e.due_date),
      ].filter((d): d is string => !!d).sort()
      const last = dates[dates.length - 1]
      let key = last.slice(0, 7)
      completionDate = last
      if (key < todayKey) { key = todayKey; overdue = true }
      completionMonthKey = key
      kind = 'expected'
    }

    deals.push({
      transaction_id,
      service_lead: first.service_lead,
      client_name: first.client_name,
      position_name: first.position_name,
      position_number: first.position_number,
      candidate_name: first.candidate_name,
      service_type: first.service_type,
      contractAmount: first.net_invoice_amount,
      dealIncome: fromAgorot(incomeAg),
      collectedIncome: fromAgorot(collectedAg),
      events: sorted,
      status,
      completionMonthKey,
      completionDate,
      kind,
      overdue,
      unknownReason,
    })
  }
  return deals
}

export type LedgerMonth = {
  actualRevenue: number
  expectedRevenue: number
  forecastRevenue: number
  actualBonus: number
  forecastBonus: number
  isPast: boolean
  isCurrent: boolean
  deals: BonusDeal[]
}

/** Aggregates DEALS by completion month (agorot integers). Unknown deals have no month and are not here. */
export function buildLedgerFromDeals(
  deals: BonusDeal[],
  tiers: BonusTier[],
  todayKey: string,
): Map<string, LedgerMonth> {
  const byMonth = new Map<string, BonusDeal[]>()
  for (const d of deals) {
    if (!d.completionMonthKey || d.kind === 'unknown') continue
    if (!byMonth.has(d.completionMonthKey)) byMonth.set(d.completionMonthKey, [])
    byMonth.get(d.completionMonthKey)!.push(d)
  }

  const result = new Map<string, LedgerMonth>()
  for (const [monthKey, monthDeals] of byMonth) {
    const isPast = monthKey < todayKey
    const isCurrent = monthKey === todayKey
    const actualCents = monthDeals.filter((d) => d.kind === 'actual').reduce((s, d) => s + toAgorot(d.dealIncome), 0)
    // An expected deal can never land in a past month (roll-forward) — the isPast guard is defensive.
    const expectedCents = monthDeals.filter((d) => d.kind === 'expected').reduce((s, d) => s + toAgorot(d.dealIncome), 0)

    const actualRevenue = fromAgorot(actualCents)
    const expectedRevenue = isPast ? 0 : fromAgorot(expectedCents)
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
      deals: isPast ? monthDeals.filter((d) => d.kind === 'actual') : monthDeals,
    })
  }
  return result
}

/** Events → deals → ledger. Public signature unchanged from Repair 16 for the callers. */
export function buildBonusLedger(
  events: BonusEvent[],
  tiers: BonusTier[],
  todayKey: string,
): Map<string, LedgerMonth> {
  return buildLedgerFromDeals(buildBonusDeals(events, todayKey), tiers, todayKey)
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
      deals: [],
    }
  )
}

// ── Per-PAYMENT income (NOT bonus) ─────────────────────────────────────────
// RecruiterDashboard's "הכנסה החודש" KPI and 6-month income chart are INCOME
// figures (money received per payment, by payment_date) — Repair 27 deliberately
// leaves them unchanged. This is the Repair 16 per-payment aggregation, kept
// only for those income surfaces.
export function paymentIncomeByMonth(
  events: BonusEvent[],
  todayKey: string,
): Map<string, { actualRevenue: number; expectedRevenue: number; forecastRevenue: number }> {
  const out = new Map<string, { a: number; e: number }>()
  for (const ev of events) {
    if (!ev.monthKey) continue
    const cur = out.get(ev.monthKey) ?? { a: 0, e: 0 }
    const ag = eventIncomeAgorot(ev)
    if (ev.kind === 'actual') cur.a += ag; else cur.e += ag
    out.set(ev.monthKey, cur)
  }
  const res = new Map<string, { actualRevenue: number; expectedRevenue: number; forecastRevenue: number }>()
  for (const [k, v] of out) {
    const isPast = k < todayKey
    const actualRevenue = fromAgorot(v.a)
    const expectedRevenue = isPast ? 0 : fromAgorot(v.e)
    res.set(k, { actualRevenue, expectedRevenue, forecastRevenue: isPast ? actualRevenue : actualRevenue + expectedRevenue })
  }
  return res
}
