#!/usr/bin/env node
// Repair 33 — WCAG contrast of the recruiter bonus palette (--bonus-* tokens in src/index.css), light + dark.
//   node scripts/check-bonus-contrast.mjs      exits 1 when any pair fails
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/index.css'), 'utf8')
const block = (re) => Object.fromEntries([...css.match(re)[1].matchAll(/--(bonus-[a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]))
const themes = { light: block(/:root\s*\{([\s\S]*?)\n\}/), dark: block(/\.dark\s*\{([\s\S]*?)\n\}/) }
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
// [foreground, background, minimum, what]  — min 4.5 text, 3 for text >= 24px and non-text graphics
const PAIRS = [
  ['bonus-text', 'bonus-surface', 4.5, 'body text on month card'],
  ['bonus-text', 'bonus-row', 4.5, 'body text on deal row'],
  ['bonus-muted', 'bonus-surface', 4.5, 'captions on month card'],
  ['bonus-title-ink', 'bonus-surface', 4.5, 'month name / labels on card'],
  ['bonus-title-ink', 'bonus-row', 4.5, 'deal title on row'],
  ['bonus-expected-ink', 'bonus-row', 4.5, 'deal sub-line on row'],
  ['bonus-expected-ink', 'bonus-expected-chip', 4.5, 'chip text "נכנסת ל…"'],
  ['bonus-expected', 'bonus-surface', 3, 'big expected number (34px)'],
  ['bonus-counted', 'bonus-surface', 3, 'big counted number (34px) / counted line'],
  ['bonus-counted-ink', 'bonus-counted', 4.5, 'text on solid counted fill'],
  ['bonus-expected', 'bonus-track', 3, 'expected stripe vs track (graphic)'],
  ['bonus-estimate', 'bonus-surface', 3, 'estimate dashed border vs card (graphic)'],
  ['bonus-estimate', 'bonus-track', 3, 'estimate dashed border vs track (graphic)'],
  ['bonus-counted', 'bonus-track', 3, 'counted fill vs track (graphic)'],
  ['bonus-expected', 'bonus-row', 3, 'row border vs row (graphic)'],
]
let fails = 0
for (const [theme, t] of Object.entries(themes)) {
  console.log(`\n${theme}`)
  for (const [fg, bg, min, what] of PAIRS) {
    const r = ratio(t[fg], t[bg])
    const ok = r >= min
    if (!ok) fails++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(5)} (min ${min})  ${fg} ${t[fg]} on ${bg} ${t[bg]} — ${what}`)
  }
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS')
process.exit(fails ? 1 : 0)
