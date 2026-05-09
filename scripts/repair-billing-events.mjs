// Repair script: generate billing_events for orphaned transactions.
// - Service transactions with work_start_date but no events
// - Time_period transactions with net_invoice_amount > 0 but no events
//
// Usage: node scripts/repair-billing-events.mjs

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

// Load .env.local
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing')
  process.exit(2)
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

function addDays(iso, days) {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function parsePaymentTermDays(terms) {
  if (!terms) return 30
  const m = /(\d+)/.exec(terms)
  if (m) return Number(m[1])
  if (terms.includes('שוטף')) return 0
  return 30
}

const todayIso = new Date().toISOString().slice(0, 10)

// Fetch all transactions and existing events.
const { data: allTxns, error: txnErr } = await supabase
  .from('transactions')
  .select('*, clients!client_id(payment_split_json, advance_type, advance_amount, payment_terms, hourly_rate)')
if (txnErr) {
  console.error('fetch transactions error:', txnErr)
  process.exit(1)
}

const { data: existingEvents } = await supabase
  .from('billing_events')
  .select('transaction_id')
const billedTxnIds = new Set((existingEvents ?? []).map((e) => e.transaction_id))

let serviceFixed = 0
let timePeriodFixed = 0
let skipped = 0
let errors = 0

// 1. Service transactions
for (const t of allTxns ?? []) {
  if (t.kind !== 'service') continue
  if (!t.work_start_date) continue
  if (t.needs_approval && !t.approved_at) continue
  if (billedTxnIds.has(t.id)) continue

  const cf = t.custom_fields ?? {}
  const salary = Number(cf.salary ?? t.salary ?? 0)
  const commPct = Number(cf.commission_percent ?? t.commission_percent ?? 0)
  if (!salary || !commPct) {
    console.warn(`skip ${t.client_name} / ${t.service_type}: missing salary or commission`)
    skipped++
    continue
  }

  const totalCommission = salary * (commPct / 100)
  const paymentSplit = (t.clients && Array.isArray(t.clients.payment_split_json) && t.clients.payment_split_json.length > 0)
    ? t.clients.payment_split_json
    : [{ percent: 100, days: 0 }]
  const supplierPct = Number(t.supplier_percent ?? 0)
  const candidateName = String(cf.candidate_name ?? t.candidate_name ?? '')
  const isApproved = !t.needs_approval || !!t.approved_at

  const events = paymentSplit.map((s, i) => {
    const gross = totalCommission * (Number(s.percent) / 100)
    const supplierAmt = Math.round(gross * (supplierPct / 100) * 100) / 100
    const billingDate = addDays(t.work_start_date, Number(s.days) || 0)
    const isPast = billingDate <= todayIso
    return {
      transaction_id: t.id,
      event_index: i + 1,
      amount: Math.round(gross * 100) / 100,
      description: [t.service_type, candidateName, `${s.percent}%`].filter(Boolean).join(' · '),
      billing_date: billingDate,
      status: isApproved && isPast ? 'to_bill' : 'pending',
      invoice_number: null,
      payment_date: null,
      receipt_number: null,
      advance_applied: 0,
      supplier_amount: supplierAmt,
    }
  })

  const { error } = await supabase.from('billing_events').insert(events)
  if (error) {
    console.error(`error for ${t.client_name} / ${t.service_type}:`, error.message)
    errors++
  } else {
    serviceFixed++
    console.log(`✓ service: ${t.client_name} / ${t.service_type} / ${t.work_start_date} → ${events.length} event(s)`)
  }
}

// 2. Time_period transactions
for (const t of allTxns ?? []) {
  if (t.kind !== 'time_period') continue
  const amount = Number(t.net_invoice_amount)
  if (!amount || amount <= 0) continue
  if (billedTxnIds.has(t.id)) continue

  const paymentTerms = t.clients?.payment_terms ?? null
  const termDays = parsePaymentTermDays(paymentTerms)
  const billingDate = addDays(todayIso, termDays)
  const periodStart = t.period_start ?? ''
  const periodEnd = t.period_end ?? ''
  const description = `שעות עבודה · ${t.client_name} · ${periodStart} – ${periodEnd}`
  const isApproved = !t.needs_approval || !!t.approved_at

  const { error } = await supabase.from('billing_events').insert({
    transaction_id: t.id,
    event_index: 1,
    amount,
    description,
    billing_date: billingDate,
    status: isApproved && billingDate <= todayIso ? 'to_bill' : 'pending',
    invoice_number: null,
    payment_date: null,
    receipt_number: null,
    advance_applied: 0,
    supplier_amount: 0,
  })
  if (error) {
    console.error(`error for time_period ${t.client_name}:`, error.message)
    errors++
  } else {
    timePeriodFixed++
    console.log(`✓ time_period: ${t.client_name} / ₪${amount}`)
  }
}

console.log(`\nRepair complete: service=${serviceFixed}, time_period=${timePeriodFixed}, skipped=${skipped}, errors=${errors}`)
