import { expect, test } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { manager, mockApi } from './fixtures';

test('sends visitors without a session to the login page and back after signing in', async ({
  page,
}) => {
  await mockApi(page, { signedIn: false, acceptPassword: 'right-password' });
  await page.goto('/design-system');

  await expect(page).toHaveURL(/\/login\?redirect=%2Fdesign-system/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.login.title);

  await page.getByLabel(ar.login.email).fill(manager.user.email);
  await page.getByLabel(ar.login.password).fill('wrong-password');
  await page.getByRole('button', { name: ar.login.submit }).click();
  await expect(page.getByRole('alert')).toHaveText(ar.login.errors.invalid);

  await page.getByLabel(ar.login.password).fill('right-password');
  await page.getByRole('button', { name: ar.login.submit }).click();
  await expect(page).toHaveURL(/\/design-system$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.designSystem.title);
});

test('validates the form before calling the API', async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/login');
  await page.getByRole('button', { name: ar.login.submit }).click();
  await expect(page.getByText(ar.login.errors.email)).toBeVisible();
  await expect(page.getByText(ar.login.errors.password)).toBeVisible();
});

test('signs out from the user menu', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/');
  await page.getByRole('button', { name: ar.user.menu }).click();
  await page.getByRole('menuitem', { name: ar.user.signOut }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('ignores redirect targets outside the app', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/login?redirect=//evil.example');
  await expect(page).toHaveURL(/127\.0\.0\.1:4173\/$/);
});
