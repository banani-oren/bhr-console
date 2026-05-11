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
 */
export function calculateTaxInvoiceDate(invoiceDate: string, paymentTermsDays: number): string {
  const d = new Date(invoiceDate)
  if (isNaN(d.getTime())) return invoiceDate
  const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  endOfMonth.setDate(endOfMonth.getDate() + paymentTermsDays)
  return endOfMonth.toISOString().slice(0, 10)
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

  return split.map((s, i) => {
    const gross = totalCommission * (s.percent / 100)
    const advance = i === 0 ? (advanceAmount ?? 0) : 0
    const supplierAmt = Math.round(gross * (supplierPercent / 100) * 100) / 100
    const amount = Math.round((gross - advance) * 100) / 100
    const billingDate = addDays(workStartDate, s.days)
    const description = [
      serviceType,
      candidateName,
      `${s.percent}%`,
      i === 0 && advance > 0 ? `(בניכוי מקדמה ₪${advance.toLocaleString('he-IL')})` : null,
    ].filter(Boolean).join(' · ')

    return {
      transaction_id: transactionId,
      event_index: i + 1,
      amount,
      description,
      billing_date: billingDate,
      status: 'pending' as const,
      invoice_number: null,
      payment_date: null,
      receipt_number: null,
      advance_applied: advance,
      supplier_amount: supplierAmt,
    }
  })
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
): Promise<void> {
  await supabase
    .from('billing_events')
    .delete()
    .eq('transaction_id', transactionId)
    .in('status', ['pending', 'to_bill'])

  if (events.length === 0) return

  const { error } = await supabase.from('billing_events').insert(events)
  if (error) throw error
}

export async function cancelFutureBillingEvents(
  transactionId: string,
  workEndDate: string,
): Promise<void> {
  const { error } = await supabase
    .from('billing_events')
    .update({ status: 'cancelled' })
    .eq('transaction_id', transactionId)
    .in('status', ['pending', 'to_bill'])
    .gt('billing_date', workEndDate)
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
