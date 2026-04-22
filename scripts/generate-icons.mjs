#!/usr/bin/env node
// Generate PWA icons from an inline SVG template.
// npm run generate:icons
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../public/icons')
mkdirSync(out, { recursive: true })

const anySvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#f9f5ff"/>
  <rect x="48" y="48" width="416" height="416" rx="72" fill="#7c3aed"/>
  <text x="256" y="310" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="220" font-weight="700" fill="#ffffff" letter-spacing="-6">BHR</text>
</svg>`.trim()

// Maskable icons need at least 10% safe zone — keep the important content
// inside a 412x412 center box.
const maskableSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#7c3aed"/>
  <text x="256" y="315" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="190" font-weight="700" fill="#ffffff" letter-spacing="-4">BHR</text>
</svg>`.trim()

async function render(svg, file, size) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(resolve(out, file))
  console.log('wrote', file)
}

await render(anySvg, 'icon-192.png', 192)
await render(anySvg, 'icon-512.png', 512)
await render(maskableSvg, 'icon-512-maskable.png', 512)
await render(anySvg, 'apple-touch-icon.png', 180)
