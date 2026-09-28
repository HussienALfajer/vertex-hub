import { expect, test } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { mockApi } from './fixtures';

test('renders the Arabic RTL shell for a signed-in user', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/');

  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'ar');
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(page).toHaveTitle(ar.app.name);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.home.title);
  await expect(page.getByText(ar.status.ok, { exact: true })).toBeVisible();

  // Latin digits in the business timezone: 10:00 UTC is 13:00 in Damascus.
  await expect(page.getByText(/1:00/)).toBeVisible();
});
