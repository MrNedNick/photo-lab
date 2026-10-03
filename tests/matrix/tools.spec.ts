import { existsSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { FIXTURES } from './fixtures.setup'

/*
 * Every tool, open → apply → export, on Chromium, Firefox and WebKit at 360
 * and 1440 px. Each export is decoded back and compared with what the editor
 * showed: size, shape and average colour.
 */

interface Stats {
  width: number
  height: number
  mean: [number, number, number]
  /** Share of fully transparent pixels. */
  clear: number
  /** RGBA at the requested relative points. */
  samples: number[][]
}

async function stats(
  page: Page,
  bytes: Buffer,
  type: string,
  points: [number, number][] = [],
): Promise<Stats> {
  return page.evaluate(
    async ({ base64, type, points }) => {
      const blob = new Blob(
        [Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))],
        { type },
      )
      const bitmap = await createImageBitmap(blob)
      // Statistics on a small copy: fast on every engine, even for 24 MP.
      const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height))
      const w = Math.max(1, Math.round(bitmap.width * scale)),
        h = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0, w, h)
      const data = ctx.getImageData(0, 0, w, h).data
      const sum = [0, 0, 0]
      let opaque = 0,
        clear = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) {
          clear++
          continue
        }
        opaque++
        sum[0] += data[i]!
        sum[1] += data[i + 1]!
        sum[2] += data[i + 2]!
      }
      const samples = points.map(([x, y]) => {
        const i =
          (Math.min(h - 1, Math.floor(y * h)) * w +
            Math.min(w - 1, Math.floor(x * w))) *
          4
        return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]
      })
      return {
        width: bitmap.width,
        height: bitmap.height,
        mean: sum.map((s) => s / Math.max(1, opaque)) as [
          number,
          number,
          number,
        ],
        clear: clear / (data.length / 4),
        samples,
      }
    },
    { base64: bytes.toString('base64'), type, points },
  )
}

async function openFile(page: Page, file: string) {
  await page.goto('./')
  await page.locator('#file').setInputFiles(FIXTURES + file)
  await expect(page.locator('#export')).toBeEnabled({ timeout: 90000 })
  await expect(page.locator('#loading')).toBeHidden({ timeout: 90000 })
}

async function openSample(page: Page) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Try a sample image' }).click()
  await expect(page.locator('#export')).toBeEnabled()
}

/** Width × height from the status bar, e.g. "6,000 × 4,000 px". */
async function shownSize(page: Page): Promise<[number, number]> {
  const text = (await page.locator('#dimensions').textContent()) ?? ''
  const m = text.replace(/,/g, '').match(/(\d+) × (\d+)/)
  expect(m, `dimensions text: ${text}`).not.toBeNull()
  return [Number(m![1]), Number(m![2])]
}

async function preview(page: Page, points: [number, number][] = []) {
  // Let the last frame land before taking the picture.
  await page.waitForTimeout(400)
  const shot = await page.locator('#canvas').screenshot()
  return stats(page, shot, 'image/png', points)
}

async function exportFile(
  page: Page,
  options: { format: 'image/jpeg' | 'image/png'; size?: string },
): Promise<Buffer> {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByLabel('Format').selectOption(options.format)
  await page
    .getByLabel('Size', { exact: true })
    .selectOption(options.size ?? 'full')
  const downloadEvent = page.waitForEvent('download', { timeout: 120000 })
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  const download = await downloadEvent
  await download.saveAs(
    `test-results/exports/${test.info().project.name}-${download.suggestedFilename()}`,
  )
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  await page.getByRole('button', { name: 'Close export dialog' }).click()
  return Buffer.concat(chunks)
}

function expectSameLook(file: Stats, shown: Stats, tolerance = 24) {
  // Same shape: either side of the preview may be one pixel off after rounding.
  const ratio = file.width / file.height
  const off = Math.min(
    Math.abs(shown.width / ratio - shown.height),
    Math.abs(shown.height * ratio - shown.width),
  )
  expect(off).toBeLessThan(1.5)
  for (let k = 0; k < 3; k++)
    expect(
      Math.abs(file.mean[k]! - shown.mean[k]!),
      `channel ${k}`,
    ).toBeLessThan(tolerance)
}

const isEngine = (name: string) => test.info().project.use.browserName === name

const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  const list: string[] = []
  errors.set(page, list)
  page.on('pageerror', (e) => list.push(e.message))
})
test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([])
})

test.describe('opening photos', () => {
  test('a 24 MP photo opens and exports at full size', async ({ page }) => {
    await openFile(page, 'photo-24mp.jpg')
    expect(await shownSize(page)).toEqual([6000, 4000])
    const shown = await preview(page)
    const file = await stats(
      page,
      await exportFile(page, { format: 'image/jpeg' }),
      'image/jpeg',
    )
    expect([file.width, file.height]).toEqual([6000, 4000])
    expectSameLook(file, shown)
  })

  test('a PNG keeps its transparency', async ({ page }) => {
    await openFile(page, 'transparent.png')
    expect(await shownSize(page)).toEqual([1200, 900])
    const file = await stats(
      page,
      await exportFile(page, { format: 'image/png' }),
      'image/png',
      [
        [0.02, 0.02],
        [0.5, 0.5],
      ],
    )
    expect([file.width, file.height]).toEqual([1200, 900])
    expect(file.samples[0]![3]).toBe(0)
    expect(file.samples[1]![3]).toBe(255)
    expect(file.clear).toBeGreaterThan(0.3)
  })

  test('an iPhone-style portrait follows its EXIF rotation', async ({
    page,
  }) => {
    await openFile(page, 'portrait-exif.jpg')
    // Stored 1600 × 1200 with "rotate 90°": shown and saved upright.
    expect(await shownSize(page)).toEqual([1200, 1600])
    const corners: [number, number][] = [
      [0.95, 0.04],
      [0.04, 0.04],
    ]
    const shown = await preview(page, corners)
    const file = await stats(
      page,
      await exportFile(page, { format: 'image/jpeg' }),
      'image/jpeg',
      corners,
    )
    expect([file.width, file.height]).toEqual([1200, 1600])
    // The red corner of the stored file ends up top right after the turn.
    for (const s of [shown, file]) {
      expect(s.samples[0]![0]).toBeGreaterThan(200)
      expect(s.samples[0]![1]).toBeLessThan(60)
      expect(s.samples[1]![1]).toBeGreaterThan(60)
    }
    expectSameLook(file, shown)
  })

  test('an iPhone HEIC photo opens, edits and saves as JPEG', async ({
    page,
  }) => {
    test.skip(
      !existsSync(FIXTURES + 'iphone.heic'),
      'HEIC fixtures are made by macOS',
    )
    await openFile(page, 'iphone.heic')
    const [w, h] = await shownSize(page)
    expect(Math.max(w, h)).toBe(1600)
    await expect(page.locator('#filename')).toHaveText('iphone.heic')
    await page.getByRole('button', { name: 'Mono', exact: true }).click()
    const corner: [number, number][] = [[0.04, 0.04]]
    const shown = await preview(page, corner)
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(page.getByLabel('Format')).toHaveValue('image/jpeg')
    await page.getByRole('button', { name: 'Close export dialog' }).click()
    const file = await stats(
      page,
      await exportFile(page, { format: 'image/jpeg' }),
      'image/jpeg',
      corner,
    )
    expect([file.width, file.height]).toEqual([w, h])
    expectSameLook(file, shown)
    // Mono turns the red corner grey: same in the preview and in the file.
    expect(Math.abs(file.samples[0]![0]! - shown.samples[0]![0]!)).toBeLessThan(
      30,
    )
  })

  test('a narrow panorama exports at the social size', async ({ page }) => {
    await openFile(page, 'panorama.jpg')
    expect(await shownSize(page)).toEqual([8000, 1000])
    const shown = await preview(page)
    const file = await stats(
      page,
      await exportFile(page, { format: 'image/jpeg', size: '1080' }),
      'image/jpeg',
    )
    expect([file.width, file.height]).toEqual([1080, 135])
    expectSameLook(file, shown)
  })
})

test.describe('tools', () => {
  test('Adjust: a look changes the export like the preview', async ({
    page,
  }) => {
    await openSample(page)
    await page.getByRole('button', { name: 'Mono', exact: true }).click()
    await expect(page.locator('#saturation')).toHaveValue('-1')
    const shown = await preview(page)
    const file = await stats(
      page,
      await exportFile(page, { format: 'image/jpeg', size: '1080' }),
      'image/jpeg',
    )
    expectSameLook(file, shown)
    // Mono: no colour left in the file.
    expect(Math.abs(file.mean[0] - file.mean[2])).toBeLessThan(6)
  })

  test('Crop: a 1:1 frame exports a square', async ({ page }) => {
    await openSample(page)
    await page.getByRole('tab', { name: 'Crop' }).click()
    await page.getByRole('button', { name: /^1:1/ }).click()
    await page.getByRole('button', { name: 'Apply crop', exact: true }).click()
    const [w, h] = await shownSize(page)
    expect(w).toBe(h)
    const shown = await preview(page)
    const file = await stats(
      page,
      await exportFile(page, { format: 'image/jpeg' }),
      'image/jpeg',
    )
    expect([file.width, file.height]).toEqual([w, h])
    expectSameLook(file, shown)
  })

  test('Rotate and straighten: the export turns with the preview', async ({
    page,
  }) => {
    await openSample(page)
    const [w, h] = await shownSize(page)
    await page.getByRole('tab', { name: 'Crop' }).click()
    await page.getByRole('button', { name: 'Rotate clockwise' }).click()
    await page.locator('#straighten').fill('8')
    expect(await shownSize(page)).toEqual([h, w])
    const shown = await preview(page)
    const file = await stats(
      page,
      await exportFile(page, { format: 'image/jpeg' }),
      'image/jpeg',
    )
    expect([file.width, file.height]).toEqual([h, w])
    expectSameLook(file, shown)
  })

  test('Blur area: the hidden area is in the export', async ({ page }) => {
    await openSample(page)
    await page.getByRole('tab', { name: 'Blur area' }).click()
    await page.getByRole('button', { name: 'Pixelate', exact: true }).click()
    await page.getByRole('button', { name: 'Draw an area' }).click()
    const box = (await page.locator('#draw-overlay').boundingBox())!
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.1)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.45, {
      steps: 5,
    })
    await page.mouse.up()
    await expect(page.getByText('Area 1 · Pixelate')).toBeVisible()
    const shown = await preview(page)
    const file = await stats(
      page,
      await exportFile(page, { format: 'image/jpeg' }),
      'image/jpeg',
    )
    expectSameLook(file, shown)
  })

  test('Background: the cut-out exports as a transparent PNG', async ({
    page,
  }) => {
    await openSample(page)
    await page.getByRole('tab', { name: 'Background' }).click()
    await page.getByRole('button', { name: 'Remove background' }).click()
    await expect(page.locator('#bg-status')).toContainText(
      'Background removed',
      { timeout: 120000 },
    )
    const file = await stats(
      page,
      await exportFile(page, { format: 'image/png', size: '0.5' }),
      'image/png',
    )
    expect(file.clear).toBeGreaterThan(0.1)
    expect(file.clear).toBeLessThan(0.99)
  })

  test('Compress: a 5 MB photo fits into 500 KB, and into 100 KB by getting smaller', async ({
    page,
  }) => {
    await openFile(page, 'noisy-12mp.jpg')
    await page.getByRole('tab', { name: 'Compress' }).click()
    for (const [label, limit] of [
      ['500 KB', 500 * 1024],
      ['100 KB', 100 * 1024],
    ] as const) {
      await page.getByRole('button', { name: label, exact: true }).click()
      await page.getByRole('button', { name: 'Compress', exact: true }).click()
      await expect(page.locator('#compress-result')).toBeVisible({
        timeout: 120000,
      })
      await expect(page.locator('#compress-from')).toContainText('MB')
      const downloadEvent = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Download', exact: true }).click()
      const download = await downloadEvent
      await download.saveAs(
        `test-results/exports/${test.info().project.name}-${download.suggestedFilename()}`,
      )
      const chunks: Buffer[] = []
      for await (const chunk of await download.createReadStream())
        chunks.push(Buffer.from(chunk))
      const bytes = Buffer.concat(chunks)
      expect(bytes.length).toBeLessThanOrEqual(limit)
      // Not a sliver: the quality search keeps as much as the size allows.
      expect(bytes.length).toBeGreaterThan(limit * 0.5)
      const file = await stats(page, bytes, 'image/jpeg')
      expect(file.width / file.height).toBeCloseTo(4 / 3, 1)
    }
  })

  async function copyOutcome(page: Page) {
    await openSample(page)
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const copy = page.getByRole('button', { name: 'Copy image' })
    // Browsers without image clipboard support never show the button.
    if (!(await copy.isVisible())) return null
    await copy.click()
    const status = page.locator('#export-status')
    await expect(status).toContainText(/Copied|Use Download/, {
      timeout: 20000,
    })
    // The answer stays: nothing overwrites it with "Copying…" later on.
    await page.waitForTimeout(7000)
    return status.textContent()
  }

  test('Copy: the image goes to the clipboard', async ({ page, context }) => {
    if (isEngine('chromium'))
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const outcome = await copyOutcome(page)
    if (isEngine('chromium')) expect(outcome).toContain('Copied')
    else if (outcome) expect(outcome).toMatch(/Copied|Use Download/)
  })

  test('Copy refused: the status says what to do instead', async ({ page }) => {
    test.skip(
      !isEngine('chromium'),
      'only Chromium lets a test refuse the clipboard',
    )
    expect(await copyOutcome(page)).toContain('Use Download')
  })

  test('the photo and its edits survive a reload', async ({ page }) => {
    await openFile(page, 'portrait-exif.jpg')
    await page.getByRole('button', { name: 'Mono', exact: true }).click()
    await expect(page.locator('#save-status')).toHaveText(
      'Saved on this device',
    )
    await page.reload()
    await expect(page.locator('#export')).toBeEnabled()
    expect(await shownSize(page)).toEqual([1200, 1600])
    await expect(page.locator('#saturation')).toHaveValue('-1')
  })
})
