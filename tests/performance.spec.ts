import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test('12 MP photo remains editable during export and supports cancellation', async ({
  page,
}) => {
  await page.goto('./')
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 4000
    canvas.height = 3000
    const ctx = canvas.getContext('2d')!,
      gradient = ctx.createLinearGradient(0, 0, 4000, 3000)
    gradient.addColorStop(0, '#60998b')
    gradient.addColorStop(0.5, '#eec681')
    gradient.addColorStop(1, '#304858')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 4000, 3000)
    for (let y = 0; y < 3000; y += 120) {
      ctx.fillStyle = `rgba(240,230,200,${(y % 360) / 900})`
      ctx.fillRect(0, y, 4000, 55)
    }
    return canvas.toDataURL('image/jpeg', 0.95).split(',')[1]!
  })
  await page
    .locator('#file')
    .setInputFiles({
      name: '12mp-gradient.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(base64, 'base64'),
    })
  await expect(page.locator('#export')).toBeEnabled({ timeout: 20000 })
  await expect(page.locator('#dimensions')).toHaveText('4,000 × 3,000 px')
  const intervals = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('#exposure')!,
      times: number[] = []
    await new Promise<void>((resolve) => {
      let previous = performance.now(),
        frame = 0
      const tick = (now: number) => {
        if (frame > 5) times.push(now - previous)
        previous = now
        input.value = String(Math.sin(frame / 20))
        input.dispatchEvent(new Event('input', { bubbles: true }))
        if (++frame < 125) requestAnimationFrame(tick)
        else {
          input.dispatchEvent(new Event('change', { bubbles: true }))
          resolve()
        }
      }
      requestAnimationFrame(tick)
    })
    return times
  })
  await page.getByRole('button', { name: 'Export ↗', exact: true }).click()
  await page
    .getByRole('button', { name: 'Export photo ↗', exact: true })
    .click()
  await page.getByRole('button', { name: 'Cancel export', exact: true }).click()
  await expect(page.locator('#export-status')).toContainText('cancelled')
  const download = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Export photo ↗', exact: true })
    .click()
  const heartbeat = await page.evaluate(() => {
    let count = 0
    const timer = setInterval(() => count++, 10)
    return new Promise<number>((resolve) =>
      setTimeout(() => {
        clearInterval(timer)
        resolve(count)
      }, 250),
    )
  })
  expect(heartbeat).toBeGreaterThan(5)
  await download
  await expect(page.locator('#export-status')).toContainText('4000 × 3000')
  const timings = await page.evaluate(() =>
    Object.fromEntries(
      ['photo-open', 'photo-export'].map((name) => [
        name,
        performance.getEntriesByName(name).at(-1)?.duration,
      ]),
    ),
  )
  const result = {
    ...timings,
    framesPerSecond:
      1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length),
    p95FrameMs: [...intervals].sort((a, b) => a - b)[
      Math.floor(intervals.length * 0.95)
    ],
    browser: await page.evaluate(() => navigator.userAgent),
    rendering: process.env.HARDWARE_GRAPHICS
      ? 'Chromium default GPU backend'
      : 'Chromium SwiftShader software rendering',
    image: '4000x3000 generated JPEG',
    viewport: '1440x1000',
  }
  if (process.env.RECORD_METRICS)
    await writeFile(
      'docs/benchmark.json',
      JSON.stringify(result, null, 2) + '\n',
    )
  console.log(JSON.stringify(result))
})

test('capture the current editor for documentation', async ({ page }) => {
  test.skip(!process.env.RECORD_METRICS, 'Documentation capture only')
  await page.goto('./')
  await page.getByRole('button', { name: 'Try a sample image' }).click()
  await expect(page.locator('#export')).toBeEnabled()
  await page.screenshot({ path: 'docs/editor.png', fullPage: true })
})
