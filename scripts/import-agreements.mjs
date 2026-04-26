#!/usr/bin/env node
/**
 * import-agreements.mjs
 * ─────────────────────
 * Reads "כרטיסי לקוחות" from מעקב השמות 2026.xlsx and upserts
 * agreement terms onto the `clients` table (non-overwrite: only fills
 * currently-null columns so live edits are never clobbered).
 *
 * The `agreements` table is DEPRECATED — do NOT write to it.
 * All agreement data lives on the `clients` table.
 *
 * Usage (run from App Dev/ folder):
 *   node scripts/import-agreements.mjs            ← live run
 *   node scripts/import-agreements.mjs --dry-run  ← preview only, no writes
 *
 * Note on "אחוז עמלה":
 *   The Excel stores it as a fraction-of-month multiplier (0.9 = 90%, 1 = 100%).
 *   The DB column `commission_percent` expects the numeric percentage (90, 100).
 *   This script multiplies by 100 before writing.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require   = createRequire(import.meta.url)
const XLSX      = require('xlsx')           // xlsx is CJS-only
const DRY_RUN   = process.argv.includes('--dry-run')

// ─── 1. Load credentials ──────────────────────────────────────────────────────

const envPath = resolve(__dirname, '../.env.local')
const envRaw  = readFileSync(envPath, 'utf-8')
const env     = Object.fromEntries(
  envRaw.split('\n')
    .map(l => l.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.trim().replace(/^["']|["']$/g, '')])
)

const SUPABASE_URL = env.VITE_SUPABASE_URL
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ─── 2. Parse Excel ───────────────────────────────────────────────────────────

// Default path: Excel is 3 levels up from App Dev/ (at C:\Users\Oren level)
const DEFAULT_EXCEL = resolve(
  __dirname,
  '../../../Banani HR/Shared Folders - מסמכים/BANANI HR/CLAUDE/ניהול עסק BHR/מעקב השמות 2026.xlsx'
)
const excelArgIdx = process.argv.indexOf('--excel')
const EXCEL_PATH  = excelArgIdx !== -1 ? process.argv[excelArgIdx + 1] : DEFAULT_EXCEL

console.log('📂  Reading:', EXCEL_PATH)
const wb = XLSX.readFile(EXCEL_PATH)
const ws = wb.Sheets['כרטיסי לקוחות']
if (!ws) {
  console.error('❌  Sheet "כרטיסי לקוחות" not found in workbook')
  process.exit(1)
}

const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

/**
 * Parse vertical card format:
 *   [Client Name]
 *   [שדה | פרטים]   ← detected header
 *   [field | value]
 *   ...
 *   [blank row]      ← card separator
 */
function parseCards(rows) {
  const cards = []
  for (let i = 0; i < rows.length; i++) {
    const cell0 = String(rows[i]?.[0] ?? '').trim()
    if (!cell0.startsWith('שדה')) continue

    // Client name is the last non-empty row before this header
    let nameIdx = i - 1
    while (nameIdx >= 0 && !String(rows[nameIdx]?.[0] ?? '').trim()) nameIdx--
    const clientName = String(rows[nameIdx]?.[0] ?? '').trim()
    if (!clientName || clientName.startsWith('שדה')) continue

    const card = { name: clientName, fields: {}, contacts: [] }
    let j = i + 1
    let inContacts = false

    while (j < rows.length) {
      const f = String(rows[j]?.[0] ?? '').trim()
      const v = String(rows[j]?.[1] ?? '').trim()
      if (!f && !v) { j++; break }             // blank row → end of card
      if (f.startsWith('שדה')) break           // next card header

      if (f === 'אנשי קשר' || f === 'איש קשר' || f === 'קשר') {
        inContacts = true; j++; continue
      }
      if (inContacts) {
        if (f === 'שם')                                              card.contacts.push({ name: v, email: '', phone: '' })
        else if ((f === 'מייל' || f === 'אימייל') && card.contacts.length) card.contacts.at(-1).email = v
        else if (f === 'טלפון' && card.contacts.length)              card.contacts.at(-1).phone = v
      } else {
        if (f) card.fields[f] = v
      }
      j++
    }

    cards.push(card)
    i = j - 1
  }
  return cards
}

const cards = parseCards(rows)
console.log(`📋  Parsed ${cards.length} client cards\n`)
if (cards.length === 0) { console.error('❌  No cards parsed — check Excel structure'); process.exit(1) }

// ─── 3. Map Excel fields → clients table columns ──────────────────────────────

/** Look up a field by any of the given Hebrew key names (ignore trailing colons) */
function get(fields, ...keys) {
  for (const k of keys) {
    for (const fk of Object.keys(fields)) {
      if (fk.replace(/:$/, '').trim() === k && fields[fk] && fields[fk] !== '-') {
        return fields[fk]
      }
    }
  }
  return ''
}

/** "60 ימים" → 60  /  "0" → 0  /  anything else → null */
function parseWarranty(v) {
  if (!v) return null
  const m = String(v).match(/\d+/)
  return m ? parseInt(m[0]) : null
}

/**
 * Parse commission from Excel fraction-of-month multiplier → DB percentage.
 * Excel 0.9  → DB 90  (0.9 months × 100)
 * Excel 1.0  → DB 100
 * Excel 1.1  → DB 110
 */
function parseCommission(v) {
  if (!v || v === '' || v === '-') return null
  const n = parseFloat(String(v).replace('%', '').replace(',', '.').trim())
  if (isNaN(n)) return null
  // Values < 2 are fraction-of-month multipliers; multiply × 100 for DB
  return n < 2 ? Math.round(n * 100 * 10) / 10 : n
}

/** "כן" → true */
function parseExclusivity(v) {
  return String(v ?? '').trim() === 'כן'
}

/**
 * Build a PARTIAL update payload — only non-null fields that the DB column
 * is currently null/empty for (enforced at apply time by checking current client).
 */
function cardToFields(card) {
  const f         = card.fields
  const hourlyRaw = get(f, 'תשלום שעתי', 'שעתי')

  return {
    agreement_type    : get(f, 'סוג הסכם', 'סוג ההסכם', 'הסכם')   || null,
    commission_percent: parseCommission(get(f, 'אחוז עמלה', 'עמלה')),
    // salary_basis is a text description like "1 משכורות"; derive from commission multiplier
    salary_basis      : (() => {
      const raw = get(f, 'אחוז עמלה', 'עמלה')
      if (!raw || raw === '-') return null
      const n = parseFloat(raw)
      return isNaN(n) ? null : `${n} משכורות`
    })(),
    warranty_days     : parseWarranty(get(f, 'תקופת אחריות', 'אחריות')),
    payment_terms     : get(f, 'תנאי תשלום', 'תנאי שוטף', 'שוטף') || null,
    payment_split     : get(f, 'חלוקת תשלום', 'מועד תשלום')       || null,
    advance           : get(f, 'מקדמה', 'תשלום מראש')              || null,
    exclusivity       : parseExclusivity(get(f, 'בלעדיות'))        || false,
    // Hourly clients: store rate in hourly_rate
    hourly_rate       : hourlyRaw ? (parseFloat(hourlyRaw.replace(/[,₪\s]/g, '')) || null) : null,
  }
}

/**
 * Non-overwrite merge: only include keys where the current DB value is null/empty/false.
 * Returns null if there's nothing to update.
 */
function buildPatch(current, newFields) {
  const patch = {}
  for (const [k, v] of Object.entries(newFields)) {
    if (v == null || v === '' || v === false) continue   // nothing to set
    const curr = current[k]
    if (curr == null || curr === '' || curr === false) {
      patch[k] = v
    }
  }
  return Object.keys(patch).length > 0 ? patch : null
}

// ─── 4. Fuzzy match — Dice coefficient on character bigrams ──────────────────

function bigrams(s) {
  const c = String(s).toLowerCase().replace(/[\s'"()\-–.,\/\\]+/g, '')
  const bg = new Set()
  for (let i = 0; i < c.length - 1; i++) bg.add(c.slice(i, i + 2))
  return bg
}

function dice(a, b) {
  const ba = bigrams(a), bb = bigrams(b)
  if (!ba.size && !bb.size) return 1
  if (!ba.size || !bb.size) return 0
  let inter = 0
  for (const g of ba) if (bb.has(g)) inter++
  return (2 * inter) / (ba.size + bb.size)
}

function bestMatch(name, clients) {
  let best = null, bestScore = -1
  for (const c of clients) {
    const s = dice(name, c.name)
    if (s > bestScore) { bestScore = s; best = c }
  }
  return { client: best, score: bestScore }
}

// ─── 5. Fetch all clients ─────────────────────────────────────────────────────

console.log('🔌  Fetching clients from Supabase...')
const { data: clients, error: fetchErr } = await supabase
  .from('clients')
  .select('id, name, agreement_type, commission_percent, salary_basis, warranty_days, payment_terms, payment_split, advance, exclusivity, hourly_rate')
  .order('name')

if (fetchErr) {
  console.error('❌  Fetch failed:', fetchErr.message)
  process.exit(1)
}
console.log(`👥  ${clients.length} clients in DB\n`)

// ─── 6. Match, diff, upsert ──────────────────────────────────────────────────

const MATCH_THRESHOLD = 0.4
let nUpdated = 0, nSkipped = 0, nNoMatch = 0, nErrors = 0, nManual = 0

// MANUAL_OVERRIDES: Excel card name → exact clients.id
// Populated by Phase 1 of IMPORT_AGREEMENTS_FROM_EXCEL.md after DB ilike search.
// See IMPORT_AGREEMENTS_MATCH_REPORT.md for the audit trail.
const MANUAL_OVERRIDES = {
  'אגד'        : 'fa7922ee-3fdb-4d5d-b86e-157de7d0ceac', // אגד חברה לתחבורה בע"מ
  'אלטמן'      : 'e5594dee-e41b-40a6-be9b-e0419e675638', // אלטמן בריאות שותפות כללית
  'גינדי'      : '9cace69b-6ea0-4446-82ed-be9ede33c06d', // קבוצת גינדי חן ואיתי גינדי בע"מ
  'ZAP'        : '480a918b-e9c4-48db-9ca8-647e85e37612', // קבוצת זאפ
  'כאל'        : 'bfa6c0f5-a39e-42dd-8521-22f80d8a4a6c', // CAL כרטיסי אשראי לישראל בע"מ (transliteration)
  'קואליטי'    : '23f8d813-0ea8-4bd9-b095-c456b906f334', // קוואליטי סוכנות לביטוח (2017) בע"מ
  'REBAR'      : '0ac8fe2c-0969-40bb-9c45-9cf221a00240', // ריבאר בעמ (transliteration)
  'שילב'       : 'b105e345-ad27-42bf-adee-a6b8fc20f361', // שילב שיווק ישיר לבית היולדת בע"מ
  // Group C overrides — fuzzy matched the WRONG client, force the correct one:
  'ניוטון'      : '2b3ad026-0ae7-475f-83be-ea9782554e23', // ניוטון מרכזים חינוכיים בע"מ (fuzzy picked צ'מפיון)
  'קבוצת גורמה': 'e75d5ffb-9fd6-4d80-8938-55ce7ef85324', // גורמה ארוחות בע"מ (fuzzy picked קבוצת זאפ)
  'קבוצת שליו' : 'e3e9cad5-f3cc-4966-9e26-dfab212e8139', // שלו ובניו בע"מ (fuzzy picked קבוצת זאפ)
}

if (DRY_RUN) console.log('⚠️   DRY RUN — no data will be written\n')

const unmatched = []

for (const card of cards) {
  const overrideId = MANUAL_OVERRIDES[card.name]
  const overrideClient = overrideId ? clients.find(c => c.id === overrideId) ?? null : null
  const { client, score } = overrideClient
    ? { client: overrideClient, score: 1 }
    : bestMatch(card.name, clients)
  const pct = overrideClient ? '🔧 ' : (score * 100).toFixed(0).padStart(3) + '%'

  if (!client || score < MATCH_THRESHOLD) {
    const top3 = [...clients]
      .map(c => ({ c, s: dice(card.name, c.name) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .map(x => `"${x.c.name}" (${(x.s * 100).toFixed(0)}%)`)
      .join(', ')
    console.log(`⚠️   NO MATCH  "${card.name}"`)
    console.log(`           top candidates: ${top3}`)
    unmatched.push({ excelName: card.name, top3: top3.split(', ') })
    nNoMatch++
    continue
  }

  const newFields = cardToFields(card)
  const patch     = buildPatch(client, newFields)

  const patchSummary = patch
    ? Object.entries(patch).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
    : '(all fields already set — skip)'

  console.log(`${pct}  "${card.name}" → "${client.name}"`)
  if (patch) console.log(`           patch: ${patchSummary}`)
  else       console.log(`           no new fields — skipping`)

  if (!patch) { nSkipped++; continue }
  if (overrideClient) nManual++
  if (DRY_RUN) { nUpdated++; continue }

  const { error } = await supabase
    .from('clients')
    .update(patch)
    .eq('id', client.id)

  if (error) {
    console.error(`           ❌  Update error: ${error.message}`)
    nErrors++
  } else {
    nUpdated++
  }
}

// ─── 7. Summary ───────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(64))
if (DRY_RUN) {
  console.log(`✨  Dry run — would update ${nUpdated} (incl. ${nManual} via manual override), skip ${nSkipped} (all-set), unmatch ${nNoMatch}`)
} else {
  console.log(`✨  Done — updated ${nUpdated} (incl. ${nManual} via manual override), skipped ${nSkipped} (already set), no-match ${nNoMatch}, errors ${nErrors}`)
}

if (unmatched.length > 0) {
  console.log('\n⚠️   Unmatched cards (need manual mapping in IMPORT_AGREEMENTS_MATCH_REPORT.md):')
  unmatched.forEach(u => console.log(`  - "${u.excelName}"`))
}
