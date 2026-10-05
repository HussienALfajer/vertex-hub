import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  accountManagerMe,
  employeeMe,
  financeMe,
  manager,
  mockApi,
  PROJECTS_TODAY,
  seedIds,
} from './fixtures';
import { expect, test } from './test';

// F14 email screens against the mocked API (the real rules are covered by apps/api/test).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

async function onToday(page: Page) {
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
}

const sendTitle = (kind: keyof typeof ar.email.kinds) =>
  fill(ar.email.send.title, { kind: ar.email.kinds[kind] });

const history = (page: Page) =>
  page.getByRole('heading', { name: ar.email.history.title }).locator('..');

test('email switches follow the catalog, save, and lock while a type is muted', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/notifications/settings');
  const column = (label: string, type: keyof typeof ar.notifications.types) =>
    page.getByRole('switch', { name: fill(label, { name: ar.notifications.types[type] }) });
  const email = (type: keyof typeof ar.notifications.types) =>
    column(ar.notifications.settings.emailLabel, type);
  const app = (type: keyof typeof ar.notifications.types) =>
    column(ar.notifications.settings.appLabel, type);

  // The scope's triggers are emailed by default (rule 2), comments are not.
  await expect(email('task_assigned')).toBeChecked();
  await expect(email('invoice_paid')).toBeChecked();
  await expect(email('task_commented')).not.toBeChecked();
  const digest = page.getByRole('switch', { name: ar.notifications.settings.digest });
  await expect(digest).toBeChecked();

  await email('task_assigned').click();
  await expect(email('task_assigned')).not.toBeChecked();
  await digest.click();
  await expect(digest).not.toBeChecked();

  // A type muted in the app creates nothing to email.
  await email('task_commented').click();
  await expect(email('task_commented')).toBeChecked();
  await app('task_commented').click();
  await expect(email('task_commented')).toBeDisabled();
  await expect(email('task_commented')).not.toBeChecked();
  await expect(page.getByText(ar.notifications.settings.emailLocked)).toBeVisible();

  await page.reload();
  await expect(email('task_assigned')).not.toBeChecked();
  await expect(digest).not.toBeChecked();
  await expect(email('task_commented')).toBeDisabled();
});

test('forgot password answers the same for any address', async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/login');
  await page.getByRole('link', { name: ar.login.forgot }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);

  await page.getByRole('button', { name: ar.forgotPassword.submit }).click();
  await expect(page.getByText(ar.login.errors.email)).toBeVisible();
  await page.getByLabel(ar.login.email).fill('nobody@vertex.example');
  await page.getByRole('button', { name: ar.forgotPassword.submit }).click();
  await expect(page.getByText(ar.forgotPassword.sentTitle)).toBeVisible();
  await page.getByRole('link', { name: ar.forgotPassword.back }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('a sent quote is emailed to contacts with an email, and shows in its history', async ({
  page,
}) => {
  await onToday(page);
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/quotes/${seedIds.sentQuote}`);
  await expect(history(page)).toContainText(ar.email.statuses.sent);

  await page.getByRole('button', { name: ar.email.send.action }).click();
  const dialog = page.getByRole('dialog', { name: sendTitle('client_quote') });
  // The only contact with an email is chosen; the other is greyed out.
  await expect(dialog.getByRole('checkbox', { name: /هالة الشامي/ })).toBeChecked();
  const samer = dialog.getByRole('checkbox', { name: /سامر العلي/ });
  await expect(samer).toBeDisabled();
  await expect(dialog.getByText(ar.email.send.noEmail)).toBeVisible();
  // Copied to the account manager by default; subject and message from the template.
  await expect(dialog.getByRole('switch', { name: /ليان الأحمد/ })).toBeChecked();
  await expect(dialog.getByLabel(ar.email.send.subject)).toHaveValue(/^عرض السعر Q-2026-0001/);
  await expect(dialog.getByLabel(ar.email.send.message)).toHaveValue(/^مرحبًا،/);
  await expect(dialog.getByText('Q-2026-0001.pdf')).toBeVisible();

  await dialog.getByLabel(ar.email.send.subject).fill('');
  await dialog.getByRole('button', { name: ar.email.send.submit }).click();
  await expect(dialog.getByText(fill(ar.email.send.errors.subject, { max: '200' }))).toBeVisible();
  await dialog.getByLabel(ar.email.send.subject).fill('عرض السعر المحدّث');
  await dialog.getByRole('button', { name: ar.email.send.submit }).click();
  await expect(page.getByText(ar.email.send.queued)).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(history(page).getByText(ar.email.statuses.queued)).toBeVisible();
});

test('finance reminds an overdue invoice; a failed email shows its error', async ({ page }) => {
  await onToday(page);
  await mockApi(page, { signedIn: true, me: financeMe });
  await page.goto(`/invoices/${seedIds.overdueInvoice}`);
  await expect(history(page)).toContainText('535 5.7.8 Authentication failed');

  await page.getByRole('button', { name: ar.invoices.email.reminder }).click();
  const dialog = page.getByRole('dialog', { name: sendTitle('client_invoice_reminder') });
  await expect(dialog.getByLabel(ar.email.send.subject)).toHaveValue(
    'تذكير: الفاتورة INV-2026-0001 متأخرة السداد',
  );
  await dialog.getByRole('button', { name: ar.email.send.submit }).click();
  await expect(page.getByText(ar.email.send.queued)).toBeVisible();
  await expect(history(page).getByText(ar.email.statuses.queued)).toBeVisible();

  // The receipt of a payment goes by email from the payments table.
  await page
    .getByRole('button', { name: fill(ar.invoices.email.receiptOf, { number: 'RC-2026-0001' }) })
    .click();
  await expect(page.getByRole('dialog', { name: sendTitle('client_receipt') })).toBeVisible();
});

test('the approval link is emailed on reissue, and reminded by email', async ({ page }) => {
  await onToday(page);
  await mockApi(page, { signedIn: true, me: accountManagerMe, approvals: true });
  await page.goto(`/approvals/requests/${seedIds.openRequest}`);

  await page.getByRole('button', { name: ar.approvals.requestPage.remindByEmail }).click();
  await expect(page.getByText(ar.email.send.queued)).toBeVisible();
  await expect(history(page)).toContainText(ar.email.kinds.client_approval_reminder);

  await page.getByRole('button', { name: ar.approvals.requestPage.reissue }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByRole('checkbox', { name: /hala@jasmine\.example/ })).toBeChecked();
  await confirm.getByRole('button', { name: ar.approvals.requestPage.reissue }).click();
  const reissued = page.getByRole('dialog');
  await expect(reissued.getByText(ar.approvals.request.emailed)).toBeVisible();
  await reissued.getByRole('button', { name: ar.approvals.request.done }).click();
  await expect(history(page)).toContainText(ar.email.kinds.client_approval_link);
});

test('administrators read the email log, filter it and send a test', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/');
  await page.getByRole('link', { name: ar.nav.emails }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.email.log.title);
  await expect(page.getByRole('row')).toHaveCount(5);

  await page.getByRole('button', { name: ar.email.statuses.failed, exact: true }).click();
  await expect(page).toHaveURL(/status=/);
  await expect(page.getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('row').nth(1)).toContainText('535 5.7.8 Authentication failed');
  await page.getByRole('button', { name: ar.email.log.clear }).click();

  await page.getByRole('button', { name: ar.email.log.test }).click();
  await expect(page.getByText(ar.email.log.testQueued)).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(6);
  await expect(page.getByRole('row').nth(1)).toContainText(ar.email.kinds.test);
});

test('the email log is for audit readers only', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/emails');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: ar.nav.emails })).toHaveCount(0);
});
