import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { mockApi } from './fixtures';
import { expect, test } from './test';

test('renders the Arabic RTL shell for a signed-in user, starting on the home page', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/');

  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'ar');
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(page).toHaveTitle(ar.app.name);
  // The start page is the dashboard (F15 screen 1).
  await expect(page).toHaveURL(/127\.0\.0\.1:4173\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.dashboard.title);
});

test('shows the system status on the audit log, in the business timezone', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/audit');
  await expect(page.getByText(ar.status.ok, { exact: true })).toBeVisible();
  // Latin digits in the business timezone: 10:00 UTC is 13:00 in Damascus.
  await expect(page.getByText(/1:00/).first()).toBeVisible();
});

test('offers a skip link to the page content', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/tasks');
  const skip = page.getByRole('link', { name: ar.nav.skip });
  // Hidden until it gets keyboard focus.
  await skip.focus();
  await expect(skip).toBeInViewport();
  await skip.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});
