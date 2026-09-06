import { test, expect } from '@playwright/test'

test('open, crop, adjust, undo, persist, export and stay private', async ({ page, context }) => {
  const errors: string[] = [], external: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1') && !req.url().startsWith('blob:') && !req.url().startsWith('data:') && !req.url().startsWith(process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1')) external.push(req.url()) })
  await page.goto('./'); await page.getByRole('button', { name: 'Try a sample image' }).click()
  await expect(page.locator('#save-status')).toHaveText('Saved on this device')
  await page.getByRole('button', { name: '⌗ Crop', exact: true }).click()
  await page.getByLabel('Aspect ratio', { exact: true }).selectOption('1')
  await page.locator('#crop-box').press('ArrowRight')
  await page.getByRole('button', { name: 'Apply crop', exact: true }).click()
  await page.getByRole('button', { name: 'Golden', exact: true }).click()
  await expect(page.locator('#exposure')).toHaveValue('0.15')
  await page.getByRole('button', { name: 'Undo last edit' }).click()
  await expect(page.locator('#exposure')).toHaveValue('0')
  await page.getByRole('button', { name: 'Redo last edit' }).click()
  await page.getByRole('button', { name: 'Rotate clockwise' }).click()
  await expect(page.locator('#dimensions')).toHaveText('1,600 × 1,600 px')
  await expect(page.locator('#save-status')).toHaveText('Saved on this device')
  await page.reload(); await expect(page.locator('#exposure')).toHaveValue('0.15')
  await expect(page.locator('#dimensions')).toHaveText('1,600 × 1,600 px')
  const second = await context.newPage(); await second.goto('./')
  await expect(second.locator('#export')).toBeEnabled()
  await page.getByRole('button', { name: 'Mono', exact: true }).click()
  await expect(page.locator('#saturation')).toHaveValue('-1')
  await expect(page.locator('#save-status')).toHaveText('Saved on this device')
  await expect(second.locator('#saturation')).toHaveValue('-1', { timeout: 15000 })
  await second.close()
  await page.getByRole('button', { name: 'Export ↗', exact: true }).click()
  await page.getByLabel('File format').selectOption('image/png')
  await page.getByLabel('Longest edge').selectOption('640')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export photo ↗', exact: true }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('Quiet hills-edited.png')
  const stream = await download.createReadStream(), chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  expect(bytes.readUInt32BE(16)).toBe(640); expect(bytes.readUInt32BE(20)).toBe(640)
  const pixels = await page.evaluate(async (base64) => {
    const blob = new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'image/png' })
    const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0)
    const values = ctx.getImageData(0, 0, 640, 640).data
    let min = 255, max = 0
    for (let i=0;i<values.length;i+=4) { min=Math.min(min,values[i]!);max=Math.max(max,values[i]!) }
    return { min, max }
  }, bytes.toString('base64'))
  expect(pixels.max - pixels.min).toBeGreaterThan(80)
  await expect(page.locator('#export-status')).toContainText('640 × 640')
  expect(errors).toEqual([]); expect(external).toEqual([])
})

test('invalid photo reports an error and a valid photo recovers', async ({ page }) => {
  await page.goto('./')
  await page.locator('#file').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') })
  await expect(page.locator('#notice')).toContainText('Unable to open photo')
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Try a sample image' }).click()
  await expect(page.locator('#export')).toBeEnabled()
})

for (const width of [360, 768, 1440]) test(`themes and layout at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await page.goto('./')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Try a sample image' }).click(); await expect(page.locator('#export')).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
