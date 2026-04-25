// Shared constants + helpers for the rebuilt /hours module.

export const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
] as const

const NOW = new Date()
export const CURRENT_MONTH = NOW.getMonth() + 1
export const CURRENT_YEAR = NOW.getFullYear()

export const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - 2 + i)

/** Return decimal hours from `HH:MM` strings, rounded to 2 decimals. */
export function computeHours(start: string, end: string): number {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 0
  const mins = eh * 60 + em - (sh * 60 + sm)
  if (mins <= 0) return 0
  return Math.round((mins / 60) * 100) / 100
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function monthLabel(month: number, year: number): string {
  return `${HEBREW_MONTHS[month - 1]} ${year}`
}
