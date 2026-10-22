import type { MonthPending } from '@vertex-hub/contracts';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { employeeMe, financeMe, HR_NOW, manager, mockApi, seedIds } from './fixtures';
import { expect, test } from './test';

// F17 part D in the web app: the month sheet, closing and reopening a month, what holds it, and
// the Excel files, against the mocked API (the rules are covered by apps/api/test/hr-months.test.ts).

const m = ar.hr.months;

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(HR_NOW));
});

test('the General Manager reads the month, closes an ended one and reopens it', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager, leave: true });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: ar.nav.label });
  await nav.getByRole('link', { name: ar.nav.hrMonths }).click();
  await expect(page).toHaveURL(/\/hr\/months\/2026-10$/);

  // October is still running: its pending requests and items show, and it cannot close yet.
  await expect(page.locator('[data-month-status="open"]')).toBeVisible();
  await expect(page.getByTestId('month-pending-counts')).toContainText(
    fill(m.pendingCounts, { requests: '0', items: '4' }),
  );
  await expect(page.getByRole('button', { name: m.close })).toBeDisabled();
  await expect(page.getByText(m.notEnded)).toBeVisible();
  const karim = page.getByTestId('month-totals').locator(`[data-user="${seedIds.karim}"]`);
  await expect(karim).toBeVisible();
  await expect(
    page.getByTestId('month-days').locator('[data-day="2026-10-15"][data-status="absent"]'),
    "Nour's absence",
  ).toHaveCount(1);
  await expect(page.getByRole('link', { name: ar.reports.export })).toHaveAttribute(
    'href',
    '/api/hr/months/2026-10/export',
  );

  // The employee's link opens their file's Attendance tab on the same month.
  await karim.getByRole('link').click();
  await expect(page).toHaveURL(
    new RegExp(`/hr/people/${seedIds.karim}\\?tab=attendance&month=2026-10`),
  );
  await expect(page.getByRole('link', { name: ar.reports.export })).toHaveAttribute(
    'href',
    `/api/hr/employees/${seedIds.karim}/months/2026-10/export`,
  );
  await page.getByRole('link', { name: m.sheet }).click();
  await expect(page).toHaveURL(/\/hr\/months\/2026-10$/);

  // September has ended with nothing pending: it closes, and its totals freeze.
  await page.getByRole('button', { name: ar.hr.attendance.month.previous }).click();
  await expect(page).toHaveURL(/\/hr\/months\/2026-09$/);
  await page.getByRole('button', { name: m.close }).click();
  const close = page.getByRole('alertdialog');
  await close.getByRole('button', { name: m.close }).click();
  await expect(page.getByText(m.closed.split('{{')[0] ?? '').first()).toBeVisible();
  await expect(page.locator('[data-month-status="closed"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: m.totalsFrozen })).toBeVisible();

  // Reopening needs a reason (rule D4).
  await page.getByRole('button', { name: m.reopen }).click();
  const reopen = page.getByRole('dialog', { name: new RegExp(m.reopenTitle.split('{{')[0] ?? '') });
  await reopen.getByRole('button', { name: m.reopen }).click();
  await expect(reopen.getByText(m.reopenReasonRequired)).toBeVisible();
  await reopen.getByLabel(m.reopenReason).fill('تصحيح حضور يوم 30');
  await reopen.getByRole('button', { name: m.reopen }).click();
  await expect(page.locator('[data-month-status="open"]')).toBeVisible();
  await expect(page.getByText(/تصحيح حضور يوم 30/)).toBeVisible();
});

test('closing lists what still holds the month', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  const pending: MonthPending[] = [
    {
      kind: 'item',
      id: '00000000-0000-4000-8000-000000009931',
      user: { id: seedIds.karim, name: 'كريم' },
      date: '2026-09-14',
    },
  ];
  // An item raised by the closing's recompute holds the month (rule D2), as the API answers.
  await page.route('**/api/hr/months/2026-09/close', (route) =>
    route.fulfill({
      status: 409,
      json: {
        statusCode: 409,
        code: 'MONTH_HAS_PENDING',
        message: 'MONTH_HAS_PENDING',
        details: { pending },
      },
    }),
  );
  await page.goto('/hr/months/2026-09');
  await page.getByRole('button', { name: m.close }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: m.close }).click();
  const list = page.getByRole('dialog', { name: m.pendingTitle });
  await expect(list.getByTestId('month-pending')).toContainText(m.pendingKinds.item);
  await list.getByRole('link', { name: m.openPending }).click();
  await expect(page).toHaveURL(/\/hr\/items\/00000000-0000-4000-8000-000000009931$/);
});

test('Finance reads and exports the sheet without closing it', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: financeMe });
  await page.goto('/hr/months');
  await expect(page).toHaveURL(/\/hr\/months\/2026-10$/);
  await expect(page.getByTestId('month-totals')).toBeVisible();
  await expect(page.getByRole('link', { name: ar.reports.export })).toBeVisible();
  await expect(page.getByRole('button', { name: m.close })).toHaveCount(0);
});

test('an employee exports their own month and does not reach the sheet', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/me/attendance?tab=month');
  await expect(page.getByRole('link', { name: ar.reports.export })).toHaveAttribute(
    'href',
    `/api/hr/employees/${employeeMe.user.id}/months/2026-10/export`,
  );
  await expect(page.getByRole('link', { name: m.sheet })).toHaveCount(0);
  await page.goto('/hr/months/2026-10');
  await expect(page).toHaveURL(/\/$/);
});
