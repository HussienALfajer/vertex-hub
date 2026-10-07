import { addDays, businessDate } from '@vertex-hub/contracts';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { accountManagerMe, employeeMe, manager, mockApi, seedIds } from './fixtures';
import { expect, test } from './test';

// F13 billing on the client, project, retainer and calendar screens against the mocked API (the
// real rules are covered by apps/api/test).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

test('a manager reads a client’s balances and statement, downloads it and edits billing details', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/clients/${seedIds.jasmine}`);
  await page.getByRole('tab', { name: ar.clients.profile.tabs.invoices }).click();

  // Jasmine's one issued invoice: 600.00 USD, 200.00 paid, the rest overdue.
  const balances = page.getByRole('region', { name: ar.invoices.client.balances });
  await expect(balances).toContainText('600.00 USD');
  await expect(balances).toContainText('400.00 USD');
  // The latest invoices, drafts included.
  await expect(page.getByRole('link', { name: 'INV-2026-0001' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: ar.invoices.draftNumber })).toHaveCount(2);

  // The statement for this year in USD: the invoice, its payment and the closing balance.
  const statement = page.getByRole('table').last();
  await expect(statement).toContainText(ar.invoices.statement.opening);
  await expect(statement).toContainText('RC-2026-0001');
  await expect(
    statement.getByRole('row', { name: new RegExp(ar.invoices.statement.closing) }),
  ).toContainText('400.00 USD');
  await page.getByRole('button', { name: ar.invoices.statement.preparePdf }).click();
  await expect(page.getByRole('link', { name: ar.invoices.statement.download })).toHaveAttribute(
    'href',
    /\/api\/clients\/.+\/statement\/pdf\?currency=USD/,
  );

  await page.getByRole('button', { name: ar.invoices.client.editBilling }).click();
  const dialog = page.getByRole('dialog', { name: ar.invoices.client.billingTitle });
  await dialog.getByLabel(ar.invoices.client.billingName).fill('شركة الياسمين للمطاعم');
  await dialog.getByLabel(ar.invoices.client.billingAddress).fill('دمشق — المزة، شارع الجلاء');
  await dialog.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.invoices.client.billingSaved)).toBeVisible();
  await expect(page.getByText('شركة الياسمين للمطاعم')).toBeVisible();
  await expect(page.getByText('دمشق — المزة، شارع الجلاء')).toBeVisible();
});

test('a manager sees a project’s margin, adds and archives expenses and invoices a milestone', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/projects/${seedIds.identityProject}?tab=billing`);

  // Rule 27: invoiced 600.00, collected 200.00, expenses 100.00 (11,850 SYP) + 120.00.
  const margin = page.getByRole('region', { name: ar.invoices.billing.margin });
  await expect(margin).toContainText('600.00 USD');
  await expect(margin).toContainText('200.00 USD');
  await expect(margin).toContainText('220.00 USD');
  await expect(margin).toContainText('380.00 USD');

  // Milestones show their invoice, or "not invoiced".
  await expect(page.getByRole('row', { name: /الاستكشاف/ })).toContainText('INV-2026-0001');
  await expect(page.getByRole('row', { name: /التصميم/ })).toContainText(ar.invoices.draftNumber);

  // An expense in SYP at its own rate.
  await page.getByRole('button', { name: ar.invoices.expenses.add }).click();
  const add = page.getByRole('dialog', { name: ar.invoices.expenses.addTitle });
  await add.getByLabel(ar.invoices.expenses.description, { exact: true }).fill('تصوير المنتجات');
  await add.getByRole('combobox', { name: ar.invoices.expenses.currency }).click();
  await page.getByRole('option', { name: ar.invoices.currencies.SYP }).click();
  await add.getByLabel(ar.invoices.expenses.amount).fill('2370');
  await expect(add.getByLabel(ar.invoices.rate.label)).toHaveValue('118.5000');
  await add.getByRole('button', { name: ar.invoices.expenses.add }).click();
  await expect(page.getByText(ar.invoices.expenses.added)).toBeVisible();
  await expect(page.getByRole('row', { name: /تصوير المنتجات/ })).toContainText('20.00 USD');
  await expect(margin).toContainText('240.00 USD');

  await page
    .getByRole('button', {
      name: fill(ar.invoices.expenses.archiveOf, { name: 'خطوط مرخّصة للهوية' }),
    })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: ar.invoices.expenses.archive })
    .click();
  await expect(page.getByRole('row', { name: /خطوط مرخّصة للهوية/ })).toBeHidden();
  await expect(margin).toContainText('120.00 USD');

  // A manual draft for the next milestone, opened in the editor.
  await page
    .getByRole('button', { name: fill(ar.invoices.billing.createFor, { name: 'التنفيذ' }) })
    .click();
  await expect(page).toHaveURL(/\/invoices\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.invoices.draftTitle);
  await expect(page.getByText('1,200.00 USD').first()).toBeVisible();
});

test('a retainer’s billing lists its charges and extra work with their invoices', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/retainers/${seedIds.socialRetainer}?tab=billing`);
  // F05B: each month's charge with its kind, amount and invoice.
  const charges = page.getByRole('table').first();
  await expect(charges).toContainText(ar.invoices.draftNumber);
  await expect(charges).toContainText(ar.retainers.chargeKinds.monthly);
  const free = page.getByRole('row', { name: new RegExp(ar.invoices.billing.notInvoiced) }).first();
  await expect(free).toContainText('1,500.00 USD');
  // A manual draft for a charge no invoice bills, at the charge's amount.
  await free.getByRole('button').click();
  await expect(page).toHaveURL(/\/invoices\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.invoices.draftTitle);
  await expect(page.getByText('1,500.00 USD').first()).toBeVisible();
});

test('invoice due dates on the calendar open the invoice for invoice readers only', async ({
  page,
}) => {
  const api = await mockApi(page, { signedIn: true, me: manager });
  // Jasmine's overdue invoice was issued 25 days ago with 7 days to pay.
  const dueOn = addDays(businessDate(), -18);
  await page.goto(`/calendar?date=${dueOn}&kinds=invoice_due`);
  const chip = page.getByRole('link', { name: /INV-2026-0001/ }).first();
  await expect(chip).toContainText(ar.calendar.keyDates.invoice_due);
  await chip.click();
  await expect(page).toHaveURL(new RegExp(`/invoices/${seedIds.overdueInvoice}$`));

  api.signInAs(employeeMe);
  await page.goto(`/calendar?date=${dueOn}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(/INV-2026-0001/)).toBeHidden();
});

test('account managers read their clients’ billing and add expenses without invoicing', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto(`/clients/${seedIds.jasmine}?tab=invoices`);
  await expect(page.getByRole('region', { name: ar.invoices.client.balances })).toBeVisible();
  await expect(page.getByRole('button', { name: ar.invoices.new.action })).toBeHidden();

  await page.goto(`/projects/${seedIds.identityProject}?tab=billing`);
  await expect(page.getByRole('region', { name: ar.invoices.billing.margin })).toBeVisible();
  await expect(page.getByRole('button', { name: ar.invoices.expenses.add })).toBeVisible();
  await expect(page.getByRole('button', { name: ar.invoices.billing.create })).toBeHidden();

  // Shifa is the General Manager's client: no Invoices tab.
  await page.goto(`/clients/${seedIds.shifa}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: ar.clients.profile.tabs.invoices })).toBeHidden();
});
