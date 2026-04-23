#!/usr/bin/env node
// One-time CSV import — 2026-04-23.
// Usage:
//   node scripts/import-2026-04-23.mjs preview   # Phase 1 + 2
//   node scripts/import-2026-04-23.mjs import    # Phase 3
//
// Env: SUPABASE_URL / VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY loaded
// from .env.local by the caller (Bash: `set -a; source .env.local; set +a`).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CSV_PATH = resolve(ROOT, 'test-fixtures/import-2026-04-23.csv')
const CLIENTS_PATH = resolve(ROOT, '_clients.json')
const IMPORT_TAG_PREFIX = 'IMPORT-2026-04-23-row-'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const SERVICE_TYPE_IDS = {
  'השמה': 'db431eae-6f7d-47dd-bcc1-1866454274aa',
  'הדרכה': 'b4ad96cf-6e08-4681-9319-fd1558fc56b2',
}
const OREN_PROFILE_ID = '03b73b4f-8f09-4bf1-9c22-f49b2b05f363'

// Confirmed CSV → target client name mappings (IMPORT_MATCH_REPORT.md).
const CONFIRMED_TARGETS = new Map([
  ['קסטרו אבטחת תנועה, תחזוקה ושירותים בע"מ', 'קסטרו אבטחת תנועה, תחזוקה ושירותים בע"מ'],
  ['קסטרו מרץ', 'קסטרו אבטחת תנועה, תחזוקה ושירותים בע"מ'],
  ['קרייזיליין', 'קרייזי ליין בע"מ'],
  // IMPORT_MATCH_REPORT.md noted the target as "גרואו פיימנטס בע\"מ -
  // GROW PAYMENTS LTD" but the live clients row is "גרואו פיימנטס בע\"מ"
  // (Oren renamed it). Fall through to a prefix lookup so we match the
  // actual row regardless of suffix.
  ['GROW', null],
  ['עיריית תל אביב', 'עיריית תל אביב-יפו'],
  ['אגד', 'אגד חברה לתחבורה בע"מ'],
  ['מאסטרפוד', 'מאסטר פוד'],
  ['טיקוצקי', 'דורון טיקוצקי עורכי דין'],
  ['קבוצת אלדר', 'קבוצת אלדר (ר.ה.ד) בע"מ'],
  ['נובה', 'עמותת שבט הנובה'],
  ['אלדר שיווק', 'אלדר שיווק פרוייקטים (2000) בע"מ'],
])
// Runtime prefix lookups (added by Oren at import-time).
const PREFIX_LOOKUPS = [
  { csv: 'אלדר מגורים', prefix: 'אלדר מגורים' },
  { csv: 'שיבומי אסטרטגיה בע"מ', prefix: 'שיבומי' },
  { csv: 'שיבומי מרץ', prefix: 'שיבומי' },
  { csv: 'GROW', prefix: 'גרואו' },
]

// ---------------------------------------------------------------------------
// CSV parser — handles quoted cells with embedded newlines and "" escapes.
// ---------------------------------------------------------------------------
function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else { field += ch }
    } else {
      if (ch === '"') { inQuotes = true }
      else if (ch === ',') { row.push(field); field = '' }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else if (ch === '\r') { /* skip */ }
      else { field += ch }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

function stripCurrency(s) {
  if (s == null) return null
  const cleaned = String(s).replace(/[^\d.-]/g, '').trim()
  if (!cleaned || cleaned === '-') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}
function parseInt10(s) {
  if (s == null) return null
  const t = String(s).trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
function parseDDMM(s) {
  if (!s) return null
  const t = String(s).trim()
  if (!t) return null
  // DD/MM/YYYY
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)
  if (m) {
    const [, d, mo, y] = m
    // 1900 is a CSV "no date / placeholder" sentinel (e.g. 29/02/1900 from
    // the source spreadsheet). Treat the whole year as null.
    if (y === '1900') return null
    return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`
  }
  // M/D/YYYY unusual form (present in rows 21, 22) — when the first group
  // looks like a month (>12 in slot 2 is impossible anyway), fall back to
  // the same DD/MM logic since the CSV is Hebrew/IL and dates are DMY.
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t)
  if (m) {
    const [, a, b, y] = m
    const yr = y.length === 4 ? y : (Number(y) >= 70 ? `19${y}` : `20${y}`)
    // Treat as DMY first (d/m/y); if d>31 swap.
    const d = Number(a), mo = Number(b)
    if (d > 12 && mo <= 12) return `${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    return `${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`
  }
  return null
}

// Activity-log parser.
const LINE_RE = new RegExp(
  '^\\s*(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})\\s*' +              // D/M/YYYY
  '(?:\\(\\s*(\\d{1,2}:\\d{2})\\s*[\\u2013\\u2014-]\\s*(\\d{1,2}:\\d{2})\\s*\\))?\\s*' + // optional (HH:MM–HH:MM)
  '[\\u2013\\u2014-]?\\s*(.+?)\\s*' +                          // optional – description
  '\\(\\s*([\\d.]+)\\s*(?:שעות|שעה)\\s*\\)\\s*$',             // (N שעות) or (N שעה)
  'u',
)

function parseActivityLog(raw) {
  const lines = []
  const anomalies = []
  if (!raw) return { lines, anomalies }
  const parts = String(raw).split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  for (const ln of parts) {
    if (/^סה["״]כ/.test(ln)) continue // the "סה״כ שעות" summary line
    const m = LINE_RE.exec(ln)
    if (!m) { anomalies.push(ln); continue }
    const [, d, mo, y, start, end, desc, hrs] = m
    const visit_date = `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`
    const hours = Number(hrs)
    lines.push({
      visit_date,
      start_time: start ? `${start}:00` : null,
      end_time: end ? `${end}:00` : null,
      hours,
      description: desc.trim(),
    })
  }
  return { lines, anomalies }
}

// Map client for a CSV name; returns { id, target_name, method } or null.
function matchClient(csvName, clients) {
  if (CONFIRMED_TARGETS.has(csvName)) {
    const target = CONFIRMED_TARGETS.get(csvName)
    if (target) {
      const hit = clients.find(c => c.name === target)
      if (hit) return { id: hit.id, target_name: hit.name, method: 'confirmed' }
    }
    // fall through to prefix lookup if the confirmed target is null/missing
  }
  for (const { csv, prefix } of PREFIX_LOOKUPS) {
    if (csv === csvName) {
      const hits = clients.filter(c => c.name.startsWith(prefix))
      if (hits.length === 1) return { id: hits[0].id, target_name: hits[0].name, method: 'prefix' }
      return { id: null, target_name: null, method: 'prefix-ambiguous', candidates: hits.map(h => h.name) }
    }
  }
  return null
}

// Column indices (from the CSV header).
// c1 שם לקוח · c2 סוג הסכם · c3 מוביל שירות · c4 קטגוריה · c5 מספר משרה ·
// c6 שם משרה · c7 תאריך פתיחה · c8 חתימת חוזה · c9 תאריך תחילת עבודה ·
// c10 תאריך תום אחריות · c11 תאריך שליחת חשבונית · c12 מועד לתשלום ·
// c13 סטטוס תשלום · c14 איש קשר · c15 חשבונית עסקה · c16 חשבונית מס קבלה ·
// c17 תשלום בפועל · c18 שליחת חן מס · c19 שכר למשרה · c20 עמלה ·
// c21 מספר מועמד · c22 מועמדים בתהליך · c23 סכום לתשלום חשבונית ·
// c24 עמלה לספק · c25 שם ספק משנה · c26 סה"כ הכנסה · c27 סטטוס תשלום לספק ·
// c28 חודש סגירה · c29 שנת סגירה · c30 חודש כניסה · c31 שנת כניסה ·
// c32 חיוב · c33 שנה עסקית
// (c0 is מס"ד = row number)

function buildRow(row, rowNumber, clientsById) {
  const [mid, client, agreement, lead, cat, posNum, posName,
         entryDate, closeDate, workStart, warrantyEnd, invSentDate, payDueDate,
         payStatus, invContact, invNumTxn, invNumReceipt, actualPay, shlicha,
         salaryStr, commissionStr, candidateNum, activityLog, netAmountStr,
         supplierCommissionStr, supplierName, totalRevenueStr, supplierPayStatus,
         closingMonth, closingYear, billingMonth, billingYear, billableCell,
         fiscalYear] = row
  void mid; void shlicha; void totalRevenueStr

  const category = (cat || '').trim()
  const closingYearN = parseInt10(closingYear)
  const isJunk = !category && (closingYearN === 1900 || closingYearN == null)
  if (isJunk) return { junk: true, rowNumber }

  const clientRaw = client.trim()
  const client_name = clientsById.targetByCsv.get(clientRaw)?.target_name ?? clientRaw
  const client_id = clientsById.targetByCsv.get(clientRaw)?.id ?? null

  const kind = category === 'מש"א במיקור חוץ' ? 'time_period' : 'service'
  const service_type_id = kind === 'service' ? (SERVICE_TYPE_IDS[category] ?? null) : null

  const payload = {
    kind,
    client_name,
    service_type: kind === 'service' ? category : null,
    service_type_id,
    service_lead: (lead || '').trim() || null,
    entry_date: parseDDMM(workStart) ?? parseDDMM(entryDate),
    close_date: parseDDMM(closeDate),
    work_start_date: parseDDMM(workStart),
    warranty_end_date: parseDDMM(warrantyEnd),
    invoice_sent_date: parseDDMM(invSentDate),
    payment_due_date: parseDDMM(payDueDate),
    payment_date: parseDDMM(actualPay),
    payment_status: (payStatus || '').trim() === 'שולם' ? 'שולם' : 'ממתין',
    is_billable: (billableCell || '').trim() === 'לחיוב',
    invoice_number: (invNumTxn || '').trim() || null,
    invoice_number_transaction: (invNumTxn || '').trim() || null,
    invoice_number_receipt: (invNumReceipt || '').trim() || null,
    closing_month: parseInt10(closingMonth),
    closing_year: parseInt10(closingYear),
    billing_month: parseInt10(billingMonth),
    billing_year: parseInt10(billingYear),
    net_invoice_amount: stripCurrency(netAmountStr),
    notes: `[${IMPORT_TAG_PREFIX}${rowNumber}] ${(agreement || '').trim()}`,
  }

  const position_name = (posName || '').trim() || null
  const position_number = (posNum || '').trim() || null
  const salary = stripCurrency(salaryStr)
  const commission = stripCurrency(commissionStr)
  const candidate_number_raw = (candidateNum || '').trim()
  const candidate_number = candidate_number_raw ? (Number.isFinite(Number(candidate_number_raw)) ? Number(candidate_number_raw) : candidate_number_raw) : null
  const supplier_commission = stripCurrency(supplierCommissionStr)
  const supplier_name = (supplierName || '').trim() || null
  const supplier_payment_status = (supplierPayStatus || '').trim() || null
  const invoice_contact = (invContact || '').trim() || null
  const fiscal_year_n = parseInt10(fiscalYear)

  if (kind === 'service') {
    const custom = {}
    if (position_number != null) custom.position_number = position_number
    if (position_name != null) custom.position_name = position_name
    if (salary != null) custom.salary = salary
    if (commission != null) custom.commission_amount = commission
    if (candidate_number != null) custom.candidate_number = candidate_number
    if (supplier_commission != null) custom.supplier_commission = supplier_commission
    if (supplier_name != null) custom.supplier_name = supplier_name
    if (supplier_payment_status != null) custom.supplier_payment_status = supplier_payment_status
    if (invoice_contact != null) custom.invoice_contact = invoice_contact
    if (fiscal_year_n != null) custom.fiscal_year = fiscal_year_n
    payload.custom_fields = custom
    // Mirror the known keys into dedicated columns too.
    if (position_name) payload.position_name = position_name
    if (candidate_number && typeof candidate_number === 'string') payload.candidate_name = candidate_number
    if (salary != null) payload.salary = salary
    if (commission != null) payload.commission_amount = commission
  } else {
    // time_period: שכר למשרה is actually the hourly rate; מספר מועמד is hours_total.
    const hourly_rate_used = salary
    const hours_total = candidate_number && Number.isFinite(Number(candidate_number)) ? Number(candidate_number) : null
    payload.hourly_rate_used = hourly_rate_used
    payload.hours_total = hours_total
    const custom = {}
    if (position_name != null) custom.deliverable_name = position_name
    if (invoice_contact != null) custom.invoice_contact = invoice_contact
    if (supplier_commission != null) custom.supplier_commission = supplier_commission
    if (supplier_name != null) custom.supplier_name = supplier_name
    if (supplier_payment_status != null) custom.supplier_payment_status = supplier_payment_status
    if (fiscal_year_n != null) custom.fiscal_year = fiscal_year_n
    payload.custom_fields = custom

    // Period from the activity log if possible, else full month range derived from closing_month/year.
    const { lines, anomalies } = parseActivityLog(activityLog)
    if (lines.length > 0) {
      const dates = lines.map(l => l.visit_date).sort()
      payload.period_start = dates[0]
      payload.period_end = dates[dates.length - 1]
    } else if (payload.closing_year && payload.closing_month) {
      const y = payload.closing_year, m = payload.closing_month
      const last = new Date(y, m, 0).getDate()
      payload.period_start = `${y}-${String(m).padStart(2,'0')}-01`
      payload.period_end = `${y}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}`
    }
    // Sanity check amount.
    if (payload.net_invoice_amount != null && hourly_rate_used != null && hours_total != null) {
      const expected = hourly_rate_used * hours_total
      const diff = Math.abs(expected - payload.net_invoice_amount)
      if (diff > 1) {
        payload._warning = `amount mismatch: got ${payload.net_invoice_amount}, expected ${expected} (hrs ${hours_total} × rate ${hourly_rate_used})`
      }
    }
    payload._hours_lines = lines
    payload._hours_anomalies = anomalies
  }

  payload._client_id = client_id
  payload._kind_label = category
  payload._rowNumber = rowNumber
  return payload
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------
async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  })
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`)
  return res.json()
}
async function sbPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${txt}`)
  return JSON.parse(txt)
}
async function sbDelete(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  })
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status} ${await res.text()}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const mode = process.argv[2] || 'preview'
  if (!['preview', 'import'].includes(mode)) {
    console.error('usage: import-2026-04-23.mjs preview|import')
    process.exit(2)
  }
  const csvText = readFileSync(CSV_PATH, 'utf8')
  const raw = parseCSV(csvText)
  // Strip the annotation row (row 0) and the header row (row 1). Data rows
  // start at raw[2]. The "row number" in the tag matches the מס"ד column
  // (first column) to stay human-friendly.
  const dataRows = raw.slice(2).filter(r => r.length > 1)

  let clients
  if (existsSync(CLIENTS_PATH)) {
    clients = JSON.parse(readFileSync(CLIENTS_PATH, 'utf8'))
  } else {
    clients = await sbGet('/rest/v1/clients?select=id,name,company_id')
    writeFileSync(CLIENTS_PATH, JSON.stringify(clients))
  }

  // Determine non-junk rows first so we only fail on unmatched names that
  // actually need to be imported.
  const nonJunkRows = dataRows.filter(r => {
    const cat = (r[4] || '').trim()
    const cy = parseInt10(r[29])
    const isJunk = !cat && (cy === 1900 || cy == null)
    return !isJunk
  })
  const uniqueCsvNames = [...new Set(nonJunkRows.map(r => (r[1] || '').trim()).filter(Boolean))]
  const targetByCsv = new Map()
  const unmatched = []
  for (const csvName of uniqueCsvNames) {
    const m = matchClient(csvName, clients)
    if (!m || !m.id) {
      unmatched.push({ csvName, candidates: m?.candidates ?? [] })
    } else {
      targetByCsv.set(csvName, m)
    }
  }

  const clientsById = { targetByCsv }

  // Build every row object (junk skipped).
  const built = []
  for (const r of dataRows) {
    const rowNumber = parseInt10(r[0])
    if (rowNumber == null) continue
    const result = buildRow(r, rowNumber, clientsById)
    built.push(result)
  }

  const junkRows = built.filter(b => b.junk).map(b => b.rowNumber)
  const valid = built.filter(b => !b.junk)
  const byKind = valid.reduce((acc, b) => {
    acc[b._kind_label] = (acc[b._kind_label] || 0) + 1
    return acc
  }, {})
  const totalHours = valid
    .filter(b => b.kind === 'time_period')
    .reduce((s, b) => s + (b._hours_lines?.length ?? 0), 0)
  const amountSum = valid.reduce((s, b) => s + (Number(b.net_invoice_amount) || 0), 0)

  // ----- Phase 2 preview -----
  const previewLines = []
  previewLines.push(`# Import preview — ${new Date().toISOString().slice(0,10)}`)
  previewLines.push('')
  previewLines.push(`- Total data rows in CSV: ${dataRows.length}`)
  previewLines.push(`- Junk rows skipped: ${junkRows.length} (row ids: ${junkRows.join(', ')})`)
  previewLines.push(`- Valid rows to import: ${valid.length}`)
  previewLines.push(`- Unique client names in CSV: ${uniqueCsvNames.length}`)
  previewLines.push(`- Matched client names: ${uniqueCsvNames.length - unmatched.length}`)
  previewLines.push(`- Unmatched client names: ${unmatched.length}`)
  previewLines.push('')
  previewLines.push('## Per-kind breakdown of valid rows')
  for (const [k, v] of Object.entries(byKind)) previewLines.push(`- ${k}: ${v}`)
  previewLines.push('')
  previewLines.push(`Total net_invoice_amount sum: ${amountSum.toLocaleString('he-IL', { style:'currency', currency:'ILS' })}`)
  previewLines.push(`hours_log lines to insert: ${totalHours}`)
  previewLines.push('')
  if (unmatched.length > 0) {
    previewLines.push('## Unmatched')
    for (const u of unmatched) {
      previewLines.push(`- "${u.csvName}" — candidates: ${u.candidates.join(' | ') || '(none)'}`)
    }
    previewLines.push('')
  }
  previewLines.push('## Matched client mapping')
  for (const csv of uniqueCsvNames) {
    if (!targetByCsv.has(csv)) continue
    const m = targetByCsv.get(csv)
    previewLines.push(`- "${csv}" → "${m.target_name}" (via ${m.method})`)
  }
  previewLines.push('')
  previewLines.push('## Activity-log parse anomalies')
  const anomalies = []
  for (const b of valid) {
    if (b._hours_anomalies?.length) {
      for (const line of b._hours_anomalies) anomalies.push(`- row ${b._rowNumber || '?'}: \`${line}\``)
    }
  }
  if (anomalies.length === 0) previewLines.push('(none)')
  else previewLines.push(...anomalies)
  previewLines.push('')
  previewLines.push('Rows will be inserted with notes tag `[IMPORT-2026-04-23-row-<N>]` for idempotency + rollback.')

  writeFileSync(resolve(ROOT, 'IMPORT_PREVIEW.md'), previewLines.join('\n') + '\n')
  console.log('wrote IMPORT_PREVIEW.md')

  if (unmatched.length > 0) {
    writeFileSync(resolve(ROOT, 'IMPORT_UNMATCHED.md'), previewLines.join('\n') + '\n')
    console.error('STOP: unmatched clients — IMPORT_UNMATCHED.md written.')
    process.exit(3)
  }

  if (mode === 'preview') {
    console.log('preview only — done.')
    return
  }

  // ----- Phase 3 insert -----
  const reportLines = []
  reportLines.push(`# Import report — 2026-04-23`)
  reportLines.push('')
  let inserted = 0
  let skipped = 0
  let errored = 0
  let hoursInserted = 0
  let hoursSkipped = 0
  const errors = []

  for (const b of valid.sort((a, b) => (a._rowNumber ?? 0) - (b._rowNumber ?? 0))) {
    const rowNumber = b._rowNumber ?? 0
    const tag = `[${IMPORT_TAG_PREFIX}${rowNumber}]`
    const existing = await sbGet(
      `/rest/v1/transactions?select=id,notes&notes=ilike.${encodeURIComponent('%' + tag + '%')}`,
    )
    if (existing.length > 0) {
      skipped += 1
      continue
    }
    // Drop private helpers before posting.
    const {
      _client_id, _kind_label, _hours_lines = [], _hours_anomalies = [], _warning,
      _rowNumber,
      ...payload
    } = b
    void _kind_label; void _rowNumber
    try {
      const inserted_txn = await sbPost('/rest/v1/transactions', [payload])
      const txnId = inserted_txn[0].id
      inserted += 1
      if (_warning) reportLines.push(`- row ${rowNumber}: ⚠ ${_warning}`)

      if (b.kind === 'time_period' && _hours_lines.length > 0) {
        const hoursPayload = _hours_lines.map(l => {
          const visitDate = new Date(l.visit_date)
          return {
            profile_id: OREN_PROFILE_ID,
            client_id: _client_id,
            client_name: payload.client_name,
            visit_date: l.visit_date,
            start_time: l.start_time,
            end_time: l.end_time,
            hours: l.hours,
            description: `${tag} ${l.description}`,
            month: visitDate.getMonth() + 1,
            year: visitDate.getFullYear(),
            billed_transaction_id: txnId,
          }
        })
        try {
          await sbPost('/rest/v1/hours_log', hoursPayload)
          hoursInserted += hoursPayload.length
        } catch (herr) {
          // Roll back the transaction so we don't leave a time_period row with no lines.
          await sbDelete(`/rest/v1/transactions?id=eq.${txnId}`)
          inserted -= 1
          errored += 1
          const msg = `row ${rowNumber}: hours_log insert failed → ${herr.message}`
          errors.push(msg)
          reportLines.push(`- ${msg} — transaction rolled back`)
        }
      }
      hoursSkipped += _hours_anomalies.length
    } catch (err) {
      errored += 1
      const msg = `row ${rowNumber}: transaction insert failed → ${err.message}`
      errors.push(msg)
      reportLines.push(`- ${msg}`)
    }
  }

  reportLines.push('')
  reportLines.push(`Total CSV data rows: ${dataRows.length}`)
  reportLines.push(`Junk rows skipped: ${junkRows.length} (row ids: ${junkRows.join(', ')})`)
  reportLines.push(`Valid rows seen: ${valid.length}`)
  reportLines.push(`Transactions inserted: ${inserted}`)
  reportLines.push(`Skipped (already imported): ${skipped}`)
  reportLines.push(`Errored transactions: ${errored}`)
  reportLines.push(`hours_log rows inserted: ${hoursInserted}`)
  reportLines.push(`hours_log lines that failed to parse: ${hoursSkipped}`)
  reportLines.push('')
  if (errors.length > 0) {
    reportLines.push('## Errors')
    for (const e of errors) reportLines.push(`- ${e}`)
  } else {
    reportLines.push('No errors.')
  }
  writeFileSync(resolve(ROOT, 'IMPORT_REPORT_2026-04-23.md'), reportLines.join('\n') + '\n')
  console.log('wrote IMPORT_REPORT_2026-04-23.md')
  console.log(`inserted=${inserted} skipped=${skipped} errored=${errored} hours=${hoursInserted}`)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
