import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  accountManagerMe,
  employeeMe,
  financeMe,
  manager,
  mockApi,
  operationsManagerMe,
  seedIds,
} from './fixtures';
import { expect, test } from './test';

// F15 dashboards and reports against the mocked API (the real rules are covered by apps/api/test).

const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

const nav = (page: Page) => page.getByRole('navigation', { name: ar.nav.label });

test('the General Manager sees every section they hold, with links to the screens behind', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.dashboard.title);
  // "Home" comes first in the navigation.
  await expect(nav(page).getByRole('link').first()).toHaveText(ar.nav.home);

  for (const name of [
    ar.dashboard.company.title,
    ar.dashboard.finance.title,
    ar.dashboard.departments.title,
    ar.dashboard.clients.title,
    ar.dashboard.work.title,
  ]) {
    await expect(section(page, name)).toBeVisible();
  }
  const company = section(page, ar.dashboard.company.title);
  await expect(company.getByText('إدارة السوشيال ميديا')).toBeVisible();
  await expect(company.getByText(ar.dashboard.company.approvalsWaiting)).toBeVisible();

  // Each department's overdue count opens those tasks in the list.
  const design = company.getByRole('row', { name: /التصميم/ });
  await design.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/tasks\/list\?.*department/);
});

test('sections fold, and the refresh asks for every number again', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: financeMe });
  await page.goto('/');
  const finance = section(page, ar.dashboard.finance.title);
  await expect(finance.getByText(ar.dashboard.finance.invoiced)).toBeVisible();

  await finance.getByRole('button', { name: ar.dashboard.finance.title }).click();
  await expect(finance.getByText(ar.dashboard.finance.invoiced)).toBeHidden();
  await finance.getByRole('button', { name: ar.dashboard.finance.title }).click();
  await expect(finance.getByText(ar.dashboard.finance.invoiced)).toBeVisible();

  const asked = page.waitForRequest('**/api/dashboard/finance');
  await page.getByRole('button', { name: ar.dashboard.refresh }).click();
  await asked;
});

test('each role sees only its own sections (rule 23)', async ({ page }) => {
  const api = await mockApi(page, { signedIn: true, me: financeMe });
  await page.goto('/');
  await expect(section(page, ar.dashboard.finance.title)).toBeVisible();
  await expect(section(page, ar.dashboard.work.title)).toBeVisible();
  await expect(section(page, ar.dashboard.company.title)).toHaveCount(0);
  await expect(section(page, ar.dashboard.departments.title)).toHaveCount(0);
  await expect(section(page, ar.dashboard.clients.title)).toHaveCount(0);

  // A department manager who is also an account manager: their department and their clients.
  api.signInAs(accountManagerMe);
  await page.reload();
  await expect(section(page, ar.dashboard.departments.title)).toBeVisible();
  await expect(section(page, ar.dashboard.clients.title)).toBeVisible();
  await expect(section(page, ar.dashboard.company.title)).toHaveCount(0);
  await expect(section(page, ar.dashboard.finance.title)).toHaveCount(0);
  // Only the department they manage: no picker.
  await expect(section(page, ar.dashboard.departments.title).getByRole('combobox')).toHaveCount(0);
  // Their clients, with a problem first.
  const clients = section(page, ar.dashboard.clients.title);
  await expect(clients.getByRole('row').nth(1)).toContainText('مطعم الياسمين');
  await expect(
    clients.getByRole('img', { name: ar.dashboard.clients.needsAttention }),
  ).toBeVisible();

  // An employee with no other role: My work only, and no Reports.
  api.signInAs(employeeMe);
  await page.reload();
  await expect(section(page, ar.dashboard.work.title)).toBeVisible();
  for (const name of [
    ar.dashboard.company.title,
    ar.dashboard.finance.title,
    ar.dashboard.departments.title,
    ar.dashboard.clients.title,
  ]) {
    await expect(section(page, name)).toHaveCount(0);
  }
  await expect(nav(page).getByRole('link', { name: ar.nav.reports })).toHaveCount(0);
});

test('the General Manager picks another department', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/');
  const departments = section(page, ar.dashboard.departments.title);
  await departments.getByRole('combobox', { name: ar.dashboard.departments.pick }).click();
  const asked = page.waitForRequest('**/api/dashboard/departments?department=design');
  await page.getByRole('option', { name: 'التصميم' }).click();
  await asked;
  await expect(
    departments.getByRole('link', { name: ar.dashboard.departments.openBoard }),
  ).toHaveAttribute('href', /department=.*design/);
});

test('Finance reads revenue by service and the overdue invoices, and exports them', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: financeMe });
  await page.goto('/');
  await nav(page).getByRole('link', { name: ar.nav.reports }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.reports.title);
  // Finance holds no `reports.read`: no productivity and no monthly client report.
  await expect(page.getByRole('heading', { name: ar.reports.productivity.title })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: ar.reports.client.title })).toHaveCount(0);

  await page.getByRole('link', { name: ar.reports.open }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.reports.revenue.title);
  await page.getByRole('tab', { name: ar.reports.revenue.byService }).click();
  const rows = page.getByRole('tabpanel').getByRole('row');
  await expect(rows.nth(1)).toContainText('تصميم سوشال ميديا');
  // "Unclassified" comes last.
  await expect(rows.last()).toContainText(ar.reports.revenue.unclassified);
  await expect(page).toHaveURL(/view=service/);

  // Last month: the export carries the period.
  await page.getByRole('combobox', { name: ar.reports.period.label }).click();
  await page.getByRole('option', { name: ar.reports.period.lastMonth }).click();
  await expect(page.getByRole('link', { name: ar.reports.export })).toHaveAttribute(
    'href',
    /\/api\/reports\/revenue\/export\?from=\d{4}-\d{2}-01&to=/,
  );

  // A custom period over 366 days is refused before asking the API.
  await page.getByRole('combobox', { name: ar.reports.period.label }).click();
  await page.getByRole('option', { name: ar.reports.period.custom }).click();
  await page.getByLabel(ar.reports.period.from).fill('2024-01-01');
  await expect(page.getByText(/ألا تزيد الفترة على 366 يومًا/)).toBeVisible();
  await expect(page.getByRole('button', { name: ar.reports.export })).toBeDisabled();

  await page.goto('/reports/overdue-invoices');
  const row = page.getByRole('row', { name: /مطعم الياسمين/ });
  await expect(row.getByText(ar.reports.overdue.buckets['1_30'])).toBeVisible();
  await expect(page.getByRole('link', { name: ar.reports.export })).toHaveAttribute(
    'href',
    '/api/reports/overdue-invoices/export',
  );
  await row.getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/invoices/${seedIds.overdueInvoice}$`));
});

test('the Operations manager opens department productivity for last month', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: operationsManagerMe });
  await page.goto('/reports');
  await page.goto('/reports/productivity');
  await page.getByRole('combobox', { name: ar.reports.period.label }).click();
  await page.getByRole('option', { name: ar.reports.period.lastMonth }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-01/);
  await expect(page.getByRole('row', { name: /التصميم/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: ar.reports.export })).toHaveAttribute(
    'href',
    /\/api\/reports\/productivity\/export\?from=/,
  );
});

test('the account manager writes the month summary and downloads the PDF', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto(`/clients/${seedIds.jasmine}`);
  await page.getByRole('link', { name: ar.clients.profile.monthlyReport }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    ar.reports.client.pageTitle.replace('{{name}}', 'مطعم الياسمين'),
  );
  // Last month by default: not preliminary.
  await expect(page.getByText(ar.reports.client.preliminary)).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: ar.reports.client.sections.retainers }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: ar.reports.client.sections.campaigns }),
  ).toBeVisible();

  const summary = page.getByLabel(ar.reports.client.sections.summary);
  await summary.fill('شهر قوي: أطلقنا حملة منيو الخريف.');
  await page.getByRole('button', { name: ar.reports.client.saveSummary }).click();
  await expect(page.getByText(ar.reports.client.summarySaved)).toBeVisible();
  await expect(page.getByText(/آخر تعديل: ليان الأحمد/)).toBeVisible();

  await page.getByRole('button', { name: ar.reports.client.preparePdf }).click();
  await expect(page.getByRole('link', { name: ar.reports.client.downloadPdf })).toHaveAttribute(
    'href',
    new RegExp(`/api/clients/${seedIds.jasmine}/monthly-report/pdf\\?month=`),
  );

  // The current month is preliminary; the next one cannot be opened.
  await page.getByRole('button', { name: ar.reports.client.nextMonth }).click();
  await expect(page.getByText(ar.reports.client.preliminary)).toBeVisible();
  await expect(page.getByRole('button', { name: ar.reports.client.nextMonth })).toBeDisabled();
});

test('a client with no activity says so', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/clients/${seedIds.shifa}/report`);
  await expect(page.getByText(ar.reports.client.noActivity)).toBeVisible();
});

test('an invoice manager sets a line service on an issued invoice', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/invoices/${seedIds.overdueInvoice}`);
  const lines = page.getByRole('table').first();
  await expect(lines.getByRole('columnheader', { name: ar.invoices.editor.service })).toBeVisible();

  await page.getByRole('button', { name: ar.invoices.services.action }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: ar.invoices.editor.service }).first().click();
  await page.getByRole('option', { name: 'هوية بصرية' }).click();
  await dialog.getByRole('button', { name: ar.invoices.services.confirm }).click();
  await expect(page.getByText(ar.invoices.services.done)).toBeVisible();
  await expect(lines.getByText('هوية بصرية')).toBeVisible();
});

test('the draft editor offers a service per line and an employee has no Services action', async ({
  page,
}) => {
  const api = await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/invoices/${seedIds.designDraft}`);
  await expect(page.getByRole('combobox', { name: ar.invoices.editor.service })).toHaveText(
    ar.invoices.editor.noService,
  );

  api.signInAs(accountManagerMe);
  await page.goto(`/invoices/${seedIds.overdueInvoice}`);
  await expect(page.getByRole('button', { name: ar.invoices.services.action })).toHaveCount(0);
});
