import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  // The cross-browser matrix has its own config: npm run test:matrix
  testIgnore: '**/matrix/**',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  // CI renders on a software GPU: its first WebGL context alone takes ~2 s.
  expect: { timeout: 15000 },
  use: {
    baseURL:
      process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173/photo-lab/',
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      args: process.env.HARDWARE_GRAPHICS
        ? []
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1',
        url: 'http://127.0.0.1:5173/photo-lab/',
        reuseExistingServer: !process.env.CI,
      },
})
