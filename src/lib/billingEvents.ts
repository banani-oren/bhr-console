import { supabase } from '@/lib/supabase'
import type { BillingEvent, PaymentSplit } from '@/lib/types'

export function parsePaymentTermDays(terms: string | null | undefined): number {
  if (!terms) return 30
  const m = /(\d+)/.exec(terms)
  if (m) return Number(m[1])
  if (terms.includes('שוטף')) return 0
  return 30
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function computeEventStatus(
  event: Pick<BillingEvent, 'status' | 'billing_date' | 'invoice_number'>,
  transactionApproved: boolean,
): BillingEvent['status'] {
  if (event.status === 'cancelled') return 'cancelled'
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
          periodStart, periodEnd, paymentTerms } = params
  const amount = Math.round(hoursTotal * hourlyRate * 100) / 100
  const termDays = parsePaymentTermDays(paymentTerms)
  const today = new Date().toISOString().slice(0, 10)
  const billingDate = addDays(today, termDays)

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
