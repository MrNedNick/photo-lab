// Draws the link preview cards (public/og/*.png). Run: node scripts/og.mjs
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const cards = [
  [
    'index',
    'Free image tools',
    'Remove background · Compress · Resize · Convert · Crop · Blur',
  ],
  [
    'remove-background',
    'Remove background',
    'Transparent PNG, a colour or a blur behind the subject',
  ],
  [
    'compress',
    'Compress an image',
    'Down to 100 KB, 500 KB or 1 MB at the best quality',
  ],
  [
    'resize',
    'Resize an image',
    '1080 px for social, 2048 px or any width — up to 50 at once',
  ],
  [
    'convert',
    'Convert to JPEG',
    'iPhone HEIC, PNG, WebP and AVIF to JPEG, PNG or WebP',
  ],
  ['crop', 'Crop a photo', '1:1, 4:5, 9:16, 16:9 — and straighten the horizon'],
  [
    'blur',
    'Blur faces and plates',
    'Hide what should not be shared, with a blur or pixels',
  ],
]
const html = (title, sub) => `<!doctype html><html><head><style>
  body { margin: 0; width: 1200px; height: 630px; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif;
    background: radial-gradient(900px 500px at 85% 20%, #2b3a22, transparent 60%), #101211; color: #f2f5ee;
    display: flex; flex-direction: column; justify-content: center; padding: 0 90px; box-sizing: border-box; }
  .brand { display: flex; align-items: center; gap: 16px; font-size: 34px; font-weight: 700; color: #c9f26f; }
  .mark { width: 54px; height: 54px; border-radius: 16px; background: #c9f26f; display: grid; place-items: center; }
  .mark i { width: 26px; height: 26px; border-radius: 50%; background: #222a20; }
  h1 { font-size: 92px; line-height: 1; letter-spacing: -0.03em; margin: 48px 0 26px; max-width: 1000px; }
  p { font-size: 34px; color: #b9c2b0; margin: 0; max-width: 980px; }
  .pill { position: absolute; left: 90px; bottom: 70px; font-size: 26px; font-weight: 600; color: #101211;
    background: #c9f26f; border-radius: 999px; padding: 12px 26px; }
</style></head><body><div class="brand"><span class="mark"><i></i></span>Photo Lab</div>
<h1>${title}</h1><p>${sub}</p><span class="pill">Free · No sign-up · Nothing uploaded</span></body></html>`

mkdirSync('public/og', { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
for (const [name, title, sub] of cards) {
  await page.setContent(html(title, sub))
  await page.screenshot({ path: `public/og/${name}.png` })
}
await browser.close()
