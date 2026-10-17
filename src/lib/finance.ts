// Single source of truth for every money definition in the app (Repair 21).
//
//   סכום חשבונית = amount billed to the client, before VAT
//                  (transactions.net_invoice_amount, billing_events.amount)
//   עמלת ספק     = the sub-supplier's share
//                  (transactions.supplier_percent, billing_events.supplier_amount)
//   הכנסה        = סכום חשבונית − עמלת ספק (computed, no column)
//   תקבולים      = סכום חשבונית of PAID events, keyed by payment_date
//
// All arithmetic is done in integer agorot; shekel values are produced only at
// the edge (one division by 100). Never accumulate floats on a money path.
// Month keys come from the 'YYYY-MM-DD' string, never from new Date().getMonth()
// (same timezone-drift rule as bonus.ts).

import { isOverduePayment } from '@/lib/billingEvents'
import type { BillingEventStatus } from '@/lib/types'

export const GIYUS_SERVICE_NAME = 'גיוס'

type Numish = number | string | null | undefined

export type FinanceEvent = {
  amount: Numish
  supplier_amount?: Numish
  status?: string | null
  payment_date?: string | null
}

export type FinanceTransaction = {
  net_invoice_amount?: Numish
  supplier_percent?: Numish
  service_type?: string | null
  close_date?: string | null
  entry_date?: string | null
  period_start?: string | null
}

/** Shekels (number | numeric string | null) → integer agorot. null/''/NaN → 0. */
export function toAgorot(v: Numish): number {
  if (v == null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function fromAgorot(a: number): number {
  return a / 100
}

// ── Event level (agorot) ────────────────────────────────────────────────
export const eventInvoiceAgorot = (ev: FinanceEvent) => toAgorot(ev.amount)
export const eventSupplierAgorot = (ev: FinanceEvent) => toAgorot(ev.supplier_amount ?? 0)
export const eventIncomeAgorot = (ev: FinanceEvent) => eventInvoiceAgorot(ev) - eventSupplierAgorot(ev)

// ── Event level (shekels) ───────────────────────────────────────────────
export const eventInvoiceAmount = (ev: FinanceEvent) => fromAgorot(eventInvoiceAgorot(ev))
export const eventSupplierAmount = (ev: FinanceEvent) => fromAgorot(eventSupplierAgorot(ev))
export const eventIncome = (ev: FinanceEvent) => fromAgorot(eventIncomeAgorot(ev))

// ── Transaction level (agorot) ──────────────────────────────────────────
export const txInvoiceAgorot = (t: FinanceTransaction) => toAgorot(t.net_invoice_amount ?? 0)
/** round(invoice × supplier_percent / 100) to the agora. */
export function txSupplierAgorot(t: FinanceTransaction): number {
  const pct = Number(t.supplier_percent ?? 0)
  if (!Number.isFinite(pct) || pct === 0) return 0
  return Math.round((txInvoiceAgorot(t) * pct) / 100)
}
export const txIncomeAgorot = (t: FinanceTransaction) => txInvoiceAgorot(t) - txSupplierAgorot(t)

// ── Transaction level (shekels) ─────────────────────────────────────────
export const txInvoiceAmount = (t: FinanceTransaction) => fromAgorot(txInvoiceAgorot(t))
export const txSupplierAmount = (t: FinanceTransaction) => fromAgorot(txSupplierAgorot(t))
export const txIncome = (t: FinanceTransaction) => fromAgorot(txIncomeAgorot(t))

// ── Sums (single rounding point) ────────────────────────────────────────
export const sumEventInvoice = (evs: FinanceEvent[]) =>
  fromAgorot(evs.reduce((s, e) => s + eventInvoiceAgorot(e), 0))
export const sumEventSupplier = (evs: FinanceEvent[]) =>
  fromAgorot(evs.reduce((s, e) => s + eventSupplierAgorot(e), 0))
export const sumEventIncome = (evs: FinanceEvent[]) =>
  fromAgorot(evs.reduce((s, e) => s + eventIncomeAgorot(e), 0))

// ── Service type ────────────────────────────────────────────────────────
/** The one definition of "is this a גיוס deal" (name of the resolved service type). */
export const isGiyusName = (name: string | null | undefined) => name === GIYUS_SERVICE_NAME
export const isGiyus = (t: { service_type?: string | null }, resolvedName?: string | null) =>
  isGiyusName(resolvedName ?? t.service_type)

/**
 * The date a deal "happened" (shared by Repairs 22/23).
 * גיוס → close_date (null = still-open placement → excluded, returns null).
 * Any other service → entry_date ?? period_start.
 */
export function dealDate(t: FinanceTransaction, resolvedName?: string | null): string | null {
  if (isGiyus(t, resolvedName)) return t.close_date || null
  return t.entry_date || t.period_start || null
}

// ── Received money (תקבולים), keyed by payment_date ─────────────────────
/** 'YYYY-MM-DD' → 'YYYY-MM' (string slice, never Date). */
export const monthKey = (iso: string) => iso.slice(0, 7)

/**
 * Paid events whose payment_date falls in [from, to] (inclusive 'YYYY-MM-DD').
 * Approval is deliberately NOT a filter: money received is received. (The
 * bonus engine keeps its own approved-only rule — a bonus business rule.)
 */
export function paidEventsInRange<T extends FinanceEvent>(events: T[], from: string, to: string): T[] {
  return events.filter((e) => {
    if (e.status !== 'paid' || !e.payment_date) return false
    const d = e.payment_date.slice(0, 10)
    return d >= from && d <= to
  })
}

/** Current year / month in Asia/Jerusalem (no timezone drift near midnight UTC). */
export function jerusalemYearMonth(now: Date = new Date()): { year: number; month: number; today: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now) // YYYY-MM-DD
  return { year: Number(parts.slice(0, 4)), month: Number(parts.slice(5, 7)), today: parts }
}

// ── Year-to-date helpers (Repair 22) ────────────────────────────────────
export const yearBounds = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` })

export type CollectionEvent = FinanceEvent & {
  invoice_date?: string | null
  invoice_number?: string | null
}

/**
 * אחוז גבייה — by AMOUNT. Denominator: סכום חשבונית of invoiced events
 * (invoice_number set, not cancelled) with invoice_date in `year`; numerator:
 * the paid subset. Uninvoiced money is never in the denominator. pct is null
 * when the denominator is 0 (never NaN/Infinity).
 */
export function collectionRate(events: CollectionEvent[], year: number) {
  const { from, to } = yearBounds(year)
  let invoiced = 0
  let paid = 0
  for (const e of events) {
    if (e.status === 'cancelled' || !e.invoice_number || !e.invoice_date) continue
    const d = e.invoice_date.slice(0, 10)
    if (d < from || d > to) continue
    const a = eventInvoiceAgorot(e)
    invoiced += a
    if (e.status === 'paid') paid += a
  }
  return {
    invoiced: fromAgorot(invoiced),
    paid: fromAgorot(paid),
    pct: invoiced > 0 ? (paid / invoiced) * 100 : null,
  }
}

/** Contracted (deal-level) totals for deals whose dealDate falls in `year`. */
export function contractedInYear<T extends FinanceTransaction>(
  txs: T[],
  year: number,
  resolveName?: (t: T) => string | null | undefined,
) {
  const { from, to } = yearBounds(year)
  let invoice = 0, supplier = 0, income = 0, count = 0
  for (const t of txs) {
    const d = dealDate(t, resolveName?.(t))
    if (!d || d.slice(0, 10) < from || d.slice(0, 10) > to) continue
    count += 1
    invoice += txInvoiceAgorot(t)
    supplier += txSupplierAgorot(t)
    income += txIncomeAgorot(t)
  }
  return { count, invoice: fromAgorot(invoice), supplier: fromAgorot(supplier), income: fromAgorot(income) }
}

/**
 * Group received (paid) events by a key. `deals` = distinct transaction_id with
 * ≥1 paid event in the set. Sorted by income desc.
 */
export function groupPaidEvents<T extends FinanceEvent & { transaction_id?: string | null }>(
  paid: T[],
  keyOf: (e: T) => string,
  labelOf: (e: T) => string = keyOf,
) {
  const m = new Map<string, { key: string; label: string; invoice: number; income: number; txs: Set<string> }>()
  for (const e of paid) {
    const k = keyOf(e)
    let g = m.get(k)
    if (!g) { g = { key: k, label: labelOf(e), invoice: 0, income: 0, txs: new Set() }; m.set(k, g) }
    g.invoice += eventInvoiceAgorot(e)
    g.income += eventIncomeAgorot(e)
    if (e.transaction_id) g.txs.add(e.transaction_id)
  }
  return [...m.values()]
    .map((g) => ({ key: g.key, label: g.label, deals: g.txs.size, invoice: fromAgorot(g.invoice), income: fromAgorot(g.income) }))
    .sort((a, b) => b.income - a.income)
}

// ── Annual finance report helpers (Repair 23) ───────────────────────────
export type Metric = 'income' | 'invoice' | 'supplier'
export const metricAgorot = (e: FinanceEvent, m: Metric) =>
  m === 'income' ? eventIncomeAgorot(e) : m === 'invoice' ? eventInvoiceAgorot(e) : eventSupplierAgorot(e)

/** 'YYYY-MM-DD' → month 1..12 for a given year, or 0 when outside the year. */
const monthInYear = (iso: string | null | undefined, year: number): number => {
  if (!iso || Number(iso.slice(0, 4)) !== year) return 0
  return Number(iso.slice(5, 7))
}

/** Section A — paid events by payment_date month. `deals` = distinct transactions. */
export function paidByMonth<T extends FinanceEvent & { transaction_id?: string | null }>(events: T[], year: number) {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, invoice: 0, supplier: 0, income: 0, txs: new Set<string>(),
  }))
  const all = new Set<string>()
  for (const e of events) {
    if (e.status !== 'paid') continue
    const m = monthInYear(e.payment_date, year)
    if (!m) continue
    const r = rows[m - 1]
    r.invoice += eventInvoiceAgorot(e)
    r.supplier += eventSupplierAgorot(e)
    r.income += eventIncomeAgorot(e)
    if (e.transaction_id) { r.txs.add(e.transaction_id); all.add(e.transaction_id) }
  }
  const out = rows.map((r) => ({
    month: r.month, invoice: fromAgorot(r.invoice), supplier: fromAgorot(r.supplier),
    income: fromAgorot(r.income), deals: r.txs.size,
  }))
  const sum = (k: 'invoice' | 'supplier' | 'income') => fromAgorot(rows.reduce((s, r) => s + r[k], 0))
  return { rows: out, total: { invoice: sum('invoice'), supplier: sum('supplier'), income: sum('income'), deals: all.size } }
}

/** Section B — deals by dealDate month, valued at transaction level. */
export function contractedByMonth<T extends FinanceTransaction>(
  txs: T[], year: number, resolveName?: (t: T) => string | null | undefined,
) {
  const rows = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, deals: 0, invoice: 0, supplier: 0, income: 0 }))
  for (const t of txs) {
    const m = monthInYear(dealDate(t, resolveName?.(t)), year)
    if (!m) continue
    const r = rows[m - 1]
    r.deals += 1
    r.invoice += txInvoiceAgorot(t)
    r.supplier += txSupplierAgorot(t)
    r.income += txIncomeAgorot(t)
  }
  const out = rows.map((r) => ({
    month: r.month, deals: r.deals, invoice: fromAgorot(r.invoice),
    supplier: fromAgorot(r.supplier), income: fromAgorot(r.income),
  }))
  const sum = (k: 'invoice' | 'supplier' | 'income') => fromAgorot(rows.reduce((s, r) => s + r[k], 0))
  return {
    rows: out,
    total: { deals: rows.reduce((s, r) => s + r.deals, 0), invoice: sum('invoice'), supplier: sum('supplier'), income: sum('income') },
  }
}

/** Open גיוס placements (no close_date) opened in `year` — excluded from Section B. */
export function openGiyusInYear<T extends FinanceTransaction>(
  txs: T[], year: number, resolveName?: (t: T) => string | null | undefined,
) {
  let count = 0, invoice = 0
  for (const t of txs) {
    if (!isGiyus(t, resolveName?.(t)) || t.close_date) continue
    if (!monthInYear(t.entry_date, year)) continue
    count += 1
    invoice += txInvoiceAgorot(t)
  }
  return { count, invoice: fromAgorot(invoice) }
}

/** Section C — client × month matrix of paid events by payment_date. */
export function clientMonthMatrix<T extends FinanceEvent>(
  events: T[], year: number, metric: Metric,
  keyOf: (e: T) => string, labelOf: (e: T) => string = keyOf,
) {
  const m = new Map<string, { key: string; label: string; months: number[] }>()
  for (const e of events) {
    if (e.status !== 'paid') continue
    const mo = monthInYear(e.payment_date, year)
    if (!mo) continue
    const k = keyOf(e)
    let r = m.get(k)
    if (!r) { r = { key: k, label: labelOf(e), months: Array(12).fill(0) }; m.set(k, r) }
    r.months[mo - 1] += metricAgorot(e, metric)
  }
  const rows = [...m.values()].map((r) => ({ ...r, total: r.months.reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.total - a.total)
  const colTotals = Array.from({ length: 12 }, (_, i) => rows.reduce((s, r) => s + r.months[i], 0))
  const grand = colTotals.reduce((s, v) => s + v, 0)
  return {
    rows: rows.map((r) => ({
      key: r.key, label: r.label, months: r.months.map(fromAgorot), total: fromAgorot(r.total),
      pct: grand > 0 ? (r.total / grand) * 100 : 0,
    })),
    colTotals: colTotals.map(fromAgorot),
    grand: fromAgorot(grand),
  }
}

/** Years that have any paid event or any deal, plus the current year; descending. */
export function availableYears<T extends FinanceTransaction>(
  events: FinanceEvent[], txs: T[], currentYear: number, resolveName?: (t: T) => string | null | undefined,
): number[] {
  const ys = new Set<number>([currentYear])
  for (const e of events) if (e.status === 'paid' && e.payment_date) ys.add(Number(e.payment_date.slice(0, 4)))
  for (const t of txs) {
    const d = dealDate(t, resolveName?.(t))
    if (d) ys.add(Number(d.slice(0, 4)))
  }
  return [...ys].filter((y) => Number.isFinite(y) && y > 1990).sort((a, b) => b - a)
}

// ── Collections dashboard math (Repair 28) ──────────────────────────────
export type CollectionMonthEvent = CollectionEvent & { due_date?: string | null }

const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10)) -
    Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10))) / 86400000)

/** Last day of the month of a 'YYYY-MM-DD' string. */
const monthEnd = (iso: string) => {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7))
  return `${iso.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

/**
 * Collections for the month containing `today` ('YYYY-MM-DD', Asia/Jerusalem).
 * Definitions are the Repair 28 table in CLAUDE.md. Every amount is summed in
 * agorot; shekels appear only in the result. Identities hold by construction:
 *   C + R = T · R = R_late + R_upcoming · P = C + E + N
 * R_late is exactly isOverduePayment() (billed ∧ invoiced ∧ due_date < today).
 * Cancelled events are ignored.
 */
export function collectionMonth<T extends CollectionMonthEvent>(events: T[], today: string) {
  const mStart = `${today.slice(0, 7)}-01`
  const mEnd = monthEnd(today)
  const inMonth = (d: string | null | undefined) => !!d && d.slice(0, 10) >= mStart && d.slice(0, 10) <= mEnd
  let T = 0, C = 0, R = 0, Rlate = 0, Rupcoming = 0, E = 0, N = 0, P = 0, O = 0, Wamt = 0, Wcount = 0
  let noDue = 0, noDueCount = 0
  const late: (T & { daysLate: number })[] = []
  const bucketAg = [0, 0, 0, 0]

  for (const e of events) {
    if (e.status === 'cancelled') continue
    const a = eventInvoiceAgorot(e)
    const invoiced = !!e.invoice_number && !!e.invoice_date
    const due = e.due_date ? e.due_date.slice(0, 10) : null
    const paidInMonth = e.status === 'paid' && inMonth(e.payment_date)

    if (e.status === 'to_bill') { Wamt += a; Wcount += 1 }
    if (e.status === 'billed') {
      O += a
      if (!due) { noDue += a; noDueCount += 1 }
    }
    if (paidInMonth) P += a

    // T: invoiced, expected by month end, not settled before the month began.
    const inT = invoiced && !!due && due <= mEnd &&
      (e.status === 'billed' || paidInMonth)
    if (inT) {
      T += a
      if (paidInMonth) C += a
      else {
        R += a
        if (isLateByDue(e, due!, today)) {
          Rlate += a
          const daysLate = daysBetween(due!, today)
          late.push({ ...e, daysLate })
          bucketAg[daysLate <= 30 ? 0 : daysLate <= 60 ? 1 : daysLate <= 90 ? 2 : 3] += a
        } else Rupcoming += a
      }
    } else if (paidInMonth) {
      if (invoiced && due && due > mEnd) E += a
      else N += a
    }
  }
  late.sort((x, y) => y.daysLate - x.daysLate)
  return {
    mStart, mEnd,
    T: fromAgorot(T), C: fromAgorot(C), R: fromAgorot(R),
    R_late: fromAgorot(Rlate), R_upcoming: fromAgorot(Rupcoming),
    E: fromAgorot(E), N: fromAgorot(N), P: fromAgorot(P), O: fromAgorot(O),
    W_amount: fromAgorot(Wamt), W_count: Wcount,
    noDueAmount: fromAgorot(noDue), noDueCount,
    lateEvents: late,
    agingBuckets: bucketAg.map(fromAgorot) as [number, number, number, number],
  }
}

// In T the unpaid events are all `billed` and invoiced, so this is exactly
// isOverduePayment (imported lazily-free: same predicate, due_date < today).
function isLateByDue(e: CollectionMonthEvent, due: string, today: string) {
  return isOverduePayment({ status: (e.status ?? 'pending') as BillingEventStatus, invoice_date: e.invoice_date ?? null, due_date: due }, today)
}

/** Paid סכום חשבונית per Jerusalem month for the `n` months ending at `today`'s month (oldest first). */
export function paidLastMonths(events: FinanceEvent[], today: string, n = 6) {
  const y0 = Number(today.slice(0, 4)), m0 = Number(today.slice(5, 7))
  const out: { key: string; month: number; value: number }[] = []
  for (let i = n - 1; i >= 0; i--) {
    const idx = y0 * 12 + (m0 - 1) - i
    const y = Math.floor(idx / 12), m = (idx % 12) + 1
    out.push({ key: `${y}-${String(m).padStart(2, '0')}`, month: m, value: 0 })
  }
  const sums = new Map(out.map((o) => [o.key, 0]))
  for (const e of events) {
    if (e.status !== 'paid' || !e.payment_date) continue
    const k = e.payment_date.slice(0, 7)
    if (sums.has(k)) sums.set(k, sums.get(k)! + eventInvoiceAgorot(e))
  }
  return out.map((o) => ({ ...o, value: fromAgorot(sums.get(o.key)!) }))
}
