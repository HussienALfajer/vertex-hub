import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { accountManagerMe, employeeMe, mockApi } from './fixtures';
import { expect, test } from './test';

// F04 catalog screens against the mocked API (the real rules are covered by apps/api/test).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

test('add a service, edit its price, and keep a packaged service from being archived', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: ar.nav.label })
    .getByRole('link', { name: ar.nav.catalog })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.catalog.title);
  await expect(page.getByRole('cell', { name: 'تصميم سوشال ميديا', exact: true })).toBeVisible();
  // Archived services stay out of the default list.
  await expect(page.getByText('تقرير أداء قديم')).toBeHidden();

  await page.getByRole('button', { name: ar.catalog.services.new }).click();
  const dialog = page.getByRole('dialog', { name: ar.catalog.services.addTitle });
  await dialog.getByLabel(ar.catalog.form.name, { exact: true }).fill('موقع تعريفي');
  await dialog.getByRole('combobox', { name: ar.catalog.department }).click();
  await page.getByRole('option', { name: 'التطوير' }).click();
  await dialog.getByRole('combobox', { name: ar.catalog.billing }).click();
  await page.getByRole('option', { name: ar.catalog.billings.one_off }).click();
  // A one-off service is never counted: the counted section is gone.
  await expect(dialog.getByRole('combobox', { name: ar.catalog.form.counted })).toBeHidden();
  await dialog.getByLabel(ar.catalog.form.priceUsd).fill('1200');
  await dialog.getByLabel(ar.catalog.form.revisionRounds).fill('3');
  await dialog.getByRole('button', { name: ar.common.save }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(ar.catalog.services.added)).toBeVisible();
  const row = page.getByRole('row', { name: /موقع تعريفي/ });
  await expect(row).toContainText('1,200.00');
  await expect(row).toContainText(ar.catalog.billings.one_off);

  await row
    .getByRole('button', { name: fill(ar.catalog.actions, { name: 'موقع تعريفي' }) })
    .click();
  await page.getByRole('menuitem', { name: ar.catalog.edit }).click();
  const editing = page.getByRole('dialog', { name: ar.catalog.services.editTitle });
  await editing.getByLabel(ar.catalog.form.priceUsd).fill('1500');
  await editing.getByRole('button', { name: ar.common.save }).click();
  await expect(editing).toBeHidden();
  await expect(row).toContainText('1,500.00');

  // C1: a service of an active package cannot be archived.
  const packaged = page.getByRole('row', { name: /تصميم سوشال ميديا/ });
  await packaged
    .getByRole('button', { name: fill(ar.catalog.actions, { name: 'تصميم سوشال ميديا' }) })
    .click();
  await page.getByRole('menuitem', { name: ar.catalog.archive }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: ar.catalog.archive }).click();
  await expect(page.getByRole('alertdialog')).toContainText(
    fill(ar.catalog.services.inPackages, { names: 'باقة السوشال الذهبية' }),
  );
});

test('the service dialog starts over, refuses a taken name at the field, and gives the focus back', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/catalog');
  const newButton = page.getByRole('button', { name: ar.catalog.services.new });
  await newButton.click();
  const dialog = page.getByRole('dialog', { name: ar.catalog.services.addTitle });
  const name = dialog.getByLabel(ar.catalog.form.name, { exact: true });
  await expect(name).toBeFocused();
  await name.fill('مسودة لم تُحفظ');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(newButton).toBeFocused();

  await newButton.click();
  await expect(name).toHaveValue('');
  await name.fill('تصميم سوشال ميديا');
  await dialog.getByRole('button', { name: ar.common.save }).click();
  await expect(dialog.getByRole('alert')).toHaveText(ar.errors.SERVICE_NAME_TAKEN);
  await expect(name).toBeFocused();
});

test('archiving a service returns the focus to the list once its row is gone', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/catalog');
  const menu = page.getByRole('button', { name: fill(ar.catalog.actions, { name: 'هوية بصرية' }) });
  const confirm = page.getByRole('alertdialog');

  await menu.click();
  await page.getByRole('menuitem', { name: ar.catalog.archive }).click();
  await confirm.getByRole('button', { name: ar.common.cancel }).click();
  await expect(confirm).toBeHidden();
  await expect(menu).toBeFocused();

  await menu.click();
  await page.getByRole('menuitem', { name: ar.catalog.archive }).click();
  await confirm.getByRole('button', { name: ar.catalog.archive }).click();
  await expect(confirm).toBeHidden();
  await expect(menu).toBeHidden();
  await expect(page.getByRole('tab', { name: ar.catalog.tabs.services })).toBeFocused();
});

test('build a monthly package from services', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/catalog?tab=packages');
  await expect(page.getByRole('heading', { name: 'باقة السوشال الذهبية' })).toBeVisible();
  await expect(page.getByText('12 × تصميم سوشال ميديا')).toBeVisible();

  await page.getByRole('button', { name: ar.catalog.packages.new }).click();
  const dialog = page.getByRole('dialog', { name: ar.catalog.packages.addTitle });
  await dialog.getByLabel(ar.catalog.form.name, { exact: true }).fill('باقة فضية');
  await dialog.getByLabel(ar.catalog.form.priceUsd).fill('300');
  await dialog.getByRole('combobox', { name: ar.catalog.packages.addItem }).click();
  await page.getByRole('option', { name: 'تصميم سوشال ميديا' }).click();
  await dialog.getByRole('combobox', { name: ar.catalog.packages.addItem }).click();
  await page.getByRole('option', { name: 'ريل' }).click();
  // One-off and archived services are not offered for a monthly package.
  await dialog.getByRole('combobox', { name: ar.catalog.packages.addItem }).click();
  await expect(page.getByRole('option', { name: 'هوية بصرية' })).toBeHidden();
  await expect(page.getByRole('option', { name: 'تقرير أداء قديم' })).toBeHidden();
  await page.keyboard.press('Escape');
  await dialog
    .getByLabel(fill(ar.catalog.packages.quantityOf, { name: 'تصميم سوشال ميديا' }))
    .fill('8');
  await dialog.getByRole('button', { name: ar.common.save }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(ar.catalog.packages.added)).toBeVisible();
  await expect(page.getByText('8 × تصميم سوشال ميديا · 1 × ريل')).toBeVisible();
});

test('account managers read the catalog without actions; employees do not see it', async ({
  page,
}) => {
  const api = await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto('/catalog');
  await expect(page.getByRole('cell', { name: 'تصميم سوشال ميديا', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: ar.catalog.services.new })).toBeHidden();
  await expect(
    page.getByRole('button', { name: fill(ar.catalog.actions, { name: 'ريل' }) }),
  ).toBeHidden();
  await expect(page.getByRole('combobox', { name: ar.catalog.state })).toBeHidden();

  api.signInAs(employeeMe);
  await page.goto('/catalog');
  await expect(page).not.toHaveURL(/\/catalog/);
  await expect(
    page
      .getByRole('navigation', { name: ar.nav.label })
      .getByRole('link', { name: ar.nav.catalog }),
  ).toBeHidden();
});
