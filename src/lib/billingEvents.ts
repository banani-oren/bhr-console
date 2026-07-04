import { supabase } from '@/lib/supabase'
import type { BillingEvent, PaymentSplit } from '@/lib/types'

/**
 * Parses "שוטף+30", "שוטף +30", "שוטף+0", "30", etc. into just the number of days.
 * "שוטף" alone = 0 additional days.
 * Returns 30 as a safe default if nothing can be parsed.
 */
export function parsePaymentTermDays(terms: string | null | undefined): number {
  if (!terms) return 30
  const s = String(terms).replace(/\s+/g, '')
  if (/^\d+$/.test(s)) return Number(s)
  if (s === 'שוטף') return 0
  const m = s.match(/שוטף\+(\d+)/)
  if (m) return Number(m[1])
  return 30
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Calculates the expected חשבונית מס קבלה date using Israeli "שוטף+X" logic:
 * - Advance to the last day of the invoice month ("שוטף")
 * - Then add the specified number of additional days
 *
 * Example: invoice 11 May 2026, days=30 → end of May (31 May) + 30 days = 30 June 2026
 *
 * Calendar arithmetic is done in UTC to avoid local-vs-UTC drift when the input
 * "YYYY-MM-DD" is parsed as UTC midnight by the Date constructor.
 */
export function calculateTaxInvoiceDate(invoiceDate: string, paymentTermsDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(invoiceDate)
  if (!m) return invoiceDate
  const year = Number(m[1])
  const month = Number(m[2]) // 1-12
  // Last day of the invoice month, plus the additional days, all in UTC.
  const eom = new Date(Date.UTC(year, month, 0)) // month is 1-based here so day 0 of next month = last of this
  eom.setUTCDate(eom.getUTCDate() + paymentTermsDays)
  return eom.toISOString().slice(0, 10)
}

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

export type BillingEventDraft = Omit<BillingEvent, 'id' | 'created_at' | 'updated_at'>

export function generateServiceBillingEvents(params: {
  transactionId: string
  salary: number
  commissionPercent: number
  workStartDate: string
  paymentSplit: PaymentSplit[]
  advanceAmount: number
  supplierPercent: number
  candidateName: string
  serviceType: string
}): BillingEventDraft[] {
  const { transactionId, salary, commissionPercent, workStartDate,
          paymentSplit, advanceAmount, supplierPercent, candidateName, serviceType } = params

  const totalCommission = salary * (commissionPercent / 100)
  const split: PaymentSplit[] = paymentSplit.length > 0
    ? paymentSplit
    : [{ percent: 100, days: 0 }]

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
      billing_date: workStartDate,
      status: 'pending' as const,
      invoice_number: null,
      payment_date: null,
      receipt_number: null,
      advance_applied: advance,
      supplier_amount: advanceSupplierAmt,
    })
  }

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

export function generateTimePeriodBillingEvent(params: {
  transactionId: string
  hoursTotal: number
  hourlyRate: number
  clientName: string
  periodStart: string
  periodEnd: string
  paymentTerms: string | null
}): BillingEventDraft {
  const { transactionId, hoursTotal, hourlyRate, clientName,
          periodStart, periodEnd } = params
  void params.paymentTerms
  const amount = Math.round(hoursTotal * hourlyRate * 100) / 100
  // billing_date = the proforma issue date = today when billing is generated.
  // Tax-invoice date is calculated on-the-fly in the UI from billing_date + שוטף+X.
  const billingDate = new Date().toISOString().slice(0, 10)

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

export function resolveAdvanceAmount(
  advanceType: string | null | undefined,
  advanceAmount: number | null | undefined,
  salary: number,
  _commissionPct: number,
): number {
  if (!advanceType || !advanceAmount) return 0
  if (advanceType === 'fixed') return advanceAmount
  if (advanceType === 'percent') return salary * (advanceAmount / 100)
  return 0
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
