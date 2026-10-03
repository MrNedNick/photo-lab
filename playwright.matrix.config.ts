import { defineConfig } from '@playwright/test'

// Every tool on three engines at phone and desktop width. Slower than the
// default suite, so it runs on its own: npm run test:matrix
const sizes = [
  { name: 'phone', viewport: { width: 360, height: 780 } },
  { name: 'desktop', viewport: { width: 1440, height: 1000 } },
]
const engines = [
  {
    name: 'chromium',
    launchOptions: {
      args: process.env.HARDWARE_GRAPHICS
        ? []
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  { name: 'firefox', launchOptions: {} },
  { name: 'webkit', launchOptions: {} },
] as const

export default defineConfig({
  testDir: './tests/matrix',
  globalSetup: './tests/matrix/fixtures.setup.ts',
  fullyParallel: false,
  workers: 2,
  timeout: 180000,
  expect: { timeout: 30000 },
  use: {
    baseURL:
      process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173/photo-lab/',
    acceptDownloads: true,
  },
  projects: engines.flatMap((engine) =>
    sizes.map((size) => ({
      name: `${engine.name}-${size.name}`,
      use: {
        browserName: engine.name,
        viewport: size.viewport,
        launchOptions: engine.launchOptions,
      },
    })),
  ),
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1',
        url: 'http://127.0.0.1:5173/photo-lab/',
        reuseExistingServer: !process.env.CI,
      },
})
