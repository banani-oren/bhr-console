import pg from 'pg'

const { Client } = pg
const password = process.env.SUPABASE_DB_PASSWORD
if (!password) {
  console.error('SUPABASE_DB_PASSWORD required')
  process.exit(1)
}

const cs = `postgresql://postgres.szunbwkmldepkwpxojma:${encodeURIComponent(password)}@aws-1-eu-central-1.pooler.supabase.com:6543/postgres`
const c = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } })
await c.connect()

let pass = 0, fail = 0
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`✓ ${label}`, detail) }
  else { fail++; console.log(`✗ ${label}`, detail) }
}

// ─── DB checks ───
const constraintRes = await c.query(
  "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='billing_events_status_check'",
)
const def = constraintRes.rows[0]?.def ?? ''
ok('constraint includes paid', def.includes("'paid'"), def)

const distRes = await c.query("SELECT status, COUNT(*)::int n FROM billing_events GROUP BY status ORDER BY status")
console.log('billing_events distribution:', distRes.rows)
const paidRow = distRes.rows.find(r => r.status === 'paid')
ok('paid status exists in data (backfilled)', !!paidRow && paidRow.n > 0)

// constraint allows insert with paid? Try a test insert+rollback
await c.query('BEGIN')
const txnRes = await c.query("SELECT id FROM transactions ORDER BY created_at DESC LIMIT 1")
const someTxnId = txnRes.rows[0]?.id
if (someTxnId) {
  try {
    await c.query(
      "INSERT INTO billing_events (transaction_id, event_index, amount, status, description) VALUES ($1, 999, 0, 'paid', '[QA-paid-test]')",
      [someTxnId],
    )
    ok('INSERT with status=paid accepted by constraint', true)
  } catch (e) {
    ok('INSERT with status=paid accepted by constraint', false, e.message)
  }
}
await c.query('ROLLBACK')

// ─── Logic checks (mirror frontend code) ───
function calculateTaxInvoiceDate(invoiceDate, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(invoiceDate)
  if (!m) return invoiceDate
  const year = Number(m[1]), month = Number(m[2])
  const eom = new Date(Date.UTC(year, month, 0))
  eom.setUTCDate(eom.getUTCDate() + days)
  return eom.toISOString().slice(0, 10)
}
function parsePaymentTermDays(t) {
  if (!t) return 30
  const s = String(t).replace(/\s+/g, '')
  if (/^\d+$/.test(s)) return Number(s)
  if (s === 'שוטף') return 0
  const m = s.match(/שוטף\+(\d+)/)
  if (m) return Number(m[1])
  return 30
}

ok('tax date 11/5/2026 + שוטף+30 = 30/6/2026',
  calculateTaxInvoiceDate('2026-05-11', 30) === '2026-06-30',
  calculateTaxInvoiceDate('2026-05-11', 30))
ok('tax date 11/5/2026 + שוטף+0 = 31/5/2026',
  calculateTaxInvoiceDate('2026-05-11', 0) === '2026-05-31',
  calculateTaxInvoiceDate('2026-05-11', 0))
ok('tax date 1/2/2026 + שוטף+15 = 15/3/2026',
  calculateTaxInvoiceDate('2026-02-01', 15) === '2026-03-15',
  calculateTaxInvoiceDate('2026-02-01', 15))
ok('tax date 31/1/2026 (Jan-end) + שוטף+30 = 2/3/2026',
  calculateTaxInvoiceDate('2026-01-31', 30) === '2026-03-02',
  calculateTaxInvoiceDate('2026-01-31', 30))

ok('parse "שוטף+30" = 30', parsePaymentTermDays('שוטף+30') === 30)
ok('parse "שוטף +30" (with space) = 30', parsePaymentTermDays('שוטף +30') === 30)
ok('parse "שוטף+0" = 0', parsePaymentTermDays('שוטף+0') === 0)
ok('parse "שוטף" alone = 0', parsePaymentTermDays('שוטף') === 0)
ok('parse plain "45" = 45', parsePaymentTermDays('45') === 45)
ok('parse null → 30 (default)', parsePaymentTermDays(null) === 30)
ok('parse "" → 30 (default)', parsePaymentTermDays('') === 30)

// ─── computeEventStatus ───
function computeEventStatus(e, approved) {
  if (e.status === 'cancelled') return 'cancelled'
  if (e.receipt_number) return 'paid'
  if (e.status === 'billed' || e.invoice_number) return 'billed'
  if (!approved) return 'pending'
  const today = new Date().toISOString().slice(0, 10)
  if (e.billing_date && e.billing_date <= today) return 'to_bill'
  return 'pending'
}
ok('computeEventStatus: receipt_number → paid',
  computeEventStatus({ status: 'billed', billing_date: null, invoice_number: 'A1', receipt_number: 'R1' }, true) === 'paid')
ok('computeEventStatus: invoice_number alone → billed',
  computeEventStatus({ status: 'to_bill', billing_date: null, invoice_number: 'A1', receipt_number: null }, true) === 'billed')
ok('computeEventStatus: cancelled stays cancelled',
  computeEventStatus({ status: 'cancelled', billing_date: null, invoice_number: 'A1', receipt_number: 'R1' }, true) === 'cancelled')

console.log(`\n${pass} passed, ${fail} failed`)
await c.end()
process.exit(fail === 0 ? 0 : 1)
