// Repair 32 — one month of a recruiter's attendance, day by day. Used by BOTH the dashboard cards
// (שעות החודש / ימי נוכחות חסרים) and the /attendance month table, so the card count and the
// page list can never disagree. Working-day rules: src/lib/ilCalendar.ts (D1); hours: workHours.ts (D6).
import type { AttendanceLog } from '@/lib/types'
import { dayPairs, type AttendancePair } from '@/lib/attendance'
import { IL_NON_WORKING_DAYS, addCalendarDays, isErevHoliday, isNonWorkingDay, isWorkday, weekdayOf } from '@/lib/ilCalendar'
import { EREV_HOLIDAY_HOURS, STANDARD_WORKDAY_HOURS } from '@/lib/workHours'

export type DayStatus =
  | 'present' // a complete in→out pair exists
  | 'missing' // workday before today with no complete pair
  | 'holiday' // official non-working day
  | 'erev' // erev-holiday workday with nothing reported yet (7 h expected)
  | 'future' // later than today (or today with nothing yet): nothing to report
  | 'weekend' // Friday/Saturday without a report

export type MonthDay = {
  date: string // YYYY-MM-DD
  isToday: boolean
  weekday: number // 0 = Sunday … 6 = Saturday
  status: DayStatus
  erev: boolean
  holidayName: string | null
  pairs: AttendancePair[]
  hours: number // closed pairs only
  hasOpenPair: boolean
  /** a workday that still needs a report (status 'missing') */
  missing: boolean
  expectedHours: number // 0 on non-workdays
}

export const monthBounds = (monthKey: string) => {
  const [y, m] = monthKey.split('-').map(Number)
  const first = `${monthKey}-01`
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { first, last }
}

export function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/**
 * Every calendar day of `monthKey` with its status. `today` is Asia/Jerusalem "today". A workday is
 * 'missing' only BEFORE today (today is still being reported); a day with only an open check-in counts
 * as missing (no complete pair).
 */
export function buildMonthDays(
  monthKey: string,
  entries: AttendanceLog[],
  today: string,
): MonthDay[] {
  const { first, last } = monthBounds(monthKey)
  const byDate = new Map<string, AttendanceLog[]>()
  for (const e of entries) {
    const arr = byDate.get(e.work_date)
    if (arr) arr.push(e)
    else byDate.set(e.work_date, [e])
  }
  const days: MonthDay[] = []
  for (let d = first; d <= last; d = addCalendarDays(d, 1)) {
    const pairs = dayPairs(byDate.get(d) ?? [])
    const closed = pairs.filter((p) => !p.open)
    const hours = closed.reduce((s, p) => s + p.hours, 0)
    const workday = isWorkday(d)
    const erev = isErevHoliday(d)
    let status: DayStatus
    if (closed.length > 0) status = 'present'
    else if (isNonWorkingDay(d)) status = 'holiday'
    else if (!workday) status = 'weekend'
    else if (d < today) status = 'missing'
    else status = erev ? 'erev' : 'future'
    days.push({
      date: d,
      isToday: d === today,
      weekday: weekdayOf(d),
      status,
      erev,
      holidayName: IL_NON_WORKING_DAYS[d] ?? null,
      pairs,
      hours,
      hasOpenPair: pairs.some((p) => p.open),
      missing: status === 'missing',
      expectedHours: workday ? (erev ? EREV_HOLIDAY_HOURS : STANDARD_WORKDAY_HOURS) : 0,
    })
  }
  return days
}

export function monthTotals(days: MonthDay[]) {
  return {
    hours: days.reduce((s, d) => s + d.hours, 0),
    reportedDays: days.filter((d) => d.status === 'present').length,
    missingDays: days.filter((d) => d.missing).length,
  }
}
