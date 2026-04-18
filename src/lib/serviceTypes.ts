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
  }
}

export const CAN_MANAGE_SERVICE_TYPES: UserRole[] = ['admin']
