import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  accountManagerMe,
  employeeMe,
  financeMe,
  mockApi,
  PROJECTS_TODAY,
  seedIds,
} from './fixtures';
import { expect, test } from './test';

// F05B PR 3 amendment flows against the mocked API (the real rules are covered by apps/api/test).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{{${key}}}`, value), text);

async function onProjectsToday(page: Page) {
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
}

const amendmentNamed = (page: Page, number: string) =>
  page.getByTestId('amendment').filter({
    has: page.getByRole('heading', { name: fill(ar.retainers.amendments.name, { number }) }),
  });

test('the General Manager approves a reduction, then adds a one-month amount (A4, A3)', async ({
  page,
}) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto(`/retainers/${seedIds.adsRetainer}?tab=contract`);

  // The header and the list show the amendment waiting.
  await expect(page.getByText(ar.retainers.amendments.pendingBadge_one).first()).toBeVisible();
  const pending = amendmentNamed(page, '2');
  await expect(pending.getByText(ar.retainers.amendments.statuses.pending_approval)).toBeVisible();
  await pending.getByRole('button', { name: ar.retainers.amendments.approve }).click();
  await expect(page.getByText(ar.retainers.amendments.done.approve)).toBeVisible();
  await expect(pending.getByText(ar.retainers.amendments.statuses.applied)).toBeVisible();

  await page.getByRole('button', { name: ar.retainers.amendments.new }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(ar.retainers.amendments.amount).fill('100000');
  await expect(dialog.getByTestId('amendment-preview')).toContainText(/130,000\.00/);
  await expect(dialog.getByText(ar.retainers.amendments.needsApproval)).toHaveCount(0);
  await dialog.getByRole('button', { name: ar.retainers.amendments.save }).click();
  await expect(dialog.getByText(ar.retainers.amendments.errors.reason)).toBeVisible();
  await dialog.getByLabel(ar.retainers.amendments.reason).fill('حملة إضافية');
  await dialog.getByRole('button', { name: ar.retainers.amendments.save }).click();
  await expect(page.getByText(ar.retainers.amendments.saved.applied)).toBeVisible();
  await expect(amendmentNamed(page, '3')).toBeVisible();
});

test('an account manager’s reduction waits for approval (A4, screen 3)', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto(`/retainers/${seedIds.socialRetainer}?tab=contract`);
  await page.getByRole('button', { name: ar.retainers.amendments.new }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: ar.retainers.amendments.directions.decrease }).click();
  await dialog.getByLabel(ar.retainers.amendments.amount).fill('200');
  await expect(dialog.getByText(ar.retainers.amendments.needsApproval)).toBeVisible();
  await dialog.getByLabel(ar.retainers.amendments.reason).fill('تخفيض متفق عليه');
  await dialog.getByRole('button', { name: ar.retainers.amendments.submitForApproval }).click();
  await expect(page.getByText(ar.retainers.amendments.saved.pending_approval)).toBeVisible();
  const created = amendmentNamed(page, '1');
  await expect(created.getByText(ar.retainers.amendments.statuses.pending_approval)).toBeVisible();
  // Only the General Manager decides; the creator may withdraw.
  await expect(created.getByRole('button', { name: ar.retainers.amendments.approve })).toHaveCount(
    0,
  );
  await created.getByRole('button', { name: ar.retainers.amendments.withdraw }).click();
  await expect(created.getByText(ar.retainers.amendments.statuses.withdrawn)).toBeVisible();
});

test('Finance settles a pending credit outside the system (C9)', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true, me: financeMe });
  await page.goto(`/retainers/${seedIds.adsRetainer}?tab=billing`);
  await expect(page.getByText(ar.invoices.billing.creditOwed)).toBeVisible();
  await page.getByRole('button', { name: ar.invoices.billing.settle }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: ar.invoices.billing.settle }).click();
  await expect(dialog.getByText(ar.invoices.billing.settleNoteRequired)).toBeVisible();
  await dialog.getByLabel(ar.invoices.billing.settleNote).fill('أعيد نقدًا للعميل');
  await dialog.getByRole('button', { name: ar.invoices.billing.settle }).click();
  await expect(page.getByText(ar.invoices.billing.settled)).toBeVisible();
  await expect(page.getByText('أعيد نقدًا للعميل')).toBeVisible();
});

test('an employee sees amendments without amounts (G3)', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto(`/retainers/${seedIds.adsRetainer}?tab=contract`);
  await expect(amendmentNamed(page, '1')).toBeVisible();
  await expect(page.getByText(/\d\.\d\d SYP/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: ar.retainers.amendments.new })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ar.retainers.amendments.approve })).toHaveCount(0);
});
