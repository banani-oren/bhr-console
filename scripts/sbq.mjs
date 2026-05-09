// Tiny helper: run a SQL query against Supabase Management API.
// Usage: node scripts/sbq.mjs "SELECT 1"
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'

// Load .env.local manually (dotenv doesn't read it by default).
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const tok = process.env.SUPABASE_ACCESS_TOKEN
if (!tok) {
  console.error('SUPABASE_ACCESS_TOKEN missing')
  process.exit(2)
}

const sql = process.argv.slice(2).join(' ').trim()
if (!sql) {
  console.error('usage: node scripts/sbq.mjs "<sql>"')
  process.exit(2)
}

const res = await fetch('https://api.supabase.com/v1/projects/szunbwkmldepkwpxojma/database/query', {
  method: 'POST',
  headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
})
const text = await res.text()
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${text}`)
  process.exit(1)
}
console.log(text)
