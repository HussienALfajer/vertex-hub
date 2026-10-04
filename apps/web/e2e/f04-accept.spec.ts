import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { accountManagerMe, manager, mockApi, seedIds } from './fixtures';
import { expect, test } from './test';

// F04 acceptance (A01) against the mocked API (the real rules are covered by apps/api/test).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

test('a quote with both sections is built, sent and accepted, landing on the new project', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/quotes');
  await page.getByRole('button', { name: ar.quotes.new.action }).click();
  const create = page.getByRole('dialog', { name: ar.quotes.new.title });
  await create.getByRole('combobox', { name: ar.quotes.form.client }).click();
  await page.getByRole('option', { name: 'مطعم الياسمين' }).click();
  await create.getByLabel(ar.quotes.form.title, { exact: true }).fill('إطلاق الفرع الجديد');
  await create.getByRole('button', { name: ar.quotes.new.create }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('إطلاق الفرع الجديد');

  await page.getByRole('combobox', { name: ar.quotes.builder.addService }).first().click();
  await page.getByRole('option', { name: 'هوية بصرية' }).click();
  await page.getByRole('combobox', { name: ar.quotes.builder.addPackage }).click();
  await page.getByRole('option', { name: 'باقة السوشال الذهبية' }).click();
  await page.getByRole('button', { name: ar.quotes.installments.add }).click();
  await page.getByLabel(fill(ar.quotes.installments.name, { n: '1' })).fill('البداية');
  await page.getByLabel(fill(ar.quotes.installments.percent, { n: '1' })).fill('50');
  await page.getByRole('button', { name: ar.quotes.installments.add }).click();
  await page.getByLabel(fill(ar.quotes.installments.name, { n: '2' })).fill('التسليم');
  await page.getByLabel(ar.quotes.builder.termMonths).fill('6');
  await page.getByRole('button', { name: ar.quotes.builder.save }).click();
  await expect(page.getByText(ar.quotes.builder.saved)).toBeVisible();
  await page.getByRole('button', { name: ar.quotes.send.action, exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: ar.quotes.send.confirm }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.quotes.statuses.sent);

  await page.getByRole('button', { name: ar.quotes.accept.action }).click();
  const accept = page.getByRole('dialog', {
    name: fill(ar.quotes.accept.title, { number: 'Q-2026-0006' }),
  });
  await expect(accept.getByText(ar.quotes.accept.steps.response, { exact: true })).toBeVisible();
  await accept.getByRole('button', { name: ar.common.next }).click();

  // The one-off section: the template is ticked, its stages are the milestones (A3).
  await expect(accept.getByLabel(ar.projects.form.name)).toHaveValue('إطلاق الفرع الجديد');
  await expect(accept.getByRole('checkbox', { name: /موقع إلكتروني/ })).toBeChecked();
  await expect(
    accept.getByRole('combobox', {
      name: fill(ar.quotes.accept.project.milestoneOf, { name: 'البداية' }),
    }),
  ).toHaveText('الاستكشاف');
  await accept.getByRole('button', { name: ar.common.next }).click();

  // The monthly section: a new retainer with the counted lines, merged (A6).
  await expect(accept.getByLabel(ar.retainers.form.name)).toHaveValue('إطلاق الفرع الجديد');
  await expect(
    accept.getByText(fill(ar.quotes.accept.retainer.perMonth, { n: '12' })),
  ).toBeVisible();
  await expect(
    accept.getByText(fill(ar.quotes.accept.retainer.perMonth, { n: '4' })),
  ).toBeVisible();
  await accept.getByRole('button', { name: ar.common.next }).click();

  await expect(
    accept.getByText(fill(ar.quotes.accept.summary.project, { name: 'إطلاق الفرع الجديد' })),
  ).toBeVisible();
  await accept.getByRole('button', { name: ar.quotes.accept.submit }).click();
  await expect(page.getByText(ar.quotes.accept.done)).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('إطلاق الفرع الجديد');
  // Screen 8: the project names the quote it came from.
  await page.getByRole('link', { name: 'Q-2026-0006' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.quotes.statuses.accepted);
});

test('unticking the template makes the installments the milestones; renew keeps the retainer', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto(`/quotes/${seedIds.sentQuote}`);
  await page.getByRole('button', { name: ar.quotes.accept.action }).click();
  const accept = page.getByRole('dialog', {
    name: fill(ar.quotes.accept.title, { number: 'Q-2026-0001' }),
  });
  await accept.getByRole('button', { name: ar.common.next }).click();

  await accept.getByRole('checkbox', { name: /موقع إلكتروني/ }).click();
  const milestoneOfStart = accept.getByRole('combobox', {
    name: fill(ar.quotes.accept.project.milestoneOf, { name: 'البداية' }),
  });
  await expect(milestoneOfStart).toHaveText('البداية');
  await accept.getByRole('button', { name: ar.common.next }).click();

  await accept.getByRole('button', { name: ar.quotes.accept.retainer.modes.renew }).click();
  // A retainer must be chosen before leaving the step.
  await accept.getByRole('button', { name: ar.common.next }).click();
  await expect(accept.getByText(ar.quotes.accept.errors.retainer)).toBeVisible();
  await accept.getByRole('combobox', { name: ar.quotes.accept.retainer.renewed }).click();
  await page.getByRole('option', { name: 'إدارة السوشيال ميديا' }).click();
  await expect(accept.getByText(ar.quotes.accept.retainer.renewTitle)).toBeVisible();
  await accept.getByRole('button', { name: ar.common.next }).click();

  await expect(
    accept.getByText(fill(ar.quotes.accept.summary.renew, { name: 'إدارة السوشيال ميديا' })),
  ).toBeVisible();
  await accept.getByRole('button', { name: ar.quotes.accept.submit }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);

  await page.goto(`/retainers/${seedIds.socialRetainer}`);
  await expect(page.getByRole('link', { name: 'Q-2026-0001' })).toBeVisible();
});

test('a failed acceptance keeps the dialog and its inputs (A9)', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.route('**/api/quotes/*/accept', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        statusCode: 409,
        code: 'TEMPLATE_ARCHIVED',
        message: 'TEMPLATE_ARCHIVED',
      }),
    }),
  );
  await page.goto(`/quotes/${seedIds.sentQuote}`);
  await page.getByRole('button', { name: ar.quotes.accept.action }).click();
  const accept = page.getByRole('dialog', {
    name: fill(ar.quotes.accept.title, { number: 'Q-2026-0001' }),
  });
  await accept.getByLabel(ar.quotes.response.note).fill('وافق العميل هاتفيًا');
  await accept.getByRole('button', { name: ar.common.next }).click();
  await accept.getByRole('button', { name: ar.common.next }).click();
  await accept.getByRole('button', { name: ar.common.next }).click();
  await accept.getByRole('button', { name: ar.quotes.accept.submit }).click();
  await expect(accept.getByRole('alert')).toHaveText(ar.errors.TEMPLATE_ARCHIVED);
  await accept.getByRole('button', { name: ar.common.previous }).click();
  await accept.getByRole('button', { name: ar.common.previous }).click();
  await accept.getByRole('button', { name: ar.common.previous }).click();
  await expect(accept.getByLabel(ar.quotes.response.note)).toHaveValue('وافق العميل هاتفيًا');
});

test('a retainer line takes its own revision limit', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/retainers/${seedIds.socialRetainer}`);
  await page.getByRole('button', { name: ar.retainers.actions.editLines }).click();
  const dialog = page.getByRole('dialog', { name: ar.retainers.lines.editTitle });
  const first = dialog.getByLabel(fill(ar.retainers.lines.revisionLimit, { position: '1' }));
  await expect(first).toHaveValue('');
  await first.fill('3');
  await dialog.getByRole('button', { name: ar.common.save }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: ar.retainers.actions.editLines }).click();
  await expect(first).toHaveValue('3');
});
