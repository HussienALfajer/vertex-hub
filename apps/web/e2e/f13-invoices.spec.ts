import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { accountManagerMe, employeeMe, manager, mockApi, seedIds } from './fixtures';
import { expect, test } from './test';

// F13 invoice screens against the mocked API (the real rules are covered by apps/api/test).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

test('a manager issues a drafted invoice, records two payments and sees it paid', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: ar.nav.label })
    .getByRole('link', { name: ar.nav.invoices })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.invoices.title);
  // Managers start on the drafts to issue.
  await expect(page.getByRole('tab', { name: ar.invoices.tabs.to_issue })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page
    .getByRole('row', { name: /الهوية البصرية الجديدة/ })
    .getByRole('link', { name: ar.invoices.draftNumber })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.invoices.draftTitle);

  await page.getByRole('button', { name: ar.invoices.issue.action }).click();
  const issue = page.getByRole('dialog', { name: ar.invoices.issue.title });
  await expect(issue.getByLabel(ar.invoices.rate.label)).toHaveValue('118.5000');
  await issue.getByRole('button', { name: ar.invoices.issue.confirm }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('INV-2026-0004');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.invoices.statuses.sent);
  await expect(page.getByRole('link', { name: ar.invoices.pdf.download })).toBeVisible();

  // A partial payment in USD by bank transfer.
  await page.getByRole('button', { name: ar.invoices.payments.action }).click();
  const pay = page.getByRole('dialog', { name: ar.invoices.payments.title });
  const balanceAfter = pay
    .locator('dt', { hasText: ar.invoices.payments.balanceAfter })
    .locator('xpath=following-sibling::dd[1]');
  await pay.getByLabel(ar.invoices.payments.amount).fill('1000');
  await pay.getByRole('combobox', { name: ar.invoices.payments.method }).click();
  await page.getByRole('option', { name: ar.invoices.methods.bank_transfer }).click();
  await pay.getByLabel(ar.invoices.payments.reference).fill('بنك البركة 88001');
  await expect(balanceAfter).toContainText(/(^|[^\d,])500\.00/);
  await pay.getByRole('button', { name: ar.invoices.payments.record }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    ar.invoices.statuses.partially_paid,
  );
  await expect(page.getByText('RC-2026-0003')).toBeVisible();

  // The rest in SYP: "Pay the rest" converts the balance at the rate and settles it exactly.
  await page.getByRole('button', { name: ar.invoices.payments.action }).click();
  await pay.getByRole('combobox', { name: ar.invoices.payments.currency }).click();
  await page.getByRole('option', { name: ar.invoices.currencies.SYP }).click();
  await expect(pay.getByLabel(ar.invoices.rate.label)).toHaveValue('118.5000');
  await pay.getByRole('button', { name: ar.invoices.payments.payTheRest }).click();
  await expect(pay.getByLabel(ar.invoices.payments.amount)).toHaveValue('59250');
  await expect(balanceAfter).toContainText(/(^|[^\d,.])0\.00/);
  await pay.getByRole('combobox', { name: ar.invoices.payments.method }).click();
  await page.getByRole('option', { name: ar.invoices.methods.cash }).click();
  await pay.getByRole('button', { name: ar.invoices.payments.record }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.invoices.statuses.paid);
  await expect(page.getByRole('button', { name: ar.invoices.payments.action })).toBeHidden();

  // Paid invoices leave the Open tab for the Paid one.
  await page.goto('/invoices?tab=paid');
  await expect(page.getByRole('link', { name: 'INV-2026-0004' })).toBeVisible();
});

test('a manager drafts an invoice from billable items and a free line', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/invoices');
  await page.getByRole('button', { name: ar.invoices.new.action }).click();
  const dialog = page.getByRole('dialog', { name: ar.invoices.new.title });
  await dialog.getByRole('combobox', { name: ar.invoices.new.client }).click();
  await page.getByRole('option', { name: 'مطعم الياسمين' }).click();
  await dialog.getByRole('button', { name: ar.invoices.new.create }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.invoices.draftTitle);

  await page.getByRole('button', { name: ar.invoices.editor.addBillable }).click();
  const picker = page.getByRole('dialog', { name: ar.invoices.picker.title });
  // Milestones and months already on a draft are not offered again.
  const identity = picker.getByRole('region', { name: 'الهوية البصرية الجديدة' });
  await expect(identity.getByText('التصميم', { exact: true })).toBeHidden();
  await picker.getByRole('checkbox', { name: 'تصميم إضافي لإعلان العيد' }).check();
  // Items of another engagement than the one picked are disabled (one engagement per invoice).
  await expect(identity.getByRole('checkbox', { name: 'التنفيذ' })).toBeEnabled();
  await expect(
    picker
      .getByRole('region', { name: 'قائمة الطعام الصيفية' })
      .getByRole('checkbox', { name: 'التصميم' }),
  ).toBeDisabled();
  await picker.getByRole('button', { name: /^أضف/ }).click();
  await expect(page.getByLabel(ar.invoices.editor.description).first()).toHaveValue(
    'تصميم إضافي لإعلان العيد',
  );

  await page.getByRole('button', { name: ar.invoices.editor.addLine }).click();
  const free = page.getByRole('group', { name: fill(ar.invoices.editor.lineN, { n: '2' }) });
  await free.getByLabel(ar.invoices.editor.description).fill('طباعة');
  await free.getByLabel(ar.invoices.editor.unitPrice).fill('50');
  await expect(page.getByText('300.00 USD').last()).toBeVisible();
  await page.getByRole('button', { name: ar.invoices.editor.save }).click();
  await expect(page.getByText(ar.invoices.editor.saved)).toBeVisible();
  await expect(page.getByRole('button', { name: ar.invoices.issue.action })).toBeEnabled();
});

test('account managers read their clients’ invoices only; employees see no invoices', async ({
  page,
}) => {
  const api = await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto('/invoices');
  // No drafts to issue for readers: their first tab is the open invoices.
  await expect(page.getByRole('tab', { name: ar.invoices.tabs.to_issue })).toBeHidden();
  await expect(page.getByRole('link', { name: 'INV-2026-0001' })).toBeVisible();
  await page.getByRole('tab', { name: ar.invoices.tabs.all }).click();
  // Shifa is the General Manager's client.
  await expect(page.getByRole('link', { name: 'INV-2026-0002' })).toBeHidden();
  await expect(page.getByRole('button', { name: ar.invoices.new.action })).toBeHidden();

  await page.goto(`/invoices/${seedIds.overdueInvoice}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.invoices.statuses.overdue);
  await expect(page.getByText('RC-2026-0001')).toBeVisible();
  await expect(page.getByRole('button', { name: ar.invoices.payments.action })).toBeHidden();
  await expect(page.getByRole('button', { name: ar.invoices.void.action })).toBeHidden();

  await page.goto(`/invoices/${seedIds.paidInvoice}`);
  await expect(page.getByText(ar.invoices.notFound)).toBeVisible();

  api.signInAs(employeeMe);
  await page.goto('/');
  await expect(
    page
      .getByRole('navigation', { name: ar.nav.label })
      .getByRole('link', { name: ar.nav.invoices }),
  ).toBeHidden();
  await page.goto('/invoices');
  await expect(page).not.toHaveURL(/\/invoices/);
});
