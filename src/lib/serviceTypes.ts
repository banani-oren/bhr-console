import type { UserRole } from './types'

export type ServiceFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'month'
  | 'year'
  | 'select'
  | 'boolean'
  | 'employee'

export type ServiceFieldWidth = 'full' | 'half'

export type ServiceField = {
  key: string
  label: string
  type: ServiceFieldType
  required?: boolean
  options?: string[] | null
  default?: string | number | boolean | null
  width?: ServiceFieldWidth
  derived?: string | null
}

export type ServiceType = {
  id: string
  name: string
  display_order: number
  fields: ServiceField[]
  created_at?: string
  updated_at?: string
}

export const FIELD_TYPE_LABELS: Record<ServiceFieldType, string> = {
  text: 'טקסט',
  textarea: 'טקסט מרובה שורות',
  number: 'מספר',
  currency: 'סכום (₪)',
  percent: 'אחוז',
  date: 'תאריך',
  month: 'חודש',
  year: 'שנה',
  select: 'רשימה',
  boolean: 'כן/לא',
  employee: 'עובד/ת',
}

export const WIDTH_LABELS: Record<ServiceFieldWidth, string> = {
  half: 'חצי רוחב',
  full: 'רוחב מלא',
}

export const DEFAULT_FIELD_TYPE: ServiceFieldType = 'text'
export const DEFAULT_FIELD_WIDTH: ServiceFieldWidth = 'half'

export function slugifyKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9א-ת]+/gi, '_')
    .replace(/^_+|_+$/g, '')
}

export function emptyField(label = ''): ServiceField {
  return {
    key: label ? slugifyKey(label) : '',
    label,
    type: DEFAULT_FIELD_TYPE,
    required: false,
    width: DEFAULT_FIELD_WIDTH,
    options: null,
    default: null,
    derived: null,
  }
}

// Simple derived-field evaluator.
// Supports tokens: field refs (salary, commission_percent, client.hourly_rate,
// client.warranty_days, etc.), numeric literals, + - * /, parentheses, and
// date + integer addition (ISO date + days → ISO date).
export function evalDerived(
  expr: string,
  row: Record<string, unknown>,
  client?: Record<string, unknown> | null,
): string | number | null {
  if (!expr) return null
  try {
    // Resolve tokens to literals.
    const resolved = expr.replace(
      /([a-zA-Z_][a-zA-Z0-9_.]*)/g,
      (match: string): string => {
        if (['Math', 'Date'].includes(match)) return match
        const parts = match.split('.')
        let obj: Record<string, unknown> | undefined =
          parts[0] === 'client' ? (client ?? undefined) : row
        let cursor: unknown = obj
        for (let i = parts[0] === 'client' ? 1 : 0; i < parts.length; i++) {
          if (cursor == null || typeof cursor !== 'object') {
            cursor = null
            break
          }
          cursor = (cursor as Record<string, unknown>)[parts[i]]
        }
        if (cursor == null || cursor === '') return 'null'
        if (typeof cursor === 'number') return String(cursor)
        if (typeof cursor === 'string') {
          // Date string like 2026-04-22?
          if (/^\d{4}-\d{2}-\d{2}$/.test(cursor)) {
            return `DATE("${cursor}")`
          }
          const n = Number(cursor)
          if (Number.isFinite(n)) return String(n)
          return `"${cursor}"`
        }
        return 'null'
      },
    )

    // Replace DATE("...") + n with a marker the runtime can evaluate.
    const hasDate = /DATE\("/.test(resolved)
    if (hasDate) {
      const m = /DATE\("(\d{4}-\d{2}-\d{2})"\)\s*\+\s*([0-9]+)/.exec(resolved)
      if (m) {
        const d = new Date(m[1])
        d.setDate(d.getDate() + Number(m[2]))
        return d.toISOString().slice(0, 10)
      }
      return null
    }
    if (resolved.includes('null')) return null
    // Fallback to plain arithmetic.
    // eslint-disable-next-line no-new-func
    const val = Function(`"use strict"; return (${resolved});`)()
    if (typeof val === 'number' && Number.isFinite(val)) {
      return Math.round(val * 100) / 100
    }
    return null
  } catch {
    return null
  }
}

export const CAN_MANAGE_SERVICE_TYPES: UserRole[] = ['admin']
