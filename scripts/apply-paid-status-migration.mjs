import pg from 'pg'
import { readFileSync } from 'node:fs'

const { Client } = pg

const password = process.env.SUPABASE_DB_PASSWORD
if (!password) {
  console.error('SUPABASE_DB_PASSWORD is required')
  process.exit(1)
}

// Try direct first, then pooler.
const connStrings = [
  `postgresql://postgres.szunbwkmldepkwpxojma:${encodeURIComponent(password)}@aws-1-eu-central-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.szunbwkmldepkwpxojma:${encodeURIComponent(password)}@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`,
]

const sql = readFileSync(new URL('../supabase/migrations/20260512_billing_events_paid_status.sql', import.meta.url), 'utf8')

let lastErr
for (const cs of connStrings) {
  const client = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } })
  try {
    await client.connect()
    console.log('Connected via:', cs.replace(/:[^:@]+@/, ':***@'))
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('COMMIT')

    const r = await client.query(
      "SELECT status, COUNT(*)::int AS n FROM billing_events GROUP BY status ORDER BY status",
    )
    console.log('billing_events status distribution:')
    console.table(r.rows)

    const c = await client.query(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'billing_events_status_check'",
    )
    console.log('Constraint:', c.rows[0]?.def)

    await client.end()
    process.exit(0)
  } catch (err) {
    lastErr = err
    console.warn('Failed via', cs.replace(/:[^:@]+@/, ':***@'), '—', err.message)
    try { await client.end() } catch {}
  }
}

console.error('All connection strings failed.')
console.error(lastErr)
process.exit(1)
