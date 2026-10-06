import { formatDate, formatLong, formatIso } from '@/lib/dates'

// Batch 5 Phase A: render a date as `dd/mm/yy` with the full ISO date in a
// `title` tooltip. Pass null/undefined → renders `—`.
export function DateCell({
  value,
  empty = '—',
  className,
}: {
  value: string | Date | null | undefined
  empty?: string
  className?: string
}) {
  if (value == null || value === '') {
    return <span className={className}>{empty}</span>
  }
  const short = formatDate(value)
  if (!short) return <span className={className}>{empty}</span>
  const iso = formatIso(value)
  const long = formatLong(value)
  return (
    <span title={`${iso}${long ? ` · ${long}` : ''}`} dir="ltr" className={className}>
      {short}
    </span>
  )
}

/**
 * Repair 18 (2026-10-04): the one consistent treatment for a תאריך תשלום
 * צפוי that's NULL because a client's payment terms are missing/unparseable
 * — never a bare "—" (which means "not applicable") and never a guessed
 * date. `hasBasis` = whether a חשבון עסקה has actually been issued
 * (invoice_date is set) — Repair 19 (2026-10-06), Part B3.1: before that,
 * there is no expected payment date at all, which is the NORMAL
 * not-yet-invoiced state, not a terms problem, so it must render the plain
 * "—" via DateCell, not this amber message. Never pass `!!(invoice_date ??
 * billing_date)` here — billing_date is an internal planning field, not a
 * basis for a real expected-payment claim.
 */
export function DueDateCell({
  dueDate,
  isManual,
  hasBasis,
  className,
}: {
  dueDate: string | Date | null | undefined
  isManual: boolean
  hasBasis: boolean
  className?: string
}) {
  if ((dueDate == null || dueDate === '') && !isManual && hasBasis) {
    return (
      <span className={`text-amber-600 text-xs ${className ?? ''}`} title="יש להגדיר תנאי תשלום ללקוח">
        תנאי תשלום לא מוגדרים
      </span>
    )
  }
  return <DateCell value={dueDate} className={className} />
}
