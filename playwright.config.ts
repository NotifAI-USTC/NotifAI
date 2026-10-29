import { defineConfig, devices } from '@playwright/test'

const preview = process.env.PLAYWRIGHT_PREVIEW === 'true'
const migration = preview || process.env.PLAYWRIGHT_MIGRATION === 'true'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: migration ? '**/md3.spec.ts' : '**/*.spec.ts',
  testIgnore: migration ? [] : ['**/md3.spec.ts'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    ...(migration ? { timezoneId: 'Asia/Shanghai' } : {}),
  },
  projects: migration
    ? [{ name: 'md3', use: { ...devices['Desktop Chrome'] } }]
    : [
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
        },
        {
          name: 'mobile-chromium',
          use: { ...devices['Pixel 7'] },
        },
      ],
  webServer: {
    command: preview
      ? 'pnpm run preview --host 127.0.0.1 --port 4173'
      : 'pnpm run dev --host 127.0.0.1 --port 4173 --force',
    env: {
      VITE_USE_MOCK: migration ? 'false' : 'true',
      ...(migration ? { VITE_API_BASE_URL: '/api' } : {}),
    },
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI && !migration,
  },
})
