#!/usr/bin/env node
// Deploy an Edge Function through the Supabase Management API (no CLI needed).
//   node scripts/deploy-edge.mjs <slug> [--no-verify-jwt]    (reads SUPABASE_ACCESS_TOKEN from .env.local)
// For functions with shared code run `npm run sync:edge` first.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, relative } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const env = Object.fromEntries(
  readFileSync(resolve(root, '.env.local'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
)
const slug = process.argv[2]
const verifyJwt = !process.argv.includes('--no-verify-jwt')
const dir = resolve(root, 'supabase/functions', slug)
const walk = (d) => readdirSync(d).flatMap((n) => { const p = resolve(d, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const form = new FormData()
form.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: slug, verify_jwt: verifyJwt }))
for (const f of walk(dir)) form.append('file', new Blob([readFileSync(f)]), relative(dir, f).replace(/\\/g, '/'))
const res = await fetch(`https://api.supabase.com/v1/projects/szunbwkmldepkwpxojma/functions/deploy?slug=${slug}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
  body: form,
})
const out = await res.json()
console.log(res.status, out.slug ?? JSON.stringify(out), out.status ?? '', 'v' + (out.version ?? '?'), 'verify_jwt=' + out.verify_jwt)
if (!res.ok) process.exit(1)
