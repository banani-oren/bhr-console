// Hebrew labels + value formatting for the יומן שינויים (audit log) — Repair 24.
// Terminology follows Repair 21: net_invoice_amount → סכום חשבונית,
// supplier_percent → עמלת ספק %. Unknown keys fall back to the raw column name.

export const AUDIT_FIELD_LABELS: Record<string, string> = {
  // billing_events
  amount: 'סכום',
  supplier_amount: 'עמלת ספק',
  advance_applied: 'מקדמה שנוכתה',
  description: 'תיאור',
  status: 'סטטוס',
  event_index: 'מספר אירוע',
  billing_date: 'תאריך חיוב מתוכנן',
  invoice_number: 'מספר חשבון עסקה',
  invoice_date: 'תאריך הפקה',
  due_date: 'תאריך תשלום צפוי',
  due_date_is_manual: 'תאריך תשלום צפוי ידני',
  receipt_number: 'מספר חשבונית מס קבלה',
  payment_date: 'תאריך תשלום',
  transaction_id: 'עסקה',
  // transactions
  kind: 'סוג עסקה',
  client_id: 'לקוח (מזהה)',
  client_name: 'לקוח',
  service_type: 'סוג שירות',
  service_type_id: 'סוג שירות (מזהה)',
  service_lead: 'מוביל',
  position_name: 'משרה',
  candidate_name: 'מועמד',
  salary: 'שכר',
  commission_percent: '% עמלה',
  net_invoice_amount: 'סכום חשבונית',
  commission_amount: 'סכום עמלה',
  supplier_percent: 'עמלת ספק %',
  supplier_id: 'ספק',
  entry_date: 'תאריך פתיחה',
  close_date: 'תאריך סגירה',
  closing_month: 'חודש סגירה',
  closing_year: 'שנת סגירה',
  billing_month: 'חודש חיוב',
  billing_year: 'שנת חיוב',
  work_start_date: 'תחילת עבודה',
  work_end_date: 'סיום עבודה',
  warranty_end_date: 'סיום אחריות',
  period_start: 'תחילת תקופה',
  period_end: 'סוף תקופה',
  hours_total: 'סה"כ שעות',
  hourly_rate_used: 'תעריף שעה',
  needs_approval: 'דורש אישור',
  approved_at: 'אושר בתאריך',
  approved_by: 'אושר על ידי',
  created_by: 'נוצר על ידי',
  notes: 'הערות',
  custom_fields: 'שדות נוספים',
  // clients
  name: 'שם',
  contact_name: 'איש קשר',
  phone: 'טלפון',
  email: 'אימייל',
  tax_id: 'ח.פ / ע.מ',
  company_id: 'מזהה חברה',
  group_name: 'קבוצה',
  address: 'כתובת',
  agreement_type: 'סוג הסכם',
  salary_basis: 'בסיס שכר',
  warranty_days: 'תקופת אחריות (ימים)',
  payment_terms: 'תנאי תשלום',
  payment_split: 'פיצול תשלום',
  payment_split_json: 'פיצול תשלום',
  advance: 'מקדמה',
  advance_type: 'סוג מקדמה',
  advance_amount: 'סכום מקדמה',
  exclusivity: 'בלעדיות',
  hourly_rate: 'תעריף שעת עבודה',
  time_log_enabled: 'יומן שעות פעיל',
  agreement_file: 'קובץ הסכם',
  agreement_storage_path: 'נתיב קובץ הסכם',
  id: 'מזהה',
}

const MONEY_KEYS = new Set([
  'amount', 'supplier_amount', 'advance_applied', 'salary', 'net_invoice_amount',
  'commission_amount', 'hourly_rate', 'hourly_rate_used', 'advance_amount',
])
const PERCENT_KEYS = new Set(['commission_percent', 'supplier_percent'])
const BOOL_KEYS = new Set(['needs_approval', 'due_date_is_manual', 'time_log_enabled'])
const HIDDEN_DETAIL_KEYS = new Set(['id', 'transaction_id', 'client_id', 'service_type_id', 'supplier_id', 'created_by', 'approved_by'])

const ILS = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 })

export const fieldLabel = (key: string): string => {
  if (key.startsWith('custom_fields.')) return key.slice('custom_fields.'.length)
  return AUDIT_FIELD_LABELS[key] ?? key
}

const isDateKey = (key: string) => key.endsWith('_date') || key === 'approved_at'

/** 'YYYY-MM-DD…' → 'dd/MM/yyyy' by string slicing (no timezone drift). */
const fmtDate = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v
}

export function formatAuditValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (BOOL_KEYS.has(key) || typeof v === 'boolean') return v === true || v === 'true' ? 'כן' : 'לא'
  if (MONEY_KEYS.has(key) && Number.isFinite(Number(v))) return ILS.format(Number(v))
  if (PERCENT_KEYS.has(key) && Number.isFinite(Number(v))) return `${Number(v)}%`
  if (typeof v === 'string' && isDateKey(key)) return fmtDate(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export const ENTITY_LABEL: Record<string, string> = {
  transactions: 'עסקה',
  billing_events: 'אירוע חיוב',
  clients: 'לקוח',
}

/** Key fields of an insert/delete snapshot, for the collapsed "הצג פרטים" view. */
export function snapshotLines(snapshot: Record<string, unknown>): { label: string; value: string }[] {
  return Object.entries(snapshot)
    .filter(([k, v]) => !HIDDEN_DETAIL_KEYS.has(k) && v !== null && v !== '' && !(typeof v === 'object' && Object.keys(v as object).length === 0))
    .map(([k, v]) => ({ label: fieldLabel(k), value: formatAuditValue(k, v) }))
}

/** dd/MM/yyyy HH:mm in Asia/Jerusalem. */
export function formatAuditTimestamp(iso: string): string {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso))
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`
}

/** ISO instant of 00:00:00 (or 23:59:59.999 when endOfDay) of a 'YYYY-MM-DD' date in Asia/Jerusalem. */
export function jerusalemBoundary(dateStr: string, endOfDay: boolean): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const noonUtc = Date.UTC(y, m - 1, d, 12)
  const hourInJerusalem = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }).format(new Date(noonUtc)),
  )
  const offsetHours = hourInJerusalem - 12 // +2 or +3
  const localMs = Date.UTC(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
  return new Date(localMs - offsetHours * 3600_000).toISOString()
}
