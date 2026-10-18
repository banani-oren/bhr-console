#!/usr/bin/env node
// Generate every brand asset from the one logo source (Repair 30).
// npm run generate:icons
//
// Source: public/brand/bhr-logo-source.png — 1080x1080 RGBA, transparent
// background, navy (#150c82) lowercase "b" + superscript "hr". The mark is
// never redrawn: everything below is trim / recolor / compose of that file.
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const pub = resolve(here, '../public')
const brand = resolve(pub, 'brand')
const icons = resolve(pub, 'icons')
mkdirSync(icons, { recursive: true })

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }

// 1. Trim the transparent padding.
const trimmedBuf = await sharp(resolve(brand, 'bhr-logo-source.png'))
  .ensureAlpha()
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
  .toBuffer()

// bhr-logo.png — navy on transparent, ~512px on the long side.
const navyBuf = await sharp(trimmedBuf)
  .resize({ width: 512, height: 512, fit: 'inside' })
  .png({ compressionLevel: 9 })
  .toBuffer()
writeFileSync(resolve(brand, 'bhr-logo.png'), navyBuf)
console.log('wrote brand/bhr-logo.png')

// bhr-logo-white.png — same shape, RGB forced to pure white, alpha untouched.
{
  const { data, info } = await sharp(navyBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(resolve(brand, 'bhr-logo-white.png'))
  console.log('wrote brand/bhr-logo-white.png')
}

// Logo centred on a white square, the logo's long side = `fraction` of the canvas.
async function onWhite(size, fraction, { rounded = false } = {}) {
  const box = Math.round(size * fraction)
  const logo = await sharp(trimmedBuf).resize({ width: box, height: box, fit: 'inside' }).toBuffer()
  const base = sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
  let img = await base.composite([{ input: logo, gravity: 'center' }]).png().toBuffer()
  if (rounded) {
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * 0.19)}"/></svg>`,
    )
    img = await sharp(img).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
  }
  return img
}

// 2. Browser tab icon — SVG embedding the navy PNG on a white rounded square (~10% padding).
{
  const b64 = navyBuf.toString('base64')
  const meta = await sharp(navyBuf).metadata()
  const inner = 256 * 0.8
  const scale = inner / Math.max(meta.width, meta.height)
  const w = meta.width * scale
  const h = meta.height * scale
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="48" fill="#ffffff"/>
  <image x="${((256 - w) / 2).toFixed(2)}" y="${((256 - h) / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" href="data:image/png;base64,${b64}" xlink:href="data:image/png;base64,${b64}"/>
</svg>
`
  writeFileSync(resolve(pub, 'favicon.svg'), svg)
  console.log('wrote favicon.svg')
}

// favicon.ico — 16/32/48 PNG-in-ICO.
{
  const sizes = [16, 32, 48]
  const pngs = await Promise.all(sizes.map((s) => onWhite(s, 0.8, { rounded: true })))
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(sizes.length, 4)
  let offset = 6 + 16 * sizes.length
  const dir = Buffer.alloc(16 * sizes.length)
  sizes.forEach((s, i) => {
    const o = i * 16
    dir.writeUInt8(s, o)
    dir.writeUInt8(s, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(pngs[i].length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += pngs[i].length
  })
  writeFileSync(resolve(pub, 'favicon.ico'), Buffer.concat([head, dir, ...pngs]))
  console.log('wrote favicon.ico')
}

// 3. PWA / home-screen icons. "any" icons: logo ~72% of a white square.
// Maskable: Android may crop to a circle of 80% diameter, so the logo's long side
// stays within 55% (its diagonal then sits inside the safe zone).
const write = async (file, size, fraction, opts) => {
  let img = sharp(await onWhite(size, fraction, opts))
  if (!opts?.rounded) img = img.flatten({ background: '#ffffff' }) // no transparency
  await img.png({ compressionLevel: 9 }).toFile(resolve(icons, file))
  console.log('wrote icons/' + file)
}
await write('icon-192.png', 192, 0.72)
await write('icon-512.png', 512, 0.72)
await write('icon-512-maskable.png', 512, 0.55)
await write('apple-touch-icon.png', 180, 0.72)

// 4. Inline copy for places that cannot fetch a URL: jsPDF headers and the
// about:blank print window (src/lib/brandLogoData.ts, generated — do not edit).
{
  const small = await sharp(trimmedBuf).resize({ width: 160, height: 160, fit: 'inside' }).png({ compressionLevel: 9 }).toBuffer()
  const m = await sharp(small).metadata()
  writeFileSync(
    resolve(here, '../src/lib/brandLogoData.ts'),
    `// GENERATED by scripts/generate-icons.mjs from public/brand/bhr-logo-source.png (Repair 30). Do not edit.\n` +
      `export const BRAND_LOGO_PNG = 'data:image/png;base64,${small.toString('base64')}'\n` +
      `/** width ÷ height of the trimmed logo */\n` +
      `export const BRAND_LOGO_ASPECT = ${(m.width / m.height).toFixed(4)}\n`,
  )
  console.log('wrote src/lib/brandLogoData.ts')
}
