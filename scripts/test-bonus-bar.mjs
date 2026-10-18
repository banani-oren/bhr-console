#!/usr/bin/env node
// Repair 33 — tests for src/lib/bonusBar.ts (progress-bar geometry of the upcoming-bonus month cards).
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const src = stripTypeScriptTypes(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/lib/bonusBar.ts'), 'utf8'))
const { barGeometry } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))
let fails = 0
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`) }
const near = (name, got, want) => { const ok = Math.abs(got - want) < 1e-9; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` got=${got} want=${want}`}`) }
let g = barGeometry({ counted: 0, expected: 1600, next: 2100, estimateDeals: 1, avgDealBonus: 800 })
near('expected = 1600/2100', g.expected, 1600 / 2100); near('estimate capped by remaining (1 - expected)', g.estimate, 1 - 1600 / 2100); near('counted 0', g.counted, 0)
g = barGeometry({ counted: 800, expected: 1600, next: 2100, estimateDeals: 2, avgDealBonus: 800 })
near('counted = 800/2100', g.counted, 800 / 2100); near('expected never above 1 - counted', g.expected, 1 - 800 / 2100); near('estimate 0 when bar is full', g.estimate, 0)
g = barGeometry({ counted: 0, expected: 0, next: 800, estimateDeals: 1, avgDealBonus: 400 })
near('empty month: estimate = n × avg / next', g.estimate, 0.5)
g = barGeometry({ counted: 0, expected: 0, next: 800, estimateDeals: 3, avgDealBonus: 400 })
near('empty month: estimate capped at 1', g.estimate, 1)
eq('null estimate -> dashed segment not drawn', barGeometry({ counted: 0, expected: 800, next: 2100, estimateDeals: null, avgDealBonus: 800 }).estimate, 0)
eq('no history avg -> not drawn', barGeometry({ counted: 0, expected: 800, next: 2100, estimateDeals: 2, avgDealBonus: null }).estimate, 0)
eq('top tier, counted -> full counted bar', barGeometry({ counted: 3200, expected: 0, next: null, estimateDeals: null, avgDealBonus: null }), { counted: 1, expected: 0, estimate: 0 })
eq('top tier, only expected -> full expected bar', barGeometry({ counted: 0, expected: 3200, next: null, estimateDeals: null, avgDealBonus: null }), { counted: 0, expected: 1, estimate: 0 })
eq('nothing -> empty', barGeometry({ counted: 0, expected: 0, next: null, estimateDeals: null, avgDealBonus: null }), { counted: 0, expected: 0, estimate: 0 })
let ok = true
for (let i = 0; i < 2000; i++) { const x = barGeometry({ counted: Math.random() * 3000, expected: Math.random() * 3000, next: 1 + Math.random() * 3000, estimateDeals: Math.random() < 0.8 ? 1 + Math.floor(Math.random() * 5) : null, avgDealBonus: Math.random() < 0.8 ? Math.random() * 2000 : null }); if (x.counted < 0 || x.expected < 0 || x.estimate < 0 || x.counted + x.expected + x.estimate > 1 + 1e-9) ok = false }
eq('invariant: 2000 random inputs, segments >= 0 and sum <= 1', ok, true)
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0)
