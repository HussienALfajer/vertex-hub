import { expect, test } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  financeWithoutTwoFactor,
  mockApi,
  screenshot,
  seedIds,
  VALID_LINK_TOKEN,
} from './fixtures';

// RTL screenshots of every screen in both themes: the design review evidence.
for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test('login page', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: false });
      await page.goto('/login');
      await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /dark/ : /^$/);
      await expect(page.getByRole('img', { name: ar.app.brand }).last()).toBeVisible();
      await screenshot(page, testInfo, `login-${colorScheme}`);
    });

    test('app shell', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: true });
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: ar.nav.label });
      await expect(nav.getByRole('link', { name: ar.nav.home })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.getByText(ar.status.ok, { exact: true })).toBeVisible();
      await screenshot(page, testInfo, `shell-${colorScheme}`);
    });

    test('design system components', async ({ page }, testInfo) => {
      // Tall enough for the whole gallery: the shell's sidebar and top bar are sticky.
      await page.setViewportSize({ width: 1280, height: 2000 });
      await mockApi(page, { signedIn: true });
      await page.goto('/design-system');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.designSystem.title);
      await screenshot(page, testInfo, `design-system-${colorScheme}`);

      await page.getByRole('button', { name: ar.designSystem.openMenu }).click();
      await expect(page.getByRole('menuitem', { name: ar.designSystem.menuEdit })).toBeVisible();
      await screenshot(page, testInfo, `dropdown-${colorScheme}`);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: ar.designSystem.openDialog }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await screenshot(page, testInfo, `dialog-${colorScheme}`);
    });

    test('team directory', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockApi(page, { signedIn: true });
      await page.goto('/team');
      await expect(page.getByRole('link', { name: /ليان الأحمد/ })).toBeVisible();
      await screenshot(page, testInfo, `team-${colorScheme}`);
    });

    test('user profile (manager view)', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: true });
      await page.goto(`/team/${seedIds.layan}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('ليان الأحمد');
      await screenshot(page, testInfo, `user-profile-${colorScheme}`);
      await page.getByRole('button', { name: ar.users.profile.actions }).click();
      await expect(page.getByRole('menuitem', { name: ar.users.profile.archive })).toBeVisible();
      await screenshot(page, testInfo, `user-actions-${colorScheme}`);
    });

    test('new user and the activation link', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1200 });
      await mockApi(page, { signedIn: true });
      await page.goto('/team/new');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.users.new.title);
      await page.getByLabel(ar.users.form.name).fill('هالة ناصر');
      await page.getByLabel(ar.users.form.email).fill('hala@vertex.example');
      await page.getByRole('combobox', { name: ar.users.form.primaryDepartment }).click();
      await page.getByRole('option', { name: 'التصميم' }).click();
      await page.getByRole('checkbox', { name: ar.roles.account_manager }).click();
      await screenshot(page, testInfo, `new-user-${colorScheme}`);
      await page.getByRole('button', { name: ar.users.form.create }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await screenshot(page, testInfo, `new-user-link-${colorScheme}`);
    });

    test('departments', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await mockApi(page, { signedIn: true });
      await page.goto('/departments');
      await expect(page.getByRole('heading', { name: 'العمليات الداخلية' })).toBeVisible();
      await screenshot(page, testInfo, `departments-${colorScheme}`);
      await page.goto(`/departments/${seedIds.design}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('التصميم');
      await screenshot(page, testInfo, `department-${colorScheme}`);
    });

    test('my account', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 1100 });
      await mockApi(page, { signedIn: true });
      await page.goto('/account');
      await expect(page.getByRole('heading', { name: ar.account.twoFactor.title })).toBeVisible();
      await screenshot(page, testInfo, `account-${colorScheme}`);
    });

    test('activation', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: false });
      await page.goto(`/activate#token=${VALID_LINK_TOKEN}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.activate.title);
      await screenshot(page, testInfo, `activate-${colorScheme}`);
    });

    test('two-factor setup', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: true, me: financeWithoutTwoFactor });
      await page.goto('/setup-two-factor');
      await page.getByLabel(ar.twoFactorSetup.password).fill('my-password-123');
      await page.getByRole('button', { name: ar.twoFactorSetup.start }).click();
      await expect(page.getByRole('img', { name: ar.twoFactorSetup.qrLabel })).toBeVisible();
      await screenshot(page, testInfo, `two-factor-scan-${colorScheme}`);
      await page.getByRole('textbox', { name: ar.twoFactorSetup.code }).pressSequentially('123456');
      await expect(page.getByText('7KQ2M9XA')).toBeVisible();
      await screenshot(page, testInfo, `two-factor-codes-${colorScheme}`);
    });

    test('sign-in code step', async ({ page }, testInfo) => {
      await mockApi(page, { signedIn: false, acceptPassword: 'pw', twoFactorOnSignIn: true });
      await page.goto('/login');
      await page.getByLabel(ar.login.email).fill('sara@vertex.example');
      await page.getByLabel(ar.login.password).fill('pw');
      await page.getByRole('button', { name: ar.login.submit }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.login.twoFactor.title);
      await screenshot(page, testInfo, `login-code-${colorScheme}`);
    });

    test('audit log', async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockApi(page, { signedIn: true });
      await page.goto('/audit');
      await page.getByRole('button', { name: ar.audit.showDetails }).first().click();
      await expect(page.getByRole('cell', { name: ar.audit.fields.manager })).toBeVisible();
      await screenshot(page, testInfo, `audit-${colorScheme}`);
    });
  });
}

test('the theme toggle switches and remembers the theme', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).not.toHaveClass(/dark/);

  await page.getByRole('button', { name: ar.theme.toDark }).click();
  await expect(html).toHaveClass(/dark/);

  await page.reload();
  await expect(html).toHaveClass(/dark/);
  await page.getByRole('button', { name: ar.theme.toLight }).click();
  await expect(html).not.toHaveClass(/dark/);
});

test('phone layout opens the navigation in a sheet', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, { signedIn: true });
  await page.goto('/');
  await page.getByRole('button', { name: ar.nav.open }).click();
  const nav = page.getByRole('dialog').getByRole('navigation', { name: ar.nav.label });
  await expect(nav).toBeVisible();
  await screenshot(page, testInfo, 'shell-phone-nav');
  await nav.getByRole('link', { name: ar.nav.designSystem }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.designSystem.title);
});
