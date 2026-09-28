import { expect, test } from '@playwright/test';
import type { HealthResponse } from '@vertex-hub/contracts';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };

const healthy: HealthResponse = {
  status: 'ok',
  checks: { database: 'up' },
  timestamp: '2026-09-28T10:00:00.000Z',
};

test('renders the Arabic RTL shell', async ({ page }, testInfo) => {
  // The smoke test covers the SPA alone; the API is exercised by its own integration tests.
  await page.route('**/api/health', (route) => route.fulfill({ json: healthy }));

  await page.goto('/');

  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'ar');
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(page).toHaveTitle(ar.app.name);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.home.title);
  await expect(page.getByText(ar.status.ok, { exact: true })).toBeVisible();

  // Latin digits in the business timezone: 10:00 UTC is 13:00 in Damascus.
  await expect(page.getByText(/1:00/)).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath('shell-rtl.png'), fullPage: true });
});
