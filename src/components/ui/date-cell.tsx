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
