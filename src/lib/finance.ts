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
