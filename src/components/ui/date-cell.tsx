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
 * Repair 18 (2026-10-04): the one consistent treatment for a תאריך פירעון
 * that's NULL because a client's payment terms are missing/unparseable —
 * never a bare "—" (which means "not applicable") and never a guessed date.
 * `hasBasis` = whether the row has a billing_date/invoice_date at all (so a
 * due_date could in principle exist) — a row with no basis at all still
 * renders the normal empty dash via DateCell.
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
