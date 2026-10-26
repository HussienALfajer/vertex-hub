import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  employeeMe,
  financeMe,
  HR_NOW,
  manager,
  mockApi,
  operationsManagerMe,
  seedIds,
} from './fixtures';
import { expect, test } from './test';

// F17 part A in the web app: People, the employee file with its sections by rule A2, salary
// history, the payout method and the end of service, against the mocked API (the rules
// themselves are covered by apps/api/test/hr-employees.test.ts).

const h = ar.hr;

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(HR_NOW));
});

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('the General Manager keeps an employee file: personal, contract and pay', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: ar.nav.label });
  await nav.getByRole('link', { name: ar.nav.people }).click();
  await expect(page).toHaveURL(/\/hr\/people$/);
  await expect(page.getByRole('columnheader', { name: h.people.columns.salary })).toBeVisible();
  const karimRow = page.getByRole('row', { name: /كريم الزين/ });
  await expect(karimRow).toContainText('750.00');
  await karimRow.getByRole('link', { name: /كريم الزين/ }).click();
  await expect(page).toHaveURL(new RegExp(`/hr/people/${seedIds.karim}$`));

  // Personal: edited by HR; a malformed emergency phone is refused before sending.
  await expect(page.getByText('01020304050')).toBeVisible();
  await page.getByRole('button', { name: h.file.edit }).click();
  const personal = page.getByRole('dialog', { name: h.personal.title });
  await personal.getByLabel(h.fields.emergencyPhone).fill('12');
  await personal.getByRole('button', { name: ar.common.save }).click();
  await expect(personal.getByText(ar.users.form.errors.phone)).toBeVisible();
  await personal.getByLabel(h.fields.emergencyPhone).fill('+963944777888');
  await personal.getByLabel(h.fields.address).fill('دمشق، أبو رمانة');
  await personal.getByRole('button', { name: ar.common.save }).click();
  await expect(personal).toBeHidden();
  await expect(page.getByText('دمشق، أبو رمانة')).toBeVisible();
  await expect(page.getByText('+963944777888')).toBeVisible();

  // Contract: probation cannot end before the start date (rule A1).
  await page.getByRole('tab', { name: h.file.tabs.contract }).click();
  await expect(page).toHaveURL(/tab=contract/);
  // The personal panel may still be leaving: its own edit button matches until then.
  await page
    .getByRole('tabpanel', { name: h.file.tabs.contract })
    .getByRole('button', { name: h.file.edit })
    .click();
  const contract = page.getByRole('dialog', { name: h.contract.title });
  await contract.getByLabel(h.fields.probationEndDate).fill('2025-01-01');
  await contract.getByRole('button', { name: ar.common.save }).click();
  await expect(contract.getByText(h.contract.errors.order)).toBeVisible();
  await contract.getByLabel(h.fields.probationEndDate).fill('2025-06-30');
  await contract.getByRole('button', { name: h.weekdays.sunday }).click();
  // An emptied field is refused; Arabic-Indic digits are read as typed.
  await contract.getByLabel(h.fields.annualLeaveDays).fill('');
  await contract.getByRole('button', { name: ar.common.save }).click();
  await expect(contract.getByText(h.contract.errors.leaveDays)).toBeVisible();
  await contract.getByLabel(h.fields.annualLeaveDays).fill('١٥');
  await contract.getByRole('button', { name: ar.common.save }).click();
  await expect(contract).toBeHidden();
  await expect(page.getByText(`${h.weekdays.sunday} و${h.weekdays.thursday}`)).toBeVisible();
  await expect(page.getByText(fill(h.file.days_many, { days: '15' }))).toBeVisible();

  // Pay: the current salary and its history; a second change on the same date is refused.
  await page.getByRole('tab', { name: h.file.tabs.pay }).click();
  await expect(page.getByText(/750\.00/).first()).toBeVisible();
  await expect(page.getByText(h.salary.archived)).toBeVisible();
  await page.getByRole('button', { name: h.salary.add }).click();
  const salary = page.getByRole('dialog', { name: h.salary.addTitle });
  await salary.getByLabel(h.salary.amount).fill('900');
  await salary.getByLabel(h.salary.effectiveOn).fill('2026-03-01');
  await salary.getByLabel(h.salary.reason).fill('ترقية');
  await salary.getByRole('button', { name: h.salary.add }).click();
  await expect(salary.getByText(ar.errors.DUPLICATE_EFFECTIVE_DATE)).toBeVisible();
  await salary.getByLabel(h.salary.effectiveOn).fill('2026-10-01');
  await salary.getByRole('button', { name: h.salary.add }).click();
  await expect(salary).toBeHidden();
  await expect(page.getByText(/900\.00/).first()).toBeVisible();

  // A wrong entry is archived with a reason, and the current salary falls back.
  const latest = page.getByRole('listitem').filter({ hasText: 'ترقية' });
  await latest.getByRole('button', { name: h.salary.archive }).click();
  const archive = page.getByRole('dialog', { name: h.salary.archiveTitle });
  await archive.getByLabel(h.salary.archiveReason).fill('أُدخل قبل الموافقة');
  await archive.getByRole('button', { name: h.salary.archive }).click();
  await expect(archive).toBeHidden();
  await expect(
    page.getByText(fill(h.salary.archiveReasonShown, { reason: 'أُدخل قبل الموافقة' })),
  ).toBeVisible();

  // Payout: cash clears the bank details (rule A5).
  await page.getByRole('button', { name: h.pay.editPayout }).click();
  const payout = page.getByRole('dialog', { name: h.pay.payoutTitle });
  await choose(page, h.fields.payoutMethod, h.payoutMethods.cash);
  await expect(payout.getByLabel(h.fields.payoutHolder)).toBeHidden();
  await payout.getByRole('button', { name: ar.common.save }).click();
  await expect(payout).toBeHidden();
  await expect(page.getByText(h.payoutMethods.cash)).toBeVisible();
  await expect(page.getByText('SY21 0123 4567 8901 2345')).toBeHidden();
});

test('the General Manager ends a service and undoes it', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/hr/people/${seedIds.karim}`);
  await page.getByRole('button', { name: h.end.action }).click();
  const dialog = page.getByRole('dialog', { name: fill(h.end.title, { name: 'كريم الزين' }) });
  await dialog.getByRole('button', { name: h.end.action }).click();
  await expect(dialog.getByText(h.end.errors.reason)).toBeVisible();
  await dialog.getByLabel(h.end.endedOn).fill('2026-11-15');
  await choose(page, h.end.reason, h.endReasons.resigned);
  await dialog.getByRole('button', { name: h.end.action }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/آخر يوم عمل/)).toBeVisible();
  await expect(page.getByText(h.statuses.leaving).first()).toBeVisible();

  await page.getByRole('button', { name: h.end.clear }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: h.end.clear }).click();
  await expect(page.getByText(/آخر يوم عمل/)).toBeHidden();
  await expect(page.getByText(h.statuses.active).first()).toBeVisible();
});

test('Internal Operations reads files without pay; Finance reads pay without the file', async ({
  page,
}) => {
  const api = await mockApi(page, { signedIn: true, me: operationsManagerMe });
  await page.goto('/hr/people');
  await expect(page.getByRole('row', { name: /كريم الزين/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: h.people.columns.salary })).toHaveCount(0);
  await page.goto(`/hr/people/${seedIds.karim}`);
  await expect(page.getByRole('tab', { name: h.file.tabs.personal })).toBeVisible();
  await expect(page.getByRole('tab', { name: h.file.tabs.pay })).toHaveCount(0);
  await expect(page.getByText('750.00')).toHaveCount(0);

  api.signInAs(financeMe);
  await page.goto('/hr/people');
  await expect(page.getByRole('columnheader', { name: h.people.columns.salary })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: h.people.columns.startDate })).toHaveCount(0);
  await page.goto(`/hr/people/${seedIds.karim}`);
  await expect(page.getByRole('tab', { name: h.file.tabs.personal })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: h.file.tabs.pay })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText(/750\.00/).first()).toBeVisible();
  // Finance edits the payout, never the salary (`salaries.manage` is the GM's).
  await expect(page.getByRole('button', { name: h.pay.editPayout })).toBeVisible();
  await expect(page.getByRole('button', { name: h.salary.add })).toHaveCount(0);
  // Rule A6: Finance adds confidential documents only.
  await page.getByRole('tab', { name: h.file.tabs.documents }).click();
  await page.getByRole('button', { name: ar.files.documents.upload }).click();
  const confidential = page.getByRole('checkbox', {
    name: new RegExp(ar.files.confidentialChoice),
  });
  await expect(confidential).toBeChecked();
  await expect(confidential).toBeDisabled();
});

test('an employee reads their own file and no one else’s', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/');
  await expect(
    page.getByRole('navigation', { name: ar.nav.label }).getByRole('link', { name: ar.nav.hr }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: ar.user.menu }).click();
  await page.getByRole('menuitem', { name: ar.user.myFile }).click();
  await expect(page).toHaveURL(/\/me\/file$/);
  await expect(page.getByText(h.file.myTitle).first()).toBeVisible();
  await expect(page.getByText('01020304050')).toBeVisible();
  await expect(page.getByRole('button', { name: h.file.edit })).toHaveCount(0);
  await page.getByRole('tab', { name: h.file.tabs.pay }).click();
  await expect(page.getByText(/750\.00/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: h.pay.editPayout })).toHaveCount(0);
  await expect(page.getByRole('button', { name: h.end.action })).toHaveCount(0);

  await page.goto(`/hr/people/${seedIds.layan}`);
  await expect(page.getByText(h.file.notFound)).toBeVisible();
  await page.goto('/hr/people');
  await expect(page).toHaveURL(/\/$/);
});
