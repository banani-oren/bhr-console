import { isOverduePayment } from '@/lib/billingEvents'
import type { BillingEvent } from '@/lib/types'

// Billing-status buckets (Repair 26, extracted Repair 29) — the ONE definition
// shared by Transactions (חיובים header popover) and BillingReports (סטטוס
// header popover), so the two pages can never drift. Same semantics as the
// collection model: an event matches a bucket by its stored status; באיחור =
// invoiced, due_date passed, unpaid (isOverduePayment, the dashboard's פיגור rule).

type BucketEvent = Pick<BillingEvent, 'status' | 'invoice_date' | 'due_date' | 'payment_date'>

export const BILL_BUCKETS: { key: string; label: string; match: (e: BucketEvent, today: string) => boolean }[] = [
  { key: 'not_billed', label: 'טרם חויב', match: (e) => e.status === 'pending' || e.status === 'to_bill' },
  { key: 'to_bill', label: 'לחיוב עכשיו', match: (e) => e.status === 'to_bill' },
  { key: 'awaiting', label: 'ממתין לתשלום', match: (e) => e.status === 'billed' },
  { key: 'overdue', label: 'באיחור', match: (e, today) => isOverduePayment(e, today) && !e.payment_date },
  { key: 'paid', label: 'שולם', match: (e) => e.status === 'paid' },
  { key: 'cancelled', label: 'מבוטל', match: (e) => e.status === 'cancelled' },
]
