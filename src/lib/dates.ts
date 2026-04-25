import { format, parseISO } from 'date-fns'
import { he } from 'date-fns/locale'

// Batch 5 Phase A: single formatter for every displayed date in the app.
// dd/mm/yy keeps tables compact; pair with `formatIso(input)` for an
// explicit tooltip that surfaces the four-digit year on hover so dates
// like 25/04/26 vs 25/04/1926 stay auditable.

export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return ''
  const d = typeof input === 'string' ? parseDateLike(input) : input
  if (!d || Number.isNaN(d.getTime())) return ''
  return format(d, 'dd/MM/yy', { locale: he })
}

export function formatIso(input: string | Date | null | undefined): string {
  if (!input) return ''
  const d = typeof input === 'string' ? parseDateLike(input) : input
  if (!d || Number.isNaN(d.getTime())) return ''
  return format(d, 'yyyy-MM-dd', { locale: he })
}

// Tooltip-friendly long form (`25 באפריל 2026`). Used in tooltips so
// hovering a short date shows the unambiguous Hebrew long-form date.
export function formatLong(input: string | Date | null | undefined): string {
  if (!input) return ''
  const d = typeof input === 'string' ? parseDateLike(input) : input
  if (!d || Number.isNaN(d.getTime())) return ''
  return format(d, 'd בMMMM yyyy', { locale: he })
}

function parseDateLike(s: string): Date | null {
  const trimmed = s.trim()
  if (!trimmed) return null
  // ISO yyyy-mm-dd or full timestamp.
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return parseISO(trimmed)
  // dd/mm/yyyy (in case raw CSV-style data leaks through).
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(trimmed)
  if (m) {
    const [, d, mo, y] = m
    const yr = y.length === 4 ? Number(y) : 2000 + Number(y)
    return new Date(yr, Number(mo) - 1, Number(d))
  }
  // Fallback to native Date.
  const d = new Date(trimmed)
  return Number.isNaN(d.getTime()) ? null : d
}
