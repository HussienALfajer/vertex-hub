import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  departmentManagerMe,
  employeeMe,
  financeMe,
  HR_NOW,
  manager,
  mockApi,
  seedIds,
} from './fixtures';
import { expect, test } from './test';

// F17 part B in the web app: My attendance (balances, requests and the request dialog), the
// employee file's Leave tab, Approvals with the decision and the opinions, "On leave" on the
// calendar and the leave warning on a task, against the mocked API (the rules themselves are
// covered by apps/api/test/hr-leave.test.ts).

const h = ar.hr;
const r = h.requests;

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(HR_NOW));
});

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function openRequestDialog(page: Page) {
  await page.getByRole('button', { name: r.new.title }).first().click();
  const dialog = page.getByRole('dialog', { name: r.new.title });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('an employee sees their balances and asks for annual leave with its preview', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: employeeMe, leave: true });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: ar.nav.label });
  await nav.getByRole('link', { name: ar.nav.myAttendance }).click();
  await expect(page).toHaveURL(/\/me\/attendance$/);
  await expect(page.getByRole('heading', { level: 1, name: h.attendance.title })).toBeVisible();
  // No HR section for an employee without HR access.
  await expect(nav.getByRole('link', { name: ar.nav.hr })).toHaveCount(0);
  // The page opens on Today; the balances have their own tab.
  await page.getByRole('tab', { name: h.attendance.tabs.balances }).click();

  // Annual: 9 accrued, 2 taken, 2 pending: 5 available.
  const annual = page.locator('[data-leave-type="annual"]');
  await expect(annual.getByText('5', { exact: true })).toBeVisible();
  await expect(annual.getByText(h.balances.parts.pending)).toBeVisible();
  await page.getByRole('button', { name: /حركات الرصيد/ }).click();
  await expect(page.getByRole('cell', { name: h.balances.entries.taken })).toBeVisible();

  // More days than the balance: the preview says why before submitting.
  const dialog = await openRequestDialog(page);
  await dialog.getByLabel(r.fields.startsOn, { exact: true }).fill('2026-11-01');
  await dialog.getByLabel(r.fields.endsOn, { exact: true }).fill('2026-11-07');
  await expect(dialog.getByText(ar.errors.INSUFFICIENT_BALANCE)).toBeVisible();
  await dialog.getByLabel(r.fields.endsOn, { exact: true }).fill('2026-11-03');
  await expect(dialog.getByTestId('request-preview')).toContainText(
    fill(r.days_few, { days: '3' }),
  );
  await dialog.getByRole('button', { name: r.new.submit }).click();
  await expect(page.getByText(r.new.submitted)).toBeVisible();

  await page.getByRole('tab', { name: h.attendance.tabs.requests }).click();
  await expect(page).toHaveURL(/tab=requests/);
  const rows = page.locator('[data-request-id]');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText(r.statuses.pending);
  await expect(rows.first()).toContainText(fill(r.days_few, { days: '3' }));
});

test('a sick leave needs a reason, then opens its page for the certificate', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe, leave: true });
  await page.goto('/me/attendance');
  const dialog = await openRequestDialog(page);
  await choose(page, r.fields.leaveType, h.leaveTypes.sick);
  await dialog.getByLabel(r.fields.startsOn, { exact: true }).fill('2026-10-18');
  await dialog.getByLabel(r.fields.endsOn, { exact: true }).fill('2026-10-20');
  await expect(dialog.getByText(r.warnings.certificate_required)).toBeVisible();
  await dialog.getByRole('button', { name: r.new.submit }).click();
  await expect(dialog.getByText(r.errors.reason)).toBeVisible();
  await dialog.getByLabel(r.fields.reason).fill('التهاب حاد');
  await dialog.getByRole('button', { name: r.new.submit }).click();

  await expect(page).toHaveURL(/\/hr\/requests\/.+from=mine/);
  await expect(page.getByRole('heading', { level: 1, name: h.leaveTypes.sick })).toBeVisible();
  await expect(page.getByText(r.certificateHint)).toBeVisible();
  await expect(page.getByRole('button', { name: ar.files.documents.upload })).toBeVisible();
  // The employee cancels a pending request; no decision for them.
  await expect(page.getByRole('button', { name: r.decide.approve })).toHaveCount(0);
  await page.getByRole('button', { name: r.cancel.action }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: r.cancel.action }).click();
  await expect(page.getByText(r.cancel.done)).toBeVisible();
  await expect(page.getByText(r.statuses.cancelled)).toBeVisible();
});

test('a permission takes its window and a reason', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe, leave: true });
  await page.goto('/me/attendance');
  const dialog = await openRequestDialog(page);
  await dialog.getByRole('button', { name: r.kinds.permission }).click();
  await dialog.getByLabel(r.fields.date).fill('2026-10-22');
  await dialog.getByLabel(r.fields.fromTime).fill('10:00');
  await dialog.getByLabel(r.fields.toTime).fill('11:30');
  await dialog.getByLabel(r.fields.reason).fill('موعد طبيب');
  await expect(dialog.getByText(r.preview.ok.permission)).toBeVisible();
  await dialog.getByRole('button', { name: r.new.submit }).click();
  await expect(page.getByText(r.new.submitted)).toBeVisible();
});

test('the General Manager decides requests oldest first, with the employee’s work', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager, leave: true });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: ar.nav.label });
  await nav.getByRole('link', { name: ar.nav.hrApprovals }).click();
  await expect(page).toHaveURL(/\/hr\/approvals$/);
  const rows = page.locator('[data-request-id]');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('باسل يوسف');
  await expect(rows.first()).toContainText(r.certificateMissing);

  // A sick leave without its certificate asks for a confirmation.
  await rows.first().getByRole('link').click();
  await expect(page).toHaveURL(/from=approvals/);
  await page.getByRole('button', { name: r.decide.approve }).click();
  const decision = page.getByRole('dialog', { name: r.decide.approveTitle });
  await decision.getByRole('button', { name: r.decide.approve }).click();
  await expect(decision.getByText(r.decide.confirmCertificate)).toBeVisible();
  await decision.getByRole('checkbox', { name: r.decide.withoutCertificate }).click();
  await decision.getByRole('button', { name: r.decide.approve }).click();
  await expect(page.getByText(r.decide.approved)).toBeVisible();
  await expect(page.getByText(r.statuses.approved)).toBeVisible();

  // Karim's leave: his work in those days, then a rejection needs its reason.
  await page.getByRole('link', { name: r.back.approvals }).click();
  await expect(rows).toHaveCount(2);
  await rows.filter({ hasText: 'كريم الزين' }).getByRole('link').click();
  await expect(page.getByText(r.work.title)).toBeVisible();
  await expect(page.getByRole('link', { name: 'تعديل صور قائمة الطعام' })).toBeVisible();
  await page.getByRole('button', { name: r.decide.reject }).click();
  const rejection = page.getByRole('dialog', { name: r.decide.rejectTitle });
  await rejection.getByRole('button', { name: r.decide.reject }).click();
  await expect(rejection.getByText(r.decide.noteRequired)).toBeVisible();
  await rejection.getByLabel(r.decide.note).fill('ضغط تسليمات في هذا الأسبوع');
  await rejection.getByRole('button', { name: r.decide.reject }).click();
  await expect(page.getByText(r.decide.rejected)).toBeVisible();
  await expect(page.locator('dd', { hasText: 'ضغط تسليمات في هذا الأسبوع' })).toBeVisible();
});

test('a department manager gives an opinion on their members’ requests only', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: departmentManagerMe, leave: true });
  await page.goto('/hr');
  await expect(page).toHaveURL(/\/hr\/approvals$/);
  const rows = page.locator('[data-request-id]');
  // Basel's own and Layan's (Design); Karim (Photography) is out of scope.
  await expect(rows).toHaveCount(2);
  await expect(page.getByText('كريم الزين')).toHaveCount(0);
  await rows.filter({ hasText: 'ليان الأحمد' }).getByRole('link').click();
  await expect(page.getByRole('button', { name: r.decide.approve })).toHaveCount(0);
  await page.getByLabel(r.opinions.label).fill('أوافق، التسليمات مغطاة.');
  await page.getByRole('button', { name: r.opinions.add }).click();
  await expect(page.getByText(r.opinions.added)).toBeVisible();
  await expect(page.getByText('أوافق، التسليمات مغطاة.')).toBeVisible();
});

test('the Leave tab of a file: adjust the balance and record leave approved at once', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager, leave: true });
  await page.goto(`/hr/people/${seedIds.karim}?tab=leave`);
  await expect(page.getByRole('tab', { name: h.file.tabs.leave })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const annual = page.locator('[data-leave-type="annual"]');
  await expect(annual.getByText('5', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: h.balances.adjust }).click();
  const adjust = page.getByRole('dialog', { name: fill(h.balances.adjustTitle, { year: '2026' }) });
  await adjust.getByRole('button', { name: h.balances.entries.opening }).click();
  await adjust.getByLabel(h.balances.fields.days).fill('0');
  await adjust.getByRole('button', { name: ar.common.save }).click();
  await expect(adjust.getByText(h.balances.errors.days)).toBeVisible();
  await adjust.getByLabel(h.balances.fields.days).fill('2.5');
  await adjust.getByLabel(h.balances.fields.note).fill('رصيد 2025 غير المستخدم');
  await adjust.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(h.balances.adjusted)).toBeVisible();
  await expect(annual.getByText('7.5', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: r.new.record }).click();
  const record = page.getByRole('dialog', {
    name: fill(r.new.recordTitle, { name: 'كريم الزين' }),
  });
  await record.getByLabel(r.fields.startsOn, { exact: true }).fill('2026-10-21');
  await record.getByLabel(r.fields.endsOn, { exact: true }).fill('2026-10-21');
  await record.getByRole('button', { name: r.halves.second_half }).click();
  await record.getByRole('button', { name: r.new.record }).click();
  await expect(page.getByText(r.new.recorded)).toBeVisible();
  await expect(annual.getByText('7', { exact: true })).toBeVisible();
  await expect(page.locator('[data-request-id]').first()).toContainText(r.statuses.approved);
});

test('approved leave shows on the calendar, and a task due then warns', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager, leave: true });
  await page.goto('/calendar?view=week&date=2026-10-25');
  await expect(page.locator('[data-leave-id]').first()).toContainText(
    fill(ar.calendar.leave, { name: 'كريم الزين' }),
  );

  await page.goto(`/tasks/${seedIds.dishShoot}`);
  await page.getByRole('button', { name: ar.tasks.actions.more }).click();
  await page.getByRole('menuitem', { name: ar.tasks.actions.edit }).click();
  const edit = page.getByRole('dialog', { name: ar.tasks.edit.title });
  await edit.getByLabel(ar.tasks.form.dueDate).fill('2026-10-26');
  await edit.getByRole('button', { name: ar.common.save }).click();
  const warning = page.getByRole('alertdialog', { name: ar.tasks.leaveWarning.title });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: ar.tasks.leaveWarning.action }).click();
  await expect(page.getByText(ar.tasks.edit.saved)).toBeVisible();
});

test('a reader without HR access sees who is on leave, never the type', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: financeMe, leave: true });
  await page.goto('/calendar?view=week&date=2026-10-25');
  const chip = page.locator('[data-leave-id]').first();
  await expect(chip).toContainText(fill(ar.calendar.leave, { name: 'كريم الزين' }));
  await expect(chip).not.toContainText(h.leaveTypes.annual);
});

test('a new task for someone on leave that day asks before assigning', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager, leave: true });
  await page.goto('/tasks/new?department=photography');
  await page.getByLabel(ar.tasks.form.title).fill('تصوير قائمة الشتاء');
  await page.getByLabel(ar.tasks.form.dueDate).fill('2026-10-25');
  await page.getByRole('combobox', { name: ar.tasks.form.assignee }).click();
  await page.getByRole('option', { name: 'كريم الزين' }).click();
  await page.getByRole('button', { name: ar.tasks.form.create }).click();
  const warning = page.getByRole('alertdialog', { name: ar.tasks.leaveWarning.title });
  await warning.getByRole('button', { name: ar.tasks.leaveWarning.action }).click();
  // Created once and opened, without the unsaved-changes question.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('تصوير قائمة الشتاء');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
