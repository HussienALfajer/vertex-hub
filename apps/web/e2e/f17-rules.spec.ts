import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  employeeMe,
  financeMe,
  HR_NOW,
  manager,
  mockApi,
  operationsManagerMe,
  PROJECTS_TODAY,
  seedIds,
} from './fixtures';
import { expect, test } from './test';

// F17 part B in the web app: HR settings (rules, schedules, holidays), holidays on the calendar,
// the schedule of a file and the post task due date that skips holidays, against the mocked API
// (the rules themselves are covered by apps/api/test/hr-rules.test.ts).

const h = ar.hr;
const s = h.settings;

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

async function openSettings(page: Page) {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: ar.nav.label });
  await nav.getByRole('link', { name: ar.nav.hrSettings }).click();
  await expect(page).toHaveURL(/\/hr\/settings$/);
  await expect(page.getByRole('heading', { level: 1, name: s.title })).toBeVisible();
}

test.describe('HR settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date(HR_NOW));
  });

  test('the General Manager sets the rules: grace, tiers in order, leave policy', async ({
    page,
  }) => {
    await mockApi(page, { signedIn: true, me: manager });
    await openSettings(page);

    const grace = page.getByLabel(s.fields.graceMinutes);
    await expect(grace).toHaveValue('10');
    await grace.fill('');
    await page.getByRole('button', { name: s.save }).click();
    await expect(page.getByText(s.errors.number)).toBeVisible();
    await grace.fill('١٥');

    // A new tier goes before the open one; a limit under the previous one is refused.
    await page.getByRole('button', { name: s.addTier }).click();
    const limits = page.getByLabel(s.tierUpTo);
    await expect(limits).toHaveCount(4);
    await limits.nth(2).fill('45');
    await page.getByRole('button', { name: s.save }).click();
    await expect(page.getByText(s.errors.tiers)).toBeVisible();
    await limits.nth(2).fill('90');
    await page.getByLabel(s.fields.carryOverMaxDays).fill('7.5');
    await page.getByRole('button', { name: s.save }).click();
    await expect(page.getByText(s.saved)).toBeVisible();
    await expect(page.getByText(s.errors.tiers)).toBeHidden();

    await page.reload();
    await expect(page.getByLabel(s.fields.graceMinutes)).toHaveValue('15');
    await expect(page.getByLabel(s.tierUpTo).nth(2)).toHaveValue('90');
    await expect(page.getByLabel(s.fields.carryOverMaxDays)).toHaveValue('7.5');
  });

  test('schedules: create, a taken name, the default moves, archiving one in use is refused', async ({
    page,
  }) => {
    await mockApi(page, { signedIn: true, me: operationsManagerMe });
    await openSettings(page);
    await page.getByRole('tab', { name: s.tabs.schedules }).click();
    await expect(page).toHaveURL(/tab=schedules/);

    const main = page.locator('[data-schedule="الدوام الرئيسي"]');
    await expect(main.getByText(h.schedules.default)).toBeVisible();
    await expect(main.getByText('09:00 – 17:00').first()).toBeVisible();
    const flexible = page.locator('[data-schedule="دوام مرن"]');
    await expect(flexible).toContainText(fill(h.schedules.employees_zero, {}));

    // A new fixed schedule: Sunday to Thursday from 10:00 for 6 hours.
    await page.getByRole('button', { name: h.schedules.add }).click();
    const dialog = page.getByRole('dialog', { name: h.schedules.addTitle });
    await dialog.getByLabel(h.schedules.name).fill('الدوام الرئيسي');
    for (const weekday of ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday']) {
      const day = h.weekdays[weekday as keyof typeof h.weekdays];
      await dialog
        .getByLabel(fill(h.schedules.startOf, { day }))
        .fill(weekday === 'saturday' ? '09:00' : '10:00');
      await dialog.getByLabel(fill(h.schedules.hoursOf, { day })).fill('6');
    }
    await dialog.getByRole('checkbox', { name: h.weekdays.saturday }).click();
    await dialog.getByRole('button', { name: h.schedules.add }).click();
    await expect(dialog.getByText(ar.errors.SCHEDULE_NAME_TAKEN)).toBeVisible();
    await dialog.getByLabel(h.schedules.name).fill('دوام الصيف');
    await dialog.getByRole('button', { name: h.schedules.add }).click();
    await expect(dialog).toBeHidden();
    const summer = page.locator('[data-schedule="دوام الصيف"]');
    await expect(summer.getByText('10:00 – 16:00').first()).toBeVisible();
    await expect(summer.getByText(h.schedules.offDay)).toHaveCount(2);

    // The default moves to the flexible schedule; the main one, with employees, stays.
    await flexible.getByRole('button', { name: h.schedules.makeDefault }).click();
    await expect(page.getByText(fill(h.schedules.madeDefault, { name: 'دوام مرن' }))).toBeVisible();
    await expect(flexible.getByText(h.schedules.default)).toBeVisible();
    await main.getByRole('button', { name: h.schedules.archive }).click();
    const confirm = page.getByRole('alertdialog');
    await confirm.getByRole('button', { name: h.schedules.archive }).click();
    await expect(confirm.getByText(ar.errors.SCHEDULE_IN_USE)).toBeVisible();
    await confirm.getByRole('button', { name: ar.common.cancel }).click();

    await summer.getByRole('button', { name: h.schedules.archive }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: h.schedules.archive }).click();
    await expect(page.getByText(h.schedules.archived)).toBeVisible();
    await expect(summer).toHaveCount(0);
  });

  test("holidays: add one, an overlap is refused, and last year's are repeated", async ({
    page,
  }) => {
    await mockApi(page, { signedIn: true, me: manager, holidays: true });
    await openSettings(page);
    await page.getByRole('tab', { name: s.tabs.holidays }).click();
    await expect(page.getByRole('row')).toHaveCount(6);

    await page.getByRole('button', { name: h.holidays.add }).click();
    const dialog = page.getByRole('dialog', { name: h.holidays.addTitle });
    await dialog.getByLabel(h.holidays.name).fill('عيد الاستقلال');
    await dialog.getByLabel(h.holidays.startsOn).fill('2026-05-01');
    await dialog.getByRole('button', { name: h.holidays.add }).click();
    await expect(dialog.getByText(ar.errors.HOLIDAY_OVERLAP)).toBeVisible();
    await dialog.getByLabel(h.holidays.startsOn).fill('2026-04-17');
    await dialog.getByLabel(h.holidays.endsOn).fill('2026-04-30');
    await dialog.getByRole('button', { name: h.holidays.add }).click();
    await expect(dialog.getByText(fill(h.holidays.errors.range, { days: '10' }))).toBeVisible();
    await dialog.getByLabel(h.holidays.endsOn).fill('');
    await dialog.getByRole('button', { name: h.holidays.add }).click();
    await expect(dialog).toBeHidden();
    const added = page.locator('[data-holiday="عيد الاستقلال"]');
    await expect(added).toContainText(h.file.days_one);
    await expect(added).toContainText(h.holidays.paid);

    // 2027 is empty until 2026 is repeated; a second run finds nothing new.
    await page.getByRole('button', { name: h.holidays.nextYear }).click();
    await expect(page).toHaveURL(/year=2027/);
    await expect(page.getByText(fill(h.holidays.emptyTitle, { year: '2027' }))).toBeVisible();
    await page.getByRole('button', { name: h.holidays.repeat }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: h.holidays.repeat }).click();
    await expect(page.getByText(fill(h.holidays.repeated_few, { holidays: '6' }))).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(7);
    await expect(page.locator('[data-holiday="عيد الميلاد"]')).toContainText(h.holidays.unpaid);
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await page.getByRole('button', { name: h.holidays.repeat }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: h.holidays.repeat }).click();
    await expect(page.getByText(h.holidays.repeatedNone)).toBeVisible();

    await page
      .getByRole('button', { name: fill(h.holidays.archiveOf, { name: 'عيد الميلاد' }) })
      .click();
    await page.getByRole('alertdialog').getByRole('button', { name: h.holidays.archive }).click();
    await expect(page.locator('[data-holiday="عيد الميلاد"]')).toHaveCount(0);
  });

  test('only hr.manage holders see the settings', async ({ page }) => {
    for (const me of [employeeMe, financeMe]) {
      await mockApi(page, { signedIn: true, me });
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: ar.nav.label });
      await expect(nav.getByRole('link', { name: ar.nav.hrSettings })).toHaveCount(0);
      await page.goto('/hr/settings');
      await expect(page).toHaveURL(/\/$/);
    }
  });
});

test('a holiday shows on the calendar for everyone, and opens nothing', async ({ page }) => {
  await page.clock.setFixedTime(new Date(HR_NOW));
  await mockApi(page, { signedIn: true, me: employeeMe, holidays: true });
  await page.goto('/calendar?date=2026-10-06');
  const chip = page.getByText('ذكرى حرب تشرين').first();
  await expect(chip).toBeVisible();
  await expect(page.getByRole('link', { name: /ذكرى حرب تشرين/ })).toHaveCount(0);
  await expect(page.getByRole('img', { name: ar.calendar.keyDates.holiday }).first()).toBeVisible();
});

test("the GM moves an employee to another schedule from the file's contract", async ({ page }) => {
  await page.clock.setFixedTime(new Date(HR_NOW));
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/hr/people/${seedIds.karim}?tab=contract`);
  await page.getByRole('button', { name: h.file.edit }).click();
  const dialog = page.getByRole('dialog', { name: h.contract.title });
  await dialog.getByRole('combobox', { name: h.fields.schedule }).click();
  await page.getByRole('option', { name: 'دوام مرن', exact: true }).click();
  await dialog.getByRole('button', { name: ar.common.save }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('دوام مرن')).toBeVisible();
});

test("a new post task's default due date skips a public holiday", async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
  await mockApi(page, { signedIn: true, me: manager, content: true });
  // A holiday on Tuesday 13 October, the day before the reel is published on Wednesday.
  await page.goto('/hr/settings?tab=holidays');
  await page.getByRole('button', { name: h.holidays.add }).click();
  const holiday = page.getByRole('dialog', { name: h.holidays.addTitle });
  await holiday.getByLabel(h.holidays.name).fill('عطلة طارئة');
  await holiday.getByLabel(h.holidays.startsOn).fill('2026-10-13');
  await holiday.getByRole('button', { name: h.holidays.add }).click();
  await expect(holiday).toBeHidden();

  await page.goto(`/content/posts/${seedIds.kitchenReel}`);
  await page.getByRole('button', { name: ar.content.tasks.link }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: ar.content.link.tabs.request }).click();
  // Two work days before Wednesday: Monday, then Sunday, past the holiday.
  await expect(dialog.getByLabel(ar.tasks.form.dueDate)).toHaveValue('2026-10-11');
});
