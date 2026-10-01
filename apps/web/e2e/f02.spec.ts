import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { accountManagerMe, employeeMe, mockApi, seedIds } from './fixtures';
import { expect, test } from './test';

// F02 flows against the mocked API (the real rules are covered by apps/api/test).

test('create a client, then add a contact with final approval', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/clients');
  await page.getByRole('link', { name: ar.clients.newClient }).click();
  // The form is filled once it is on screen: until then the list is, and its search box and
  // sector filter answer to the same labels as the form's fields.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.clients.new.title);

  await page.getByLabel(ar.clients.form.tradeName, { exact: true }).fill('مخبز السنابل');
  await page.getByLabel(ar.clients.form.sector, { exact: true }).fill('مخابز');
  const manager = page.getByRole('combobox', { name: ar.clients.form.accountManager });
  await manager.click();
  await page.getByRole('option', { name: 'ليان الأحمد' }).click();
  // The choice is made before submitting, and the create request is answered before the page
  // is expected to change (the test was flaky without both waits).
  await expect(manager).toHaveText(/ليان الأحمد/);
  await page.getByRole('switch', { name: ar.clients.form.healthcare }).click();
  const created = page.waitForResponse(
    (response) => response.url().endsWith('/api/clients') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: ar.clients.form.create }).click();
  expect((await created).status()).toBe(201);

  // The profile opens, warning that nobody can approve work yet (rule 9).
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مخبز السنابل');
  await expect(page.getByText(ar.clients.profile.noApprovalTitle)).toBeVisible();
  await expect(page.getByText(ar.clients.healthcare).first()).toBeVisible();

  await page.getByRole('button', { name: ar.clients.contacts.add }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(ar.clients.contacts.form.name).fill('منى يوسف');
  await dialog.getByLabel(ar.clients.contacts.form.phone).fill('+963 944 777 888');
  await dialog.getByRole('switch', { name: ar.clients.contacts.form.finalApproval }).click();
  await dialog.getByRole('button', { name: ar.common.save }).click();

  await expect(page.getByRole('heading', { name: 'منى يوسف' })).toBeVisible();
  await expect(page.getByText(ar.clients.contacts.finalApproval)).toBeVisible();
  await expect(page.getByText(ar.clients.profile.noApprovalTitle)).toHaveCount(0);
});

test('an employee reads the profile and logs a note, with no edit actions', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto(`/clients/${seedIds.jasmine}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مطعم الياسمين');
  await expect(page.getByRole('button', { name: ar.clients.profile.edit })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ar.clients.contacts.add })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'هالة الشامي' })).toBeVisible();

  await page.getByRole('tab', { name: ar.clients.profile.tabs.communication }).click();
  await expect(page).toHaveURL(/tab=communication/);
  await page.getByLabel(ar.clients.notes.summary).fill('اتصلت هالة لتأكيد موعد التصوير.');
  await page.getByRole('button', { name: ar.clients.notes.channels.whatsapp }).click();
  await page.getByRole('button', { name: ar.clients.notes.add }).click();

  const note = page.getByRole('article').filter({ hasText: 'اتصلت هالة لتأكيد موعد التصوير.' });
  await expect(note).toBeVisible();
  // Only the author edits a note (rule 11): the employee's own note has actions, others do not.
  await expect(note.getByRole('button', { name: ar.clients.notes.actions })).toBeVisible();
  const others = page.getByRole('article').filter({ hasText: 'طلب سامر تعديل موعد' });
  await expect(others.getByRole('button', { name: ar.clients.notes.actions })).toHaveCount(0);
});

test('an account manager edits their own client but creates none', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto('/clients');
  await expect(page.getByRole('link', { name: ar.clients.newClient })).toHaveCount(0);
  await page.getByRole('combobox', { name: ar.clients.filters.accountManager }).click();
  await expect(page.getByRole('option', { name: 'سارة الخطيب' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: ar.clients.filters.mine }).click();
  await expect(page.getByRole('link', { name: /عيادة الشفاء/ })).toHaveCount(0);
  await page.getByRole('link', { name: /مطعم الياسمين/ }).click();

  await page.getByRole('button', { name: /^الحالة:/ }).click();
  await page.getByRole('menuitem', { name: ar.clients.statuses.paused }).click();
  await expect(page.getByText(ar.clients.profile.statusChanged)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 }).locator('..')).toContainText(
    ar.clients.statuses.paused,
  );
  await expect(page.getByRole('button', { name: ar.clients.profile.actions })).toHaveCount(0);
});

test('a user who manages clients cannot be archived until they are reassigned', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true });
  const archive = async () => {
    await page.goto(`/team/${seedIds.layan}`);
    await page.getByRole('button', { name: ar.users.profile.actions }).click();
    await page.getByRole('menuitem', { name: ar.users.profile.archive }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: ar.users.confirm.archiveAction })
      .click();
  };

  await archive();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(ar.users.responsibilities.title)).toBeVisible();
  await expect(dialog.getByText('إدارة حساب العميل مطعم الياسمين')).toBeVisible();
  // An ended client does not block (rule 8).
  await expect(dialog.getByText(/متجر النخبة/)).toHaveCount(0);
  await dialog.getByRole('link', { name: ar.users.responsibilities.openClient }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مطعم الياسمين');
  await page.getByRole('button', { name: ar.clients.profile.edit }).click();
  await page.getByRole('combobox', { name: ar.clients.form.accountManager }).click();
  await page.getByRole('option', { name: 'سارة الخطيب' }).click();
  await page.getByRole('dialog').getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.clients.profile.saved)).toBeVisible();

  // Only the department she manages is left to hand over.
  await archive();
  await expect(dialog.getByText('إدارة قسم التصميم')).toBeVisible();
  await expect(dialog.getByText(/مطعم الياسمين/)).toHaveCount(0);
});

test('archive a client entered by mistake, find it under Archived, restore it', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true });
  await page.goto(`/clients/${seedIds.shifa}`);
  await page.getByRole('button', { name: ar.clients.profile.actions }).click();
  await page.getByRole('menuitem', { name: ar.clients.profile.archive }).click();
  await page.getByRole('button', { name: ar.clients.profile.confirm.archiveAction }).click();
  await expect(page.getByText(ar.clients.profile.archivedTitle)).toBeVisible();
  await expect(page.getByRole('button', { name: ar.clients.profile.edit })).toHaveCount(0);

  await page.goto('/clients');
  await expect(page.getByRole('link', { name: /عيادة الشفاء/ })).toHaveCount(0);
  await page.getByRole('button', { name: ar.clients.filters.archived }).click();
  await page.getByRole('link', { name: /عيادة الشفاء/ }).click();

  await page.getByRole('button', { name: ar.clients.profile.restore }).click();
  await page.getByRole('button', { name: ar.clients.profile.confirm.restoreAction }).click();
  await expect(page.getByText(ar.clients.profile.archivedTitle)).toHaveCount(0);
  await expect(page.getByRole('button', { name: ar.clients.profile.edit })).toBeVisible();
});

test('the audit log links client changes to the profile', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/audit');
  await page.getByRole('link', { name: 'مطعم الياسمين' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مطعم الياسمين');
});

test('form errors from the contract schema show in Arabic, never in English', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/clients/new');
  // An empty trade name fails the contract schema before any request.
  await page.getByRole('button', { name: ar.clients.form.create }).click();
  await expect(page.getByText(ar.clients.form.errors.tradeName)).toBeVisible();
  await expect(page.getByText(/Too small|expected string|Invalid input/)).toHaveCount(0);
});

test('Enter adds a typed font as a chip, without submitting the brand kit', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto(`/clients/${seedIds.jasmine}`);
  await page.getByRole('tab', { name: ar.clients.profile.tabs.brandKit }).click();
  await page.getByRole('button', { name: ar.clients.brandKit.edit }).click();
  const fonts = page.getByLabel(ar.clients.brandKit.fonts, { exact: true });
  await fonts.fill('Cairo');
  await fonts.press('Enter');
  // The form stays open, with the new chip.
  await expect(page.getByRole('heading', { name: ar.clients.brandKit.form.title })).toBeVisible();
  await expect(
    page.getByRole('button', { name: ar.common.remove.replace('{{label}}', 'Cairo') }),
  ).toBeVisible();
});
