import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Test photos are drawn once per machine instead of living in the repository. */
export const FIXTURES = fileURLToPath(
  new URL('../../test-results/fixtures/', import.meta.url),
)

/** Big-endian EXIF block with a single Orientation tag. */
function exifOrientation(value: number): Buffer {
  const tiff = Buffer.from([
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08, // MM, 42, IFD at 8
    0x00,
    0x01, // one entry
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    value,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00, // no next IFD
  ])
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff])
  const head = Buffer.from([0xff, 0xe1, 0, 0])
  head.writeUInt16BE(body.length + 2, 2)
  return Buffer.concat([head, body])
}

export default async function setup() {
  const files = [
    'photo-24mp.jpg',
    'transparent.png',
    'portrait-exif.jpg',
    'panorama.jpg',
    'noisy-12mp.jpg',
  ]
  if (files.every((f) => existsSync(FIXTURES + f))) return makeHeic()
  mkdirSync(FIXTURES, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const draw = (spec: { w: number; h: number; type: string; kind: string }) =>
    page.evaluate(async ({ w, h, type, kind }) => {
      const canvas = new OffscreenCanvas(w, h)
      const c = canvas.getContext('2d')!
      if (kind === 'cutout') {
        // A soft-edged orange ball on nothing.
        const g = c.createRadialGradient(
          w * 0.45,
          h * 0.4,
          0,
          w / 2,
          h / 2,
          h * 0.4,
        )
        g.addColorStop(0, '#ffd27a')
        g.addColorStop(1, '#e0601c')
        c.fillStyle = g
        c.beginPath()
        c.arc(w / 2, h / 2, h * 0.4, 0, Math.PI * 2)
        c.fill()
      } else {
        // Sky, sun, two hills: enough structure to compare previews and files.
        const sky = c.createLinearGradient(0, 0, 0, h)
        sky.addColorStop(0, '#2c6fb5')
        sky.addColorStop(1, '#f2c27c')
        c.fillStyle = sky
        c.fillRect(0, 0, w, h)
        c.fillStyle = '#fff3c4'
        c.beginPath()
        c.arc(w * 0.7, h * 0.3, Math.min(w, h) * 0.12, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = '#2f6b3a'
        c.beginPath()
        c.ellipse(w * 0.3, h, w * 0.5, h * 0.45, 0, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = '#1f4a2a'
        c.beginPath()
        c.ellipse(w * 0.85, h, w * 0.4, h * 0.3, 0, 0, Math.PI * 2)
        c.fill()
        if (kind === 'noise') {
          // Film grain everywhere: a real camera file of about 5 MB.
          const grain = c.getImageData(0, 0, w, h)
          for (let i = 0; i < grain.data.length; i += 4)
            for (let k = 0; k < 3; k++)
              grain.data[i + k] =
                grain.data[i + k]! + (Math.random() - 0.5) * 70
          c.putImageData(grain, 0, 0)
        }
        if (kind === 'marker') {
          // Red corner: tells where the top-left pixel of the file ends up.
          c.fillStyle = '#ff0000'
          c.fillRect(0, 0, w * 0.15, h * 0.15)
        }
      }
      const blob = await canvas.convertToBlob({ type, quality: 0.9 })
      return [...new Uint8Array(await blob.arrayBuffer())]
    }, spec)
  writeFileSync(
    FIXTURES + 'photo-24mp.jpg',
    Buffer.from(
      await draw({ w: 6000, h: 4000, type: 'image/jpeg', kind: 'scene' }),
    ),
  )
  writeFileSync(
    FIXTURES + 'transparent.png',
    Buffer.from(
      await draw({ w: 1200, h: 900, type: 'image/png', kind: 'cutout' }),
    ),
  )
  writeFileSync(
    FIXTURES + 'noisy-12mp.jpg',
    Buffer.from(
      await draw({ w: 4000, h: 3000, type: 'image/jpeg', kind: 'noise' }),
    ),
  )
  writeFileSync(
    FIXTURES + 'panorama.jpg',
    Buffer.from(
      await draw({ w: 8000, h: 1000, type: 'image/jpeg', kind: 'scene' }),
    ),
  )
  // Stored landscape with Orientation 6: every viewer shows it as a portrait.
  const landscape = Buffer.from(
    await draw({ w: 1600, h: 1200, type: 'image/jpeg', kind: 'marker' }),
  )
  writeFileSync(
    FIXTURES + 'portrait-exif.jpg',
    Buffer.concat([
      landscape.subarray(0, 2),
      exifOrientation(6),
      landscape.subarray(2),
    ]),
  )
  await browser.close()
  makeHeic()
}

/** A real HEIC, encoded by macOS itself; elsewhere the HEIC test is skipped. */
function makeHeic() {
  if (process.platform !== 'darwin' || existsSync(FIXTURES + 'iphone.heic'))
    return
  const marker = FIXTURES + 'marker.jpg'
  // The portrait without its EXIF block: a landscape with a red top-left corner.
  execFileSync('sips', [
    '-s',
    'format',
    'jpeg',
    FIXTURES + 'portrait-exif.jpg',
    '--out',
    marker,
  ])
  execFileSync('sips', [
    '-s',
    'format',
    'heic',
    marker,
    '--out',
    FIXTURES + 'iphone.heic',
  ])
}
