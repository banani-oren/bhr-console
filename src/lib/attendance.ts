import type { AttendanceLog } from '@/lib/types'

const IL_TZ = 'Asia/Jerusalem'

/** Today's date as YYYY-MM-DD in the Asia/Jerusalem timezone. */
export function todayIsrael(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Formats an ISO timestamp as HH:MM (24h) in Israel time. */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: IL_TZ,
  }).format(new Date(iso))
}

/** Formats a YYYY-MM-DD work_date as dd/MM/yyyy. */
export function formatWorkDate(workDate: string): string {
  const [y, m, d] = workDate.split('-')
  if (!y || !m || !d) return workDate
  return `${d}/${m}/${y}`
}

export type AttendanceStatus =
  | { kind: 'in'; since: string }
  | { kind: 'out'; since: string }
  | { kind: 'none' }

/** Determines the current status from today's entries (any order). */
export function computeStatus(entries: AttendanceLog[]): AttendanceStatus {
  if (entries.length === 0) return { kind: 'none' }
  const sorted = [...entries].sort((a, b) => a.logged_at.localeCompare(b.logged_at))
  const last = sorted[sorted.length - 1]
  return {
    kind: last.action === 'check_in' ? 'in' : 'out',
    since: formatTime(last.logged_at),
  }
}

/** The action a check button should perform given the current status. */
export function nextAction(status: AttendanceStatus): 'check_in' | 'check_out' {
  return status.kind === 'in' ? 'check_out' : 'check_in'
}

/**
 * Pair-matches a day's entries to total worked hours.
 * Sort ascending; push each check_in onto a stack, pop on each check_out and
 * add the elapsed time. A leftover check_in with no matching check_out leaves
 * the day "open".
 */
export function dayHours(entries: AttendanceLog[]): { hours: number; open: boolean } {
  const sorted = [...entries].sort((a, b) => a.logged_at.localeCompare(b.logged_at))
  const stack: string[] = []
  let totalMs = 0
  for (const e of sorted) {
    if (e.action === 'check_in') {
      stack.push(e.logged_at)
    } else if (e.action === 'check_out' && stack.length > 0) {
      const inT = stack.pop()!
      totalMs += new Date(e.logged_at).getTime() - new Date(inT).getTime()
    }
  }
  return { hours: totalMs / 3_600_000, open: stack.length > 0 }
}

/** "8.5" style — up to two decimals, trailing zeros trimmed. */
export function formatHours(h: number): string {
  return String(Math.round(h * 100) / 100)
}
