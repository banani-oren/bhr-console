// Repair 32 — the ONE Israeli working-day calendar (TypeScript side).
// Matched pair with public.il_non_working_days / bhr_is_workday() / bhr_add_business_days() in
// 20261020_il_working_days.sql — the table is seeded from IL_NON_WORKING_DAYS below, and
// scripts/test-il-calendar.mjs fails if the two ever differ.
//
// Rules (D1): a workday is Sunday–Thursday that is not an official non-working day. Friday and
// Saturday are never workdays. Eve days (ערב חג) and Chol HaMoed ARE workdays.
// Dates are ISO "YYYY-MM-DD" strings; arithmetic is UTC-only so the browser timezone can't shift a day.
import { EREV_HOLIDAY_HOURS, STANDARD_WORKDAY_HOURS } from '@/lib/workHours'

/** Full official non-working days. 2026: timeanddate / officeholidays / Bank of Israel; 2027: rayclock.co.il/work-hours-2027.html */
export const IL_NON_WORKING_DAYS: Record<string, string> = {
  '2026-04-02': 'פסח — יום ראשון',
  '2026-04-08': 'שביעי של פסח',
  '2026-04-22': 'יום העצמאות',
  '2026-05-22': 'שבועות',
  '2026-09-12': 'ראש השנה — יום א׳',
  '2026-09-13': 'ראש השנה — יום ב׳',
  '2026-09-21': 'יום כיפור',
  '2026-09-26': 'סוכות — יום ראשון',
  '2026-10-03': 'שמיני עצרת ושמחת תורה',
  '2027-04-22': 'פסח — יום ראשון',
  '2027-04-28': 'שביעי של פסח',
  '2027-05-12': 'יום העצמאות',
  '2027-06-11': 'שבועות',
  '2027-10-02': 'ראש השנה — יום א׳',
  '2027-10-03': 'ראש השנה — יום ב׳',
  '2027-10-11': 'יום כיפור',
  '2027-10-16': 'סוכות — יום ראשון',
  '2027-10-23': 'שמיני עצרת ושמחת תורה',
}

const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`)
const toIso = (d: Date) => d.toISOString().slice(0, 10)
const shift = (iso: string, days: number) => {
  const d = toDate(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return toIso(d)
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(iso: string): number {
  return toDate(iso).getUTCDay()
}

export function isNonWorkingDay(iso: string): boolean {
  return iso.slice(0, 10) in IL_NON_WORKING_DAYS
}

/** Sunday–Thursday and not an official non-working day. */
export function isWorkday(iso: string): boolean {
  const dow = weekdayOf(iso)
  return dow <= 4 && !isNonWorkingDay(iso)
}

/** A workday immediately followed by an official non-working day (ערב חג). */
export function isErevHoliday(iso: string): boolean {
  return isWorkday(iso) && isNonWorkingDay(shift(iso, 1))
}

/** N workdays after `iso` (the start day itself is never counted). Same loop as bhr_add_business_days(). */
export function addBusinessDays(iso: string, n: number): string {
  let result = iso.slice(0, 10)
  let remaining = n
  while (remaining > 0) {
    result = shift(result, 1)
    if (isWorkday(result)) remaining -= 1
  }
  return result
}

/** Workdays from `fromIso` to `toIso`, both inclusive (empty when from > to). */
export function workdaysBetween(fromIso: string, toIso_: string): string[] {
  const out: string[] = []
  for (let d = fromIso.slice(0, 10); d <= toIso_.slice(0, 10); d = shift(d, 1)) if (isWorkday(d)) out.push(d)
  return out
}

/** Expected hours (D6) over the workdays between two dates, inclusive. */
export function expectedHours(fromIso: string, toIso_: string): number {
  const total = workdaysBetween(fromIso, toIso_).reduce(
    (s, d) => s + (isErevHoliday(d) ? EREV_HOLIDAY_HOURS : STANDARD_WORKDAY_HOURS),
    0,
  )
  return Math.round(total * 100) / 100
}

export { shift as addCalendarDays }

/** Workdays AFTER `todayIso` up to the last day of its month (today itself is not counted). */
export function workdaysLeftInMonth(todayIso: string): number {
  const [y, m] = todayIso.split('-').map(Number)
  const last = toIso(new Date(Date.UTC(y, m, 0)))
  return workdaysBetween(shift(todayIso.slice(0, 10), 1), last).length
}
