import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  accountManagerMe,
  employeeMe,
  financeMe,
  manager,
  managerWithoutMoney,
  mockApi,
  seedIds,
} from './fixtures';
import { expect, test } from './test';

// F05C PR 4 legal details against the mocked API: contract settings and the client's legal fields
// (the real rules are covered by apps/api/test).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{{${key}}}`, value), text);

const articles = ar.retainers.contractSettings.articles;

test('the General Manager edits the agency details and the default articles (K12)', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/retainers');
  await page.getByRole('link', { name: ar.retainers.contractSettings.link }).click();
  await expect(
    page.getByRole('heading', { name: ar.retainers.contractSettings.title, level: 1 }),
  ).toBeVisible();

  const prefix = page.getByLabel(ar.retainers.contractSettings.fields.numberPrefix);
  await prefix.fill('vm-ct');
  await expect(
    page.getByText(fill(ar.retainers.contractSettings.nextNumber, { number: 'VM-CT-2026-001' })),
  ).toBeVisible();
  await page.getByLabel(ar.retainers.contractSettings.fields.registrationNumber).fill('CR-4521');
  await page.getByRole('button', { name: ar.retainers.contractSettings.saveDetails }).click();
  await expect(page.getByText(ar.retainers.contractSettings.saved)).toBeVisible();
  await expect(prefix).toHaveValue('VM-CT');

  // Add an article, insert a block from the menu, and move it up.
  await page.getByRole('button', { name: articles.add }).click();
  await page.getByLabel(fill(articles.titleLabel, { position: '4' })).fill('التزامات الوكالة');
  const body = page.getByLabel(fill(articles.bodyLabel, { position: '4' }));
  await body.fill('تلتزم الوكالة بتقديم الخدمات التالية:');
  await page.getByRole('button', { name: articles.insert }).nth(3).click();
  await page
    .getByRole('menuitem', { name: ar.retainers.contractSettings.placeholders.services })
    .click();
  await expect(body).toHaveValue('تلتزم الوكالة بتقديم الخدمات التالية:\n{services}');
  await page.getByRole('button', { name: fill(articles.moveUp, { position: '4' }) }).click();
  await expect(page.getByLabel(fill(articles.titleLabel, { position: '3' }))).toHaveValue(
    'التزامات الوكالة',
  );

  // An unknown placeholder is flagged on its article before saving.
  await body.fill('السيد {client} يوافق.');
  await page.getByRole('button', { name: articles.save }).click();
  await expect(page.getByText(ar.errors.UNKNOWN_PLACEHOLDER)).toBeVisible();
  await body.fill('بين {agency_name} و{client_name}.');
  await page.getByRole('button', { name: articles.save }).click();
  await expect(page.getByText(articles.saved)).toBeVisible();

  // Removing an article renumbers the rest.
  await page.getByRole('button', { name: fill(articles.remove, { position: '1' }) }).click();
  await expect(page.getByLabel(fill(articles.titleLabel, { position: '1' }))).toHaveValue(
    'نطاق الخدمات',
  );
});

test('an account manager reads the settings; Finance and employees do not reach them', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto('/settings/contracts');
  await expect(page.getByText(ar.retainers.contractSettings.readOnlyTitle)).toBeVisible();
  await expect(page.getByRole('button', { name: articles.save })).toHaveCount(0);
  await expect(page.getByRole('button', { name: articles.add })).toHaveCount(0);

  for (const me of [financeMe, employeeMe]) {
    await mockApi(page, { signedIn: true, me });
    await page.goto('/retainers');
    await expect(page.getByRole('heading', { name: ar.retainers.title, level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: ar.retainers.contractSettings.link })).toHaveCount(
      0,
    );
    await page.goto('/settings/contracts');
    await expect(page).toHaveURL('/');
  }
});

test('the contact dialog keeps the national ID to managers with money access (edge case 12)', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/clients/${seedIds.jasmine}`);
  await page.getByRole('button', { name: ar.clients.contacts.add }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(ar.clients.contacts.form.name).fill('منى يوسف');
  await dialog.getByLabel(ar.clients.contacts.form.fatherName).fill('أحمد');
  await dialog.getByLabel(ar.clients.contacts.form.nationalId).fill('01020304050');
  await dialog.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.clients.contacts.added)).toBeVisible();

  await mockApi(page, { signedIn: true, me: managerWithoutMoney });
  await page.goto(`/clients/${seedIds.jasmine}`);
  await page.getByRole('button', { name: ar.clients.contacts.add }).first().click();
  await expect(dialog.getByLabel(ar.clients.contacts.form.fatherName)).toBeVisible();
  await expect(dialog.getByLabel(ar.clients.contacts.form.nationalId)).toHaveCount(0);
});

test('the registration number sits with the billing details', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/clients/${seedIds.jasmine}?tab=invoices`);
  await page.getByRole('button', { name: ar.invoices.client.editBilling }).click();
  await page.getByLabel(ar.invoices.client.registrationNumber).fill('CR-998877');
  await page.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.invoices.client.billingSaved)).toBeVisible();
  await expect(page.getByText('CR-998877')).toBeVisible();
});
