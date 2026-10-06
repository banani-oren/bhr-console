import { supabase } from '@/lib/supabase'
import type { BillingEvent, PaymentSplit } from '@/lib/types'

/**
 * A payment-terms string resolves to exactly one of two date shapes, never
 * both (Repair 19, 2026-10-06):
 *
 *   'eom'      — last day of the reference date's month, + N calendar days
 *                (שוטף, שוטף+N, bare integer N) — unchanged since Repair 18.
 *   'business' — the reference date + N business days, Sunday-Thursday
 *                (מיידי = 5 business days — Oren, 2026-10-06: "לתשלום מיידי
 *                אומר שהתשלום יתקבל בתוך 5 ימי עסקים"). Israeli public
 *                holidays are NOT handled — a holiday inside the window
 *                still counts as a business day. Known, dated limitation;
 *                do not attempt a holiday calendar without a new decision.
 *
 * Matched pair with `bhr_payment_term_spec()` in
 * `20261006_business_days_and_event_index.sql` — change both together or
 * the client-side preview and the DB-persisted value will disagree.
 */
export type PaymentTermShape = 'eom' | 'business'
export type PaymentTermSpec = { shape: PaymentTermShape; days: number }

const BUSINESS_TERM_VARIANTS = new Set(['מיידי', 'מידי', 'לתשלוםמיידי', 'תשלוםמיידי'])

/**
 * Parses a client's payment_terms string into a shape + day count. Returns
 * `null` when the terms are NOT usable — missing, empty/whitespace, or a
 * non-empty string this parser doesn't recognise. Repair 18 (2026-10-04):
 * this used to default to 30, which made "no terms configured", "terms I
 * couldn't read" (an RLS leak — see bhr_billing_event_payment_terms), and "a
 * terms string I can't parse" all produce an identical, confident-looking
 * invented date nobody decided on. **Never reintroduce `?? 30` / `|| 30` on
 * this function's result** — a missing due_date is a real signal the UI
 * must show, not paper over.
 */
export function parsePaymentTermSpec(terms: string | null | undefined): PaymentTermSpec | null {
  if (!terms || !String(terms).trim()) return null
  const s = String(terms).replace(/\s+/g, '')
  if (BUSINESS_TERM_VARIANTS.has(s)) return { shape: 'business', days: 5 }
  if (s === 'שוטף') return { shape: 'eom', days: 0 }
  let m = s.match(/^שוטף\+?(\d+)(?:יום)?$/)
  if (m) return { shape: 'eom', days: Number(m[1]) }
  m = s.match(/^(\d+)(?:יום)?$/)
  if (m) return { shape: 'eom', days: Number(m[1]) }
  return null
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * N business days (Sunday-Thursday) after an ISO "YYYY-MM-DD" date, computed
 * in UTC to avoid local-vs-UTC drift. Matched pair with the SQL
 * `bhr_add_business_days()` — same Sun-Thu week, same "holidays not
 * handled" limitation.
 */
export function addBusinessDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  let remaining = days
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const dow = d.getUTCDay() // 0=Sunday .. 6=Saturday
    if (dow !== 5 && dow !== 6) remaining -= 1
  }
  return d.toISOString().slice(0, 10)
}

/**
 * Last calendar day of the month of an ISO "YYYY-MM-DD" date, computed in UTC
 * (same approach as calculateTaxInvoiceDate) to avoid local-vs-UTC drift.
 */
export function endOfMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const year = Number(m[1])
  const month = Number(m[2]) // 1-12
  const eom = new Date(Date.UTC(year, month, 0)) // day 0 of next month = last of this
  return eom.toISOString().slice(0, 10)
}

/**
 * Calculates the expected payment date (תאריך תשלום צפוי) from the real
 * invoice date (תאריך הפקה) and the client's parsed payment-term spec:
 * - 'eom'      — advance to the last day of the invoice month, then add N days
 * - 'business' — add N business days (Sunday-Thursday) directly
 *
 * Example ('eom'): invoice 11 May 2026, days=30 → end of May (31 May) + 30 = 30 June 2026
 * Example ('business'): invoice Wed 7 Oct 2026, days=5 → 14 Oct 2026 (Oren's worked example, 2026-10-06)
 *
 * Calendar arithmetic is done in UTC to avoid local-vs-UTC drift when the input
 * "YYYY-MM-DD" is parsed as UTC midnight by the Date constructor.
 *
 * The Postgres function `bhr_calc_due_date` (migration 20260913_due_date.sql;
 * two-shape since `20261006_business_days_and_event_index.sql` — Repair 19)
 * is the authoritative, DB-persisted implementation of this same formula.
 * This client-side copy is only a live preview shown in TransactionDialog
 * before a row is saved.
 *
 * **Part B3.1 (Repair 19, 2026-10-06): `invoiceDate` must be the real
 * invoice_date ONLY — never `invoice_date ?? billing_date`.** Before a
 * חשבון עסקה is issued there is no expected payment date, full stop; callers
 * must not call this function at all when `invoice_date` is null (see
 * TransactionDialog's `hasInvoice` gate).
 *
 * Returns `null` when `spec` is `null` (Repair 18) — no usable terms means
 * no תאריך תשלום צפוי, not a guessed one.
 */
export function calculateTaxInvoiceDate(invoiceDate: string, spec: PaymentTermSpec | null): string | null {
  if (spec == null) return null
  if (spec.shape === 'business') return addBusinessDays(invoiceDate, spec.days)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(invoiceDate)
  if (!m) return invoiceDate
  const year = Number(m[1])
  const month = Number(m[2]) // 1-12
  // Last day of the invoice month, plus the additional days, all in UTC.
  const eom = new Date(Date.UTC(year, month, 0)) // month is 1-based here so day 0 of next month = last of this
  eom.setUTCDate(eom.getUTCDate() + spec.days)
  return eom.toISOString().slice(0, 10)
}

/**
 * The ONLY place billing_events.status is computed — Repair 17 (2026-10-03).
 * Every save path (TransactionDialog's BillingEventRow, BillingReports'
 * BillingEventDashRow) must route status changes through this function (via
 * buildBillingEventPatch below), never set `status` by hand inline — that
 * drift is exactly what let the two screens' status logic disagree before.
 *
 *   cancelled  — set manually; nothing here overrides it (מבוטל)
 *   paid       — receipt_number present (שולם)
 *   billed     — invoice_number present, no receipt (ממתין לתשלום)
 *   to_bill    — no invoice, transaction approved, billing_date <= today (טרם חויב — לחיוב עכשיו)
 *   pending    — no invoice, and (not approved OR billing_date > today) (טרם חויב)
 */
export function computeEventStatus(
  event: Pick<BillingEvent, 'status' | 'billing_date' | 'invoice_number' | 'receipt_number'>,
  transactionApproved: boolean,
): BillingEvent['status'] {
  if (event.status === 'cancelled') return 'cancelled'
  // receipt_number = חשבונית מס קבלה number → payment confirmed
  if (event.receipt_number) return 'paid'
  // invoice_number = חשבון עסקה number → proforma sent
  if (event.status === 'billed' || event.invoice_number) return 'billed'
  if (!transactionApproved) return 'pending'
  const today = new Date().toISOString().slice(0, 10)
  if (event.billing_date && event.billing_date <= today) return 'to_bill'
  return 'pending'
}

/** The four stored statuses collapse into these UI buckets for filters/reports. */
export type CollectionBucket = 'not_billed' | 'awaiting_payment' | 'paid' | 'cancelled'

export function collectionBucket(status: BillingEvent['status']): CollectionBucket {
  switch (status) {
    case 'cancelled': return 'cancelled'
    case 'paid': return 'paid'
    case 'billed': return 'awaiting_payment'
    case 'pending':
    case 'to_bill':
    default:
      return 'not_billed'
  }
}

/**
 * The client is late paying an issued invoice — תאריך תשלום צפוי renders red.
 * Part B3.2 (Repair 19, 2026-10-06): פיגור requires a חשבון עסקה to have
 * actually been issued (invoice_date present) — explicit, not just inferred
 * from status, so this stays correct even in the (currently nonexistent)
 * edge case of a 'billed' row whose invoice_date was cleared independently
 * of its invoice_number.
 */
export function isOverduePayment(
  e: Pick<BillingEvent, 'status' | 'invoice_date' | 'due_date'>,
  today: string,
): boolean {
  return e.status === 'billed' && !!e.invoice_date && !!e.due_date && e.due_date < today
}

/**
 * We are late issuing the invoice — תאריך חיוב מתוכנן renders red. Evaluated
 * and kept as-is in Repair 19 (Part B3.2): billing_date remains a real
 * internal scheduling anchor (it still drives the pending→to_bill
 * transition), so "we're late issuing per the system's own plan" is still a
 * meaningful, correctly-driven signal — nothing to remove or fix here.
 */
export function isDueToInvoice(
  e: Pick<BillingEvent, 'status' | 'billing_date'>,
  today: string,
): boolean {
  void today // status already encodes "billing_date <= today" — kept for signature symmetry with isOverduePayment
  return e.status === 'to_bill'
}

export type EditableBillingField =
  | 'invoice_number' | 'invoice_date'
  | 'receipt_number' | 'payment_date'
  | 'amount' | 'billing_date' | 'due_date' | 'due_date_is_manual'

/**
 * Builds the full patch for a single-field edit on an existing billing_event
 * row: applies the §3.3 document-pairing rules (a document's number and date
 * are set and cleared together) and then recomputes `status` via
 * computeEventStatus — the only two places the UI is allowed to touch either.
 * Shared by TransactionDialog's BillingEventRow and BillingReports'
 * BillingEventDashRow so their status/pairing logic can never diverge again.
 */
export function buildBillingEventPatch(
  event: Pick<BillingEvent, 'status' | 'billing_date' | 'invoice_number' | 'invoice_date' | 'receipt_number' | 'payment_date'>,
  field: EditableBillingField,
  value: string | number | boolean,
  transactionApproved: boolean,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { [field]: value === '' ? null : value }

  if (field === 'invoice_number') {
    if (value && !event.invoice_date) patch.invoice_date = new Date().toISOString().slice(0, 10)
    else if (!value) patch.invoice_date = null
  }
  if (field === 'receipt_number') {
    if (value && !event.payment_date) patch.payment_date = new Date().toISOString().slice(0, 10)
    else if (!value) patch.payment_date = null
  }

  // computeEventStatus's `event.status === 'billed'` branch is a deliberate
  // one-way lock for its OTHER caller (regeneration, which must never
  // downgrade an already-billed/paid row it doesn't have fresh data for) —
  // but that same stickiness would silently block demotion here: clearing
  // invoice_number on a billed row would compute 'billed' forever, since the
  // OLD status rides along in nextEvent. Reset to a neutral baseline (never
  // 'billed'/'paid' themselves, since those are only ever reached via a
  // present invoice/receipt number below) so status is derived fresh from
  // the patched fields — except 'cancelled', which must stay sticky exactly
  // as computeEventStatus's own first check intends.
  const neutralStatus = event.status === 'cancelled' ? 'cancelled' : 'pending'
  const nextEvent = { ...event, ...patch, status: neutralStatus } as Pick<BillingEvent, 'status' | 'billing_date' | 'invoice_number' | 'receipt_number'>
  patch.status = computeEventStatus(nextEvent, transactionApproved)
  return patch
}

// due_date / due_date_is_manual are intentionally omitted: they are computed
// and persisted by the DB trigger `trg_billing_events_due_date` on insert,
// never set by draft-generation code. invoice_date is omitted for the same
// reason as it: a document date entered by hand, never by a generator.
export type BillingEventDraft = Omit<BillingEvent, 'id' | 'created_at' | 'updated_at' | 'due_date' | 'due_date_is_manual' | 'invoice_date'>

export function generateServiceBillingEvents(params: {
  transactionId: string
  salary: number
  commissionPercent: number
  workStartDate: string | null
  paymentSplit: PaymentSplit[]
  advanceAmount: number
  supplierPercent: number
  candidateName: string
  serviceType: string
  advanceBillingDate?: string | null
}): BillingEventDraft[] {
  const { transactionId, salary, commissionPercent, workStartDate,
          paymentSplit, advanceAmount, supplierPercent, candidateName, serviceType,
          advanceBillingDate } = params

  const totalCommission = salary * (commissionPercent / 100)

  const events: BillingEventDraft[] = []
  const advance = Math.round((advanceAmount ?? 0) * 100) / 100
  const hasAdvance = advance > 0
  let eventIndex = 1

  if (hasAdvance) {
    const advanceSupplierAmt = Math.round(advance * (supplierPercent / 100) * 100) / 100
    events.push({
      transaction_id: transactionId,
      event_index: eventIndex++,
      amount: advance,
      description: [serviceType, candidateName, 'מקדמה'].filter(Boolean).join(' · '),
      billing_date: advanceBillingDate ?? workStartDate,
      status: 'pending' as const,
      invoice_number: null,
      payment_date: null,
      receipt_number: null,
      advance_applied: advance,
      supplier_amount: advanceSupplierAmt,
    })
  }

  // Advance-only mode: no work-start date yet, so split events (whose dates
  // are derived from it) can't be computed. The advance is emitted alone —
  // see Batch 8 Phase 3.
  if (!workStartDate) {
    return events
  }

  const split: PaymentSplit[] = paymentSplit.length > 0
    ? paymentSplit
    : [{ percent: 100, days: 0 }]

  // Remaining commission after the advance is split across the client's payment
  // terms exactly as before the advance existed — payment_split_json percentages
  // always apply to what's left to collect, not the original gross total.
  const remaining = hasAdvance ? Math.max(totalCommission - advance, 0) : totalCommission

  for (const s of split) {
    const gross = remaining * (s.percent / 100)
    const supplierAmt = Math.round(gross * (supplierPercent / 100) * 100) / 100
    const amount = Math.round(gross * 100) / 100
    const billingDate = addDays(workStartDate, s.days)
    const description = [serviceType, candidateName, `${s.percent}%`].filter(Boolean).join(' · ')

    events.push({
      transaction_id: transactionId,
      event_index: eventIndex++,
      amount,
      description,
      billing_date: billingDate,
      status: 'pending' as const,
      invoice_number: null,
      payment_date: null,
      receipt_number: null,
      advance_applied: 0,
      supplier_amount: supplierAmt,
    })
  }

  return events
}

/**
 * הדרכה (training) transactions bill as a single event for the whole
 * engagement. The amount is the figure the dialog already computes and
 * displays live (מחיר הדרכה × number of execution dates + travel), which is
 * mirrored onto net_invoice_amount on save.
 *
 * billing_date = the LAST execution date — a training is invoiced once it has
 * been delivered, not when it was booked. With no execution dates recorded
 * yet, fall back to the transaction's entry_date (תאריך פתיחה) so the event
 * still exists and can be corrected by hand.
 */
export function generateHadrachaBillingEvent(params: {
  transactionId: string
  amount: number
  executionDates: string[]     // ISO yyyy-mm-dd, unsorted is fine
  entryDate: string
  trainingName: string
  serviceType: string
  supplierPercent: number
}): BillingEventDraft | null {
  const { transactionId, amount, executionDates, entryDate, trainingName, serviceType, supplierPercent } = params

  const roundedAmount = Math.round(amount * 100) / 100
  if (roundedAmount <= 0) return null

  const validDates = executionDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  const billingDate = validDates.sort().at(-1) ?? entryDate
  const supplierAmt = Math.round(roundedAmount * (supplierPercent / 100) * 100) / 100

  return {
    transaction_id: transactionId,
    event_index: 1,
    amount: roundedAmount,
    description: [serviceType, trainingName].filter(Boolean).join(' · '),
    billing_date: billingDate,
    status: 'pending' as const,
    invoice_number: null,
    payment_date: null,
    receipt_number: null,
    advance_applied: 0,
    supplier_amount: supplierAmt,
  }
}

/**
 * Hours (time_period) transactions bill as a single event per report.
 *
 * billing_date = the LAST DAY OF THE MONTH the report covers (Oren,
 * 2026-10-03): advance to the end of periodEnd's month (falling back to
 * periodStart, then today, if periodEnd is missing). Payment terms are
 * applied ONLY by the due_date trigger on top of this — never baked in here,
 * or the client's שוטף+X gets double-counted (the bug this replaces).
 */
export function generateTimePeriodBillingEvent(params: {
  transactionId: string
  hoursTotal: number
  hourlyRate: number
  clientName: string
  periodStart: string
  periodEnd: string
}): BillingEventDraft {
  const { transactionId, hoursTotal, hourlyRate, clientName,
          periodStart, periodEnd } = params
  const amount = Math.round(hoursTotal * hourlyRate * 100) / 100
  const billingDate = endOfMonth(periodEnd || periodStart || new Date().toISOString().slice(0, 10))

  return {
    transaction_id: transactionId,
    event_index: 1,
    amount,
    description: `שעות עבודה · ${clientName} · ${periodStart} – ${periodEnd}`,
    billing_date: billingDate,
    status: 'pending' as const,
    invoice_number: null,
    payment_date: null,
    receipt_number: null,
    advance_applied: 0,
    supplier_amount: 0,
  }
}

export async function upsertBillingEvents(
  transactionId: string,
  events: BillingEventDraft[],
  signal: AbortSignal = new AbortController().signal,
): Promise<void> {
  // Delete only events that haven't progressed — billed/paid/cancelled stay untouched.
  await supabase
    .from('billing_events')
    .delete()
    .eq('transaction_id', transactionId)
    .in('status', ['pending', 'to_bill'])
    .abortSignal(signal)

  if (events.length === 0) return

  // After the delete, some event_index values may still exist (billed/paid/cancelled).
  // Inserting a duplicate index causes a phantom row — skip those indices.
  const { data: surviving } = await supabase
    .from('billing_events')
    .select('event_index')
    .eq('transaction_id', transactionId)
    .abortSignal(signal)

  const occupiedIndices = new Set((surviving ?? []).map((r: { event_index: number }) => r.event_index))
  const toInsert = events.filter((e) => !occupiedIndices.has(e.event_index))

  if (toInsert.length === 0) return

  const { error } = await supabase.from('billing_events').insert(toInsert).abortSignal(signal)
  if (error) throw error
}

export async function cancelFutureBillingEvents(
  transactionId: string,
  workEndDate: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<void> {
  const { error } = await supabase
    .from('billing_events')
    .update({ status: 'cancelled' })
    .eq('transaction_id', transactionId)
    .in('status', ['pending', 'to_bill'])
    .gt('billing_date', workEndDate)
    .abortSignal(signal)
  if (error) throw error
}

/**
 * The advance (מקדמה) is a PART OF THE COMMISSION, never an extra charge.
 *
 *  - 'fixed'   → a flat ₪ amount, capped at the total commission
 *  - 'percent' → that percentage OF THE COMMISSION
 *                (commission itself is salary × commissionPct / 100)
 *
 * Confirmed with Oren 2026-08-22: עמלה 75%, מקדמה 30%, שכר ₪10,000
 * → commission ₪7,500 → advance ₪2,250, remaining ₪5,250.
 * Previously this computed `salary × pct/100` (a % of GROSS SALARY), which
 * coincides with the correct value only when commission_percent === 100.
 */
export function resolveAdvanceAmount(
  advanceType: string | null | undefined,
  advanceAmount: number | null | undefined,
  salary: number,
  commissionPct: number,
): number {
  if (!advanceType || !advanceAmount) return 0
  const totalCommission = Math.round(salary * (commissionPct / 100) * 100) / 100
  if (totalCommission <= 0) return 0
  const raw =
    advanceType === 'fixed'
      ? advanceAmount
      : advanceType === 'percent'
      ? totalCommission * (advanceAmount / 100)
      : 0
  // The advance can never exceed the whole fee.
  return Math.round(Math.min(raw, totalCommission) * 100) / 100
}

/**
 * Recomputes billing events for a גיוס transaction after final_salary changes,
 * when some events may already be billed/paid (and therefore locked/untouchable).
 *
 * The advance always stays derived from expected salary (locked once generated —
 * never recalculated here). Split events are regenerated from final salary using
 * generateServiceBillingEvents as the reference shape (same event_index/dates/
 * descriptions a fresh generation would produce), but any event_index that's
 * already billed/paid is left out of the result entirely (untouched in the DB).
 * The LAST still-open event absorbs whatever delta remains so that
 * locked-events-total + regenerated-events-total == the new total commission.
 */
export function reconcileFinalSalaryBillingEvents(params: {
  transactionId: string
  existingEvents: BillingEvent[]
  finalSalary: number
  commissionPercent: number
  workStartDate: string
  paymentSplit: PaymentSplit[]
  advanceAmount: number
  supplierPercent: number
  candidateName: string
  serviceType: string
}): { toUpsert: BillingEventDraft[]; warning: string | null } {
  const {
    transactionId, existingEvents, finalSalary, commissionPercent,
    workStartDate, paymentSplit, advanceAmount, supplierPercent,
    candidateName, serviceType,
  } = params

  const locked = existingEvents.filter((e) => e.status === 'billed' || e.status === 'paid')
  const lockedIndices = new Set(locked.map((e) => e.event_index))
  const lockedSum = locked.reduce((sum, e) => sum + e.amount, 0)

  const newTotalCommission = finalSalary * (commissionPercent / 100)

  // Always pass the real advanceAmount here (even if the advance event itself is
  // already locked) so the resulting event_index layout (1=advance, 2+=splits)
  // matches the transaction's actual shape — the lockedIndices filter below is
  // what excludes the advance from toRegen when it's already billed/paid, not a
  // change to advanceAmount. Passing 0 here would shift every split event's
  // index down by one and misalign it against the real DB rows.
  const fresh = generateServiceBillingEvents({
    transactionId,
    salary: finalSalary,
    commissionPercent,
    workStartDate,
    paymentSplit,
    advanceAmount,
    supplierPercent,
    candidateName,
    serviceType,
  })
  const toRegen = fresh.filter((e) => !lockedIndices.has(e.event_index))

  let warning: string | null = null
  if (toRegen.length > 0) {
    const lastIdx = toRegen.length - 1
    const sumOfOthers = toRegen.slice(0, lastIdx).reduce((sum, e) => sum + e.amount, 0)
    const reconciled = Math.round((newTotalCommission - lockedSum - sumOfOthers) * 100) / 100
    if (reconciled < 0) {
      warning = 'שכר סופי גורם לסכום שלילי באירוע החיוב האחרון — יש לבדוק ידנית.'
    }
    toRegen[lastIdx] = { ...toRegen[lastIdx], amount: reconciled }
  } else if (Math.round((newTotalCommission - lockedSum) * 100) / 100 !== 0) {
    // Every event is already billed/paid — there's no open slot left to absorb
    // the delta between the old and new total commission. Nothing to upsert;
    // just tell the admin so they know to reconcile manually if needed.
    warning = 'כל אירועי החיוב כבר חויבו/שולמו — לא ניתן לעדכן אוטומטית את ההפרש משכר סופי. יש לבדוק ידנית.'
  }

  return { toUpsert: toRegen, warning }
}
