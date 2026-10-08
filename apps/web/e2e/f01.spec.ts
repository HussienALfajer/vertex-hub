import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { financeWithoutTwoFactor, manager, mockApi, seedIds, VALID_LINK_TOKEN } from './fixtures';
import { expect, test } from './test';

// F01 flows against the mocked API (the real rules are covered by apps/api/test).

test('activation link: set a password, then sign in', async ({ page }) => {
  await mockApi(page, { signedIn: false, acceptPassword: 'a-long-new-password' });
  await page.goto(`/activate#token=${VALID_LINK_TOKEN}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.activate.activation.title);
  // The token leaves the address bar once read.
  await expect(page).toHaveURL(/\/activate$/);

  await page.getByLabel(ar.activate.password, { exact: true }).fill('short');
  await page.getByLabel(ar.activate.confirm).fill('different');
  await page.getByRole('button', { name: ar.activate.submit }).click();
  await expect(page.getByText(ar.activate.errors.tooShort, { exact: true })).toBeVisible();

  await page.getByLabel(ar.activate.password, { exact: true }).fill('a-long-new-password');
  await page.getByLabel(ar.activate.confirm).fill('a-long-new-password');
  await page.getByRole('button', { name: ar.activate.submit }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    ar.activate.activation.doneTitle,
  );

  await page.getByRole('link', { name: ar.activate.toLogin }).click();
  await page.getByLabel(ar.login.email).fill(manager.user.email);
  await page.getByLabel(ar.login.password, { exact: true }).fill('a-long-new-password');
  await page.getByRole('button', { name: ar.login.submit }).click();
  await expect(page.getByRole('navigation', { name: ar.nav.label })).toBeVisible();
});

test('an activation link opened where someone else is signed in leads to the sign-in form', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true });
  await page.goto(`/activate#token=${VALID_LINK_TOKEN}`);
  await page.getByLabel(ar.activate.password, { exact: true }).fill('a-long-new-password');
  await page.getByLabel(ar.activate.confirm).fill('a-long-new-password');
  await page.getByRole('button', { name: ar.activate.submit }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    ar.activate.activation.doneTitle,
  );

  await page.getByRole('link', { name: ar.activate.toLogin }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel(ar.login.email)).toBeVisible();
});

test('an invalid or used link explains what to do before anything is typed', async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/activate#token=expired-token');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.activate.invalidTitle);
  await expect(page.getByLabel(ar.activate.password, { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: ar.activate.requestNew }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
});

test('a user who must use 2FA sets it up before anything else', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: financeWithoutTwoFactor });
  await page.goto('/team');
  await expect(page).toHaveURL(/\/setup-two-factor$/);
  await expect(page.getByText(ar.twoFactorSetup.requiredNotice)).toBeVisible();

  await page.getByLabel(ar.twoFactorSetup.password, { exact: true }).fill('my-password-123');
  await page.getByRole('button', { name: ar.twoFactorSetup.start }).click();
  await expect(page.getByRole('img', { name: ar.twoFactorSetup.qrLabel })).toBeVisible();

  await page.getByRole('textbox', { name: ar.twoFactorSetup.code }).pressSequentially('123456');
  await expect(page.getByText('7KQ2M9XA')).toBeVisible();
  const finish = page.getByRole('button', { name: ar.twoFactorSetup.finish });
  await expect(finish).toBeDisabled();
  await page.getByRole('checkbox', { name: ar.twoFactorSetup.confirmSaved }).click();
  await finish.click();
  // The start page: the dashboard (F15).
  await expect(page).toHaveURL(/127\.0\.0\.1:4173\/$/);
});

test('sign-in asks for the code, and a wrong code is explained', async ({ page }) => {
  await mockApi(page, {
    signedIn: false,
    acceptPassword: 'right-password',
    twoFactorOnSignIn: true,
  });
  await page.goto('/login');
  await page.getByLabel(ar.login.email).fill(manager.user.email);
  await page.getByLabel(ar.login.password, { exact: true }).fill('right-password');
  await page.getByRole('button', { name: ar.login.submit }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.login.twoFactor.title);

  await page.getByRole('textbox', { name: ar.login.twoFactor.code }).pressSequentially('000000');
  await expect(page.getByRole('alert')).toHaveText(ar.errors.auth.INVALID_CODE);

  await page.getByRole('textbox', { name: ar.login.twoFactor.code }).pressSequentially('246810');
  await expect(page.getByRole('navigation', { name: ar.nav.label })).toBeVisible();
});

test('archiving is blocked while the user manages a department, then allowed and undone', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true });
  await page.goto(`/team/${seedIds.omar}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('عمر حداد');

  const archive = async () => {
    await page.getByRole('button', { name: ar.users.profile.actions }).click();
    await page.getByRole('menuitem', { name: ar.users.profile.archive }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: ar.users.confirm.archiveAction })
      .click();
  };

  await archive();
  const dialog = page.getByRole('alertdialog');
  // The archive button is gone: the focus moves to the new title.
  await expect(
    dialog.getByRole('heading', { name: ar.users.responsibilities.title }),
  ).toBeFocused();
  await expect(dialog.getByText('إدارة قسم العمليات الداخلية')).toBeVisible();
  await dialog.getByRole('link', { name: ar.users.responsibilities.open }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('العمليات الداخلية');
  await page.getByRole('button', { name: ar.departments.detail.changeManager }).click();
  await page.getByRole('dialog').getByRole('combobox').click();
  await page.getByRole('option', { name: ar.departments.detail.noManagerOption }).click();
  await page.getByRole('dialog').getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.departments.detail.saved)).toBeVisible();

  await page.goto(`/team/${seedIds.omar}`);
  await archive();
  await expect(page.getByText(ar.users.confirm.archived)).toBeVisible();
  await expect(page.getByText(ar.users.profile.archivedNotice)).toBeVisible();
  const actions = page.getByRole('button', { name: ar.users.profile.actions });
  await expect(actions).toBeFocused();

  // Restoring opens the link dialog: it keeps the focus, then gives it back to the menu button.
  await actions.click();
  await page.getByRole('menuitem', { name: ar.users.profile.restore }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: ar.users.confirm.restoreAction })
    .click();
  const link = page.getByRole('dialog');
  await expect(link.getByRole('button', { name: ar.users.link.copy })).toBeFocused();
  await page.waitForTimeout(500);
  await expect(link.getByRole('button', { name: ar.users.link.copy })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();
});

test('a user manager creates a user and gets the activation link', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/team');
  await page.getByRole('link', { name: ar.users.newUser }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.users.new.title);

  await page.getByRole('button', { name: ar.users.form.create }).click();
  await expect(page.getByText(ar.users.form.errors.name)).toBeVisible();
  await expect(page.getByText(ar.users.form.errors.primaryDepartment)).toBeVisible();

  await page.getByLabel(ar.users.form.name).fill('هالة ناصر');
  await page.getByLabel(ar.users.form.email).fill('hala@vertex.example');
  await page.getByRole('combobox', { name: ar.users.form.primaryDepartment }).click();
  await page.getByRole('option', { name: 'التصميم' }).click();
  await page.getByRole('checkbox', { name: ar.roles.account_manager }).click();
  await page.getByRole('button', { name: ar.users.form.create }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: ar.users.link.activationTitle })).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveValue(new RegExp(`#token=${VALID_LINK_TOKEN}$`));
  // F14 email screen 7: the link was also emailed.
  await expect(dialog.getByText(ar.users.link.sentTo)).toContainText('hala@vertex.example');
});

test('the sidebar link clears the team search', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/team?search=ليان');
  await expect(page.getByRole('searchbox', { name: ar.users.search })).toHaveValue('ليان');
  await page
    .getByRole('navigation', { name: ar.nav.label })
    .getByRole('link', { name: ar.nav.team })
    .click();
  await expect(page.getByRole('searchbox', { name: ar.users.search })).toHaveValue('');
  // Give the debounced search time to act: it must not bring the old search back.
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/team$/);
});

test('the team search keeps a space typed after a pause', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/team');
  const search = page.getByRole('searchbox', { name: ar.users.search });
  await search.pressSequentially('ليان ');
  await expect(page).toHaveURL(/search=/);
  await search.pressSequentially('الأحمد');
  await expect(search).toHaveValue('ليان الأحمد');
});

test('leaving the edit form gives the focus back to its button', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto(`/team/${seedIds.omar}`);
  const edit = page.getByRole('button', { name: ar.users.profile.edit });
  await edit.click();
  await expect(page.getByLabel(ar.users.form.name)).toBeFocused();
  await page.getByRole('button', { name: ar.common.cancel }).click();
  await expect(edit).toBeFocused();
});

test('the manager picker starts from the current manager each time', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto(`/departments/${seedIds.design}`);
  const open = () =>
    page.getByRole('button', { name: ar.departments.detail.changeManager }).click();
  await open();
  const picker = page.getByRole('dialog').getByRole('combobox');
  await expect(picker).toHaveText('ليان الأحمد');
  await picker.click();
  await page.getByRole('option', { name: ar.departments.detail.noManagerOption }).click();
  await page.getByRole('dialog').getByRole('button', { name: ar.common.cancel }).click();
  await open();
  await expect(page.getByRole('dialog').getByRole('combobox')).toHaveText('ليان الأحمد');
});

test('the rename dialog starts from the saved name and gives the focus back', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto(`/departments/${seedIds.design}`);
  const rename = page.getByRole('button', { name: ar.departments.detail.rename });
  await rename.click();
  const name = page.getByRole('dialog').getByLabel(ar.departments.detail.name);
  const saved = await name.inputValue();
  await name.fill('اسم لم يُحفظ');
  await page.keyboard.press('Escape');
  await expect(rename).toBeFocused();
  await rename.click();
  await expect(page.getByRole('dialog').getByLabel(ar.departments.detail.name)).toHaveValue(saved);
});

test('the account’s 2FA dialog gives the focus back to its button', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/account');
  const regenerate = page.getByRole('button', { name: ar.account.twoFactor.regenerate });
  await regenerate.click();
  const dialog = page.getByRole('dialog', { name: ar.account.twoFactor.regenerateTitle });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(regenerate).toBeFocused();
});
