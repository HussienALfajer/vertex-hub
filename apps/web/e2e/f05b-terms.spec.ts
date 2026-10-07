import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { employeeMe, mockApi, PROJECTS_TODAY, seedIds } from './fixtures';
import { expect, test } from './test';

// F05B PR 2 terms flows against the mocked API (the real rules are covered by apps/api/test).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{{${key}}}`, value), text);

async function onProjectsToday(page: Page) {
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
}

const monthAmount = (month: string) => fill(ar.retainers.terms.monthAmount, { month });

test('create a retainer with a fixed term and its schedule (T3, screen 1)', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto(`/retainers/new?clientId=${seedIds.jasmine}`);
  await page.getByLabel(ar.retainers.form.name).fill('عقد ربع سنوي');
  const departments = page.getByLabel(ar.projects.form.departments);
  await departments.fill('التصميم');
  await page.getByRole('option', { name: 'التصميم' }).click();
  await page.getByRole('button', { name: ar.retainers.kinds.design, exact: true }).click();

  await page.getByRole('switch', { name: ar.retainers.terms.enable }).click();
  // A term sets the renewal date (T11).
  await expect(page.getByLabel(ar.retainers.form.renewalDate)).toBeDisabled();
  await page.getByLabel(ar.retainers.terms.agreedTotal).fill('1000');
  // The default schedule is an even split with the remainder on the last month.
  await expect(page.getByLabel(monthAmount('تشرين الأول 2026'))).toHaveValue('333.33');
  await expect(page.getByLabel(monthAmount('كانون الأول 2026'))).toHaveValue('333.34');
  await expect(page.getByText(ar.retainers.terms.balanced)).toBeVisible();

  await page.getByLabel(monthAmount('تشرين الأول 2026')).fill('300');
  await page.getByLabel(monthAmount('تشرين الثاني 2026')).fill('300');
  await expect(page.getByTestId('term-remaining')).toContainText('66.66');
  await page.getByRole('button', { name: ar.retainers.form.create }).click();
  await expect(page.getByText(ar.retainers.terms.errors.schedule)).toBeVisible();

  await page.getByLabel(monthAmount('كانون الأول 2026')).fill('400');
  await expect(page.getByText(ar.retainers.terms.balanced)).toBeVisible();
  await page.getByRole('button', { name: ar.retainers.form.create }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('عقد ربع سنوي');
  await expect(page.getByText(/المدة 1 · تشرين الأول 2026 – كانون الأول 2026/)).toBeVisible();
  await page.getByRole('tab', { name: ar.retainers.page.tabs.contract }).click();
  const card = page.getByRole('region', { name: fill(ar.retainers.terms.name, { number: '1' }) });
  await expect(card.getByText(ar.retainers.terms.statuses.active, { exact: true })).toBeVisible();
  await expect(card.getByRole('row')).toHaveCount(4);
  await expect(card.getByText(/1,000\.00/).first()).toBeVisible();
});

test('change the end action, add a term and cancel it (T5, T10, screen 3)', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto(`/retainers/${seedIds.adsRetainer}?tab=contract`);

  const active = page.getByRole('region', { name: fill(ar.retainers.terms.name, { number: '2' }) });
  await expect(active.getByText(ar.retainers.terms.statuses.active, { exact: true })).toBeVisible();
  await expect(
    active.getByText(fill(ar.retainers.terms.renewedFrom, { number: '1' })),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: ar.retainers.terms.past })).toBeVisible();

  await active.getByRole('combobox', { name: ar.retainers.terms.endAction }).click();
  await page.getByRole('option', { name: ar.retainers.terms.endActions.continue }).click();
  await expect(page.getByText(ar.retainers.terms.endActionSaved)).toBeVisible();

  await page.getByRole('button', { name: ar.retainers.terms.add }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: ar.retainers.terms.startMonth }).click();
  await page.getByRole('option', { name: 'كانون الثاني 2027' }).click();
  await dialog.getByLabel(ar.retainers.terms.months).fill('2');
  await dialog.getByLabel(ar.retainers.terms.agreedTotal).fill('80000');
  await dialog.getByRole('button', { name: ar.retainers.terms.create }).click();
  await expect(page.getByText(ar.retainers.terms.created)).toBeVisible();

  const scheduled = page.getByRole('region', {
    name: fill(ar.retainers.terms.name, { number: '3' }),
  });
  await expect(
    scheduled.getByText(ar.retainers.terms.statuses.scheduled, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: ar.retainers.terms.add })).toHaveCount(0);

  await scheduled.getByRole('button', { name: ar.retainers.terms.cancel }).click();
  const cancel = page.getByRole('dialog');
  await cancel.getByRole('button', { name: ar.retainers.terms.cancel }).click();
  await expect(cancel.getByText(ar.retainers.terms.errors.reason)).toBeVisible();
  await cancel.getByLabel(ar.retainers.terms.cancelReason).fill('العميل لم يوقّع');
  await cancel.getByRole('button', { name: ar.retainers.terms.cancel }).click();
  await expect(page.getByText(ar.retainers.terms.cancelled)).toBeVisible();
  await expect(
    page.getByText(fill(ar.retainers.terms.cancelledBecause, { reason: 'العميل لم يوقّع' })),
  ).toBeVisible();
});

test('an employee sees the term months without amounts (G3)', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto(`/retainers/${seedIds.adsRetainer}?tab=contract`);
  const active = page.getByRole('region', { name: fill(ar.retainers.terms.name, { number: '2' }) });
  await expect(active.getByText(ar.retainers.terms.endActions.renew)).toBeVisible();
  await expect(active.getByText(ar.retainers.terms.agreed)).toHaveCount(0);
  await expect(
    active.getByRole('columnheader', { name: ar.retainers.terms.columns.base }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: ar.retainers.terms.add })).toHaveCount(0);
});

test('ending a retainer with a term takes an optional termination fee (E1, E2)', async ({
  page,
}) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto(`/retainers/${seedIds.adsRetainer}`);
  await page.getByRole('button', { name: ar.projects.actions.more }).click();
  await page.getByRole('menuitem', { name: ar.retainers.actions.end }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText(fill(ar.retainers.end.termMonths, { month: 'كانون الأول 2026' })),
  ).toBeVisible();
  await dialog.getByLabel(ar.retainers.end.fee).fill('500000');
  await dialog.getByRole('button', { name: ar.retainers.actions.end }).click();
  await expect(dialog.getByText(ar.retainers.end.feeReasonRequired)).toBeVisible();
  await dialog.getByLabel(ar.retainers.end.feeReason).fill('إنهاء قبل نهاية المدة');
  await dialog.getByRole('button', { name: ar.retainers.actions.end }).click();
  await expect(page.getByText(ar.retainers.actions.done.ended).first()).toBeVisible();
  await page.getByRole('tab', { name: ar.retainers.page.tabs.contract }).click();
  await expect(page.getByText(ar.retainers.terms.cancelledOnEnd)).toBeVisible();
});
