#!/usr/bin/env node
// Repair 32 — runs the working-day calendar tests: fixed holiday cases, TS holiday list == live
// il_non_working_days, and 200 random dates TS vs SQL bhr_add_business_days / bhr_is_workday.
//   node scripts/test-il-calendar.mjs      (reads SUPABASE_ACCESS_TOKEN from .env.local)
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  readFileSync(resolve(root, '.env.local'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
)

// Load ilCalendar.ts without a bundler: strip types, inline the workHours import.
const work = stripTypeScriptTypes(readFileSync(resolve(root, 'src/lib/workHours.ts'), 'utf8'))
const cal = stripTypeScriptTypes(readFileSync(resolve(root, 'src/lib/ilCalendar.ts'), 'utf8'))
  .replace(/import \{[^}]*\} from '@\/lib\/workHours'\n/, '')
const mod = await import('data:text/javascript;base64,' + Buffer.from(work + '\n' + cal).toString('base64'))
const { IL_NON_WORKING_DAYS, isWorkday, addBusinessDays, expectedHours, isErevHoliday, workdaysBetween } = mod

const sql = async (query) => {
  const r = await fetch('https://api.supabase.com/v1/projects/szunbwkmldepkwpxojma/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ query }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(j))
  return j
}

let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`)
}

// 1. Fixed cases (A.6)
// Wed 2026-04-01 +2: Thu 04-02 is Pesach, Fri/Sat off, Sun 04-05, Mon 04-06 -> 04-06
check('Pesach 2026: 04-01 + 2 skips 04-02', addBusinessDays('2026-04-01', 2), '2026-04-06')
// Mon 04-06 +2: Tue 04-07, (Wed 04-08 is the 7th day) Thu 04-09 -> 04-09
check('Pesach 2026: 04-06 + 2 skips 04-08', addBusinessDays('2026-04-06', 2), '2026-04-09')
// Fri 09-11 +1: Sat 09-12 / Sun 09-13 are Rosh Hashanah -> Mon 09-14
check('Rosh Hashanah 2026: 09-11 + 1 -> 09-14', addBusinessDays('2026-09-11', 1), '2026-09-14')
check('Rosh Hashanah 2026: 09-13 is not a workday (Sunday)', isWorkday('2026-09-13'), false)
// Fri 2027-10-08 +2: Sun 10-10 (1), Mon 10-11 Yom Kippur skipped, Tue 10-12 (2) -> 10-12
check('Yom Kippur 2027: 10-08 + 2 skips 10-11', addBusinessDays('2027-10-08', 2), '2027-10-12')
check('Oren example 2026-10-07 + 5 (no holiday in window)', addBusinessDays('2026-10-07', 5), '2026-10-14')
check('Erev Yom Kippur 2026-09-20 is erev', isErevHoliday('2026-09-20'), true)
check('Chol HaMoed 2026-04-05 is a workday', isWorkday('2026-04-05'), true)
check('Friday is not a workday', isWorkday('2026-10-16'), false)
// 2026-09-20 (Sun, erev, 7h) .. 2026-09-24 (Thu): 7 + 4 workdays... 09-21 YK off -> 20:7, 22,23,24: 3*8.4
check('expectedHours 09-20..09-24', expectedHours('2026-09-20', '2026-09-24'), Math.round((7 + 3 * 8.4) * 100) / 100)
check('workdaysBetween 2026-09-10..09-14', workdaysBetween('2026-09-10', '2026-09-14'), ['2026-09-10', '2026-09-14'])

// 2. TS list == DB table
const db = await sql('select day::text as day, name from il_non_working_days order by day')
const dbMap = Object.fromEntries(db.map((r) => [r.day, r.name]))
check('holiday table: row count', db.length, Object.keys(IL_NON_WORKING_DAYS).length)
check('holiday table: TS list == il_non_working_days (dates + names)', dbMap, IL_NON_WORKING_DAYS)

// 3. 200 random dates, TS vs SQL
let seed = 20261019
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
const start = Date.UTC(2026, 0, 1), span = Date.UTC(2027, 11, 31) - start
const cases = Array.from({ length: 200 }, () => ({
  d: new Date(start + Math.floor(rnd() * (span / 86400000)) * 86400000).toISOString().slice(0, 10),
  n: 1 + Math.floor(rnd() * 10),
}))
const values = cases.map((c, i) => `(${i}, '${c.d}'::date, ${c.n})`).join(',')
const rows = await sql(`select i, bhr_add_business_days(d, n)::text as added, bhr_is_workday(d) as wd from (values ${values}) v(i, d, n) order by i`)
const bad = rows.filter((r) => r.added !== addBusinessDays(cases[r.i].d, cases[r.i].n) || r.wd !== isWorkday(cases[r.i].d))
check('parity: 200 random dates, SQL == TS (add_business_days + is_workday)', bad.length, 0)
if (bad.length) console.log(bad.slice(0, 5))

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)
