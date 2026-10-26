import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  // Every test builds its own mocked API (`mockApi(page)`), so tests run in any order. Running
  // them in parallel lets `--shard` split by test rather than by file: `screens.spec.ts` alone
  // holds half the suite.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry keeps a runner hiccup from failing CI, but a test that only passes on retry fails
  // the run: flaky tests hide real intermittent bugs.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    locale: 'ar',
    timezoneId: 'Asia/Damascus',
    // Recording a trace for every test made the suite 30% slower and kept the antivirus scanning
    // each trace file. CI records the retry of a failed test; locally pass `--trace on` to debug.
    trace: 'on-first-retry',
    // The app's service worker (F16) would answer requests before `mockApi` sees them; the specs
    // that test it allow it themselves (f16.spec.ts).
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Serves the production build; `pnpm test:e2e` from the root builds it first.
  webServer: {
    command: 'pnpm preview',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
