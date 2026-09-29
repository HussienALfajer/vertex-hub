import { expect, type Page, test } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { employeeMe, financeWithoutTwoFactor, mockApi, PROJECTS_TODAY, seedIds } from './fixtures';

// F05 project and retainer flows against the mocked API (the real rules are covered by apps/api/test).

/** Freezes the browser's clock on the seeded "today" so schedules and badges are stable. */
async function onProjectsToday(page: Page) {
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
}

test('create a project from the client profile, start it and climb its milestones', async ({
  page,
}) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto(`/clients/${seedIds.jasmine}?tab=projects`);
  await page.getByRole('link', { name: ar.projects.newProject }).first().click();

  // The client comes preset, and the suggested milestones are ready to edit.
  await expect(page.getByRole('combobox', { name: ar.projects.form.client })).toContainText(
    'مطعم الياسمين',
  );
  await page.getByLabel(ar.projects.form.name).fill('موقع الحجوزات');
  await page.getByRole('combobox', { name: ar.projects.form.projectManager }).click();
  await page.getByRole('option', { name: /كريم الزين/ }).click();
  const departments = page.getByLabel(ar.projects.form.departments);
  await departments.fill('التصميم');
  await page.getByRole('option', { name: 'التصميم' }).click();
  await departments.fill('التطوير');
  await page.getByRole('option', { name: 'التطوير' }).click();
  await page.getByLabel(ar.projects.form.dueDate).fill('2026-12-20');
  for (const [position, amount] of ['500', '1000', '1500', '500', '500'].entries()) {
    await page
      .getByLabel(ar.projects.form.milestoneInstallment.replace('{{position}}', `${position + 1}`))
      .fill(amount);
  }
  const preview = page.getByRole('complementary', { name: ar.projects.new.preview });
  await expect(preview).toContainText('4,000.00');
  await page.getByRole('button', { name: ar.projects.form.create }).click();

  // The project opens as planned, with the total of its installments.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('موقع الحجوزات');
  await expect(page.getByText(ar.projects.statuses.planned).first()).toBeVisible();
  await expect(page.getByText(/4,000\.00\sUSD/).first()).toBeVisible();

  await page.getByRole('button', { name: ar.projects.actions.start }).click();
  await expect(page.getByText(ar.projects.actions.done.active)).toBeVisible();

  const steps = page.getByRole('list', { name: ar.projects.milestones.title });
  await steps
    .getByRole('listitem')
    .first()
    .getByRole('button', { name: ar.projects.milestones.complete })
    .click();
  await expect(page.getByText(ar.projects.milestones.completed)).toBeVisible();

  // Completing the project is refused while milestones are open (rule 6), listing them.
  await page.getByRole('button', { name: ar.projects.actions.complete }).click();
  const blocked = page.getByRole('alertdialog');
  await expect(blocked.getByText(ar.projects.complete.blockedTitle)).toBeVisible();
  await expect(blocked.getByText(ar.projects.suggested.delivery)).toBeVisible();
  await expect(blocked.getByText(ar.projects.suggested.discovery)).toHaveCount(0);
});

test('the project manager edits their project, sees no money and logs extra work', async ({
  page,
}) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/projects');
  await expect(page.getByRole('link', { name: ar.projects.newProject })).toHaveCount(0);
  await page.getByRole('button', { name: ar.projects.filters.mine }).click();
  await expect(page.getByRole('link', { name: /موقع العيادة/ })).toHaveCount(0);
  await page.getByRole('link', { name: /الهوية البصرية الجديدة/ }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('الهوية البصرية الجديدة');
  await expect(page.getByRole('button', { name: ar.common.edit })).toBeVisible();
  await expect(page.getByRole('button', { name: ar.projects.milestones.add })).toBeVisible();
  // Changing the manager, cancelling and money need client scope (actions table, M1).
  await page.getByRole('button', { name: ar.projects.actions.more }).click();
  await expect(page.getByRole('menuitem', { name: ar.projects.actions.hold })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: ar.projects.actions.cancel })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByText(ar.projects.milestones.total)).toHaveCount(0);
  await expect(page.getByText(/USD/)).toHaveCount(0);

  await page.getByRole('tab', { name: ar.projects.page.tabs.extraWork }).click();
  await expect(page).toHaveURL(/tab=extra-work/);
  await page.getByRole('button', { name: ar.projects.extraWork.log }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(ar.projects.extraWork.fields.title).fill('غلاف إضافي لقائمة الحلويات');
  await expect(dialog.getByLabel(ar.projects.extraWork.estimate)).toHaveCount(0);
  await dialog.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByRole('heading', { name: 'غلاف إضافي لقائمة الحلويات' })).toBeVisible();
});

test('an employee reads a project without edit actions or money', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto(`/projects/${seedIds.clinicSite}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('موقع العيادة');
  await expect(page.getByText(ar.projects.overdue).first()).toBeVisible();
  await expect(page.getByRole('button', { name: ar.common.edit })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ar.projects.milestones.complete })).toHaveCount(0);
  await expect(page.getByText(/SYP/)).toHaveCount(0);
});

test('billing stays open on a completed project while its work is read-only (M3)', async ({
  page,
}) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto(`/projects/${seedIds.summerMenu}?tab=extra-work`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('قائمة الطعام الصيفية');
  await expect(page.getByRole('button', { name: ar.projects.extraWork.log })).toHaveCount(0);

  const title = 'نسخة مطبوعة من القائمة';
  await page
    .getByRole('button', { name: ar.projects.extraWork.actions.replace('{{title}}', title) })
    .click();
  await expect(page.getByRole('menuitem', { name: ar.common.edit })).toHaveCount(0);
  await page.getByRole('menuitem', { name: ar.projects.extraWork.changeBilling }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('button', { name: ar.projects.extraWork.billing.billed, exact: true })
    .click();
  await dialog.getByLabel(ar.projects.extraWork.fields.billingNote).fill('INV-2026-031');
  await dialog.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.projects.extraWork.billingSaved)).toBeVisible();
  await expect(page.getByText('INV-2026-031')).toBeVisible();
});

test('the audit log names project changes in Arabic and shows amounts in major units', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/audit');
  const status = page
    .getByRole('listitem')
    .filter({ hasText: ar.audit.actions.project.status_changed });
  await status.getByRole('button', { name: ar.audit.showDetails }).click();
  await expect(status.getByRole('cell', { name: ar.projects.statuses.planned })).toBeVisible();
  await expect(status.getByRole('cell', { name: ar.projects.statuses.active })).toBeVisible();

  const milestone = page
    .getByRole('listitem')
    .filter({ hasText: ar.audit.actions.project_milestone.updated });
  await expect(milestone.getByRole('link', { name: /التنفيذ/ })).toBeVisible();
  await milestone.getByRole('button', { name: ar.audit.showDetails }).click();
  await expect(milestone.getByRole('cell', { name: '1,000.00' })).toBeVisible();
  await expect(milestone.getByRole('cell', { name: '1,200.00' })).toBeVisible();
});

test('a project manager cannot be archived while their projects are open', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto(`/team/${seedIds.karim}`);
  await page.getByRole('button', { name: ar.users.profile.actions }).click();
  await page.getByRole('menuitem', { name: ar.users.profile.archive }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: ar.users.confirm.archiveAction })
    .click();

  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText('مدير المشروع الهوية البصرية الجديدة')).toBeVisible();
  await dialog.getByRole('link', { name: ar.users.responsibilities.openProject }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('الهوية البصرية الجديدة');
});

// F05 retainer flows.

test('create a retainer starting today: this month opens at once and a counter is adjusted', async ({
  page,
}) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto(`/clients/${seedIds.jasmine}?tab=retainers`);
  await page.getByRole('link', { name: ar.retainers.newRetainer }).first().click();

  await expect(page.getByRole('combobox', { name: ar.projects.form.client })).toContainText(
    'مطعم الياسمين',
  );
  await page.getByLabel(ar.retainers.form.name).fill('المحتوى الشهري');
  const departments = page.getByLabel(ar.projects.form.departments);
  await departments.fill('التصميم');
  await page.getByRole('option', { name: 'التصميم' }).click();
  // A start date of today opens this month's cycle with full quantities (R3, R4).
  await expect(page.getByText(ar.retainers.form.cycleNow)).toBeVisible();
  await page.getByLabel(ar.retainers.form.monthlyFee).fill('1500');
  for (const [position, [kind, quantity]] of (
    [
      [ar.retainers.kinds.design, '12'],
      [ar.retainers.kinds.reel, '4'],
      [ar.retainers.kinds.monthly_report, '1'],
    ] as const
  ).entries()) {
    await page.getByRole('button', { name: kind, exact: true }).click();
    await page
      .getByLabel(ar.retainers.lines.quantity.replace('{{position}}', `${position + 1}`))
      .fill(quantity);
  }
  const preview = page.getByRole('complementary', { name: ar.retainers.new.preview });
  await expect(preview).toContainText('1,500.00');
  await page.getByRole('button', { name: ar.retainers.form.create }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('المحتوى الشهري');
  const lines = page.getByRole('list', { name: ar.retainers.cycle.lines });
  const designs = lines.getByRole('listitem').filter({ hasText: ar.retainers.kinds.design });
  await expect(designs).toContainText('0/12');
  await expect(lines.getByRole('listitem')).toHaveCount(3);

  await designs.getByRole('button', { name: ar.retainers.cycle.adjust }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(ar.retainers.cycle.amount).fill('3');
  await dialog.getByLabel(ar.retainers.cycle.reason).fill('تصاميم سُلّمت قبل ربط المهام');
  await dialog.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.retainers.cycle.adjusted)).toBeVisible();
  await expect(designs).toContainText('3/12');
  await designs.getByRole('button', { name: ar.retainers.cycle.adjustments_one }).click();
  await expect(designs.getByText('تصاميم سُلّمت قبل ربط المهام')).toBeVisible();
});

test('a retainer shows its behind lines, renewal badge and closed months', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto('/retainers');
  const row = page.getByRole('row').filter({ hasText: 'إدارة السوشيال ميديا' });
  await expect(row.getByText(ar.retainers.behind)).toBeVisible();
  await expect(row.getByText(ar.retainers.renewal.due)).toBeVisible();
  await row.getByRole('link', { name: /إدارة السوشيال ميديا/ }).click();

  // Reels have nothing delivered a third into the month: behind (R11); stories are on pace.
  const lines = page.getByRole('list', { name: ar.retainers.cycle.lines });
  const reels = lines.getByRole('listitem').filter({ hasText: ar.retainers.kinds.reel });
  await expect(reels.getByText(ar.retainers.behind)).toBeVisible();
  const stories = lines.getByRole('listitem').filter({ hasText: ar.retainers.kinds.story });
  await expect(stories.getByText(ar.retainers.behind)).toHaveCount(0);
  await expect(page.getByText(/1,500\.00\sUSD/)).toBeVisible();

  await page.getByRole('tab', { name: ar.retainers.page.tabs.history }).click();
  await expect(page).toHaveURL(/tab=history/);
  const history = page.getByRole('list', { name: ar.retainers.history.title });
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await history.getByRole('button', { name: /أغسطس/ }).click();
  const cycle = page.getByRole('dialog');
  await expect(cycle.getByText('تغطية افتتاح الفرع')).toBeVisible();
  await expect(
    cycle.getByText(ar.retainers.history.lineAfterClose.replace('{{n}}', '1')),
  ).toBeVisible();
});

test('pausing keeps this month’s cycle, and resuming continues it', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto(`/retainers/${seedIds.socialRetainer}`);
  await page.getByRole('button', { name: ar.projects.actions.more }).click();
  await page.getByRole('menuitem', { name: ar.retainers.actions.pause }).click();
  await expect(page.getByText(ar.retainers.actions.done.paused)).toBeVisible();
  await expect(page.getByRole('list', { name: ar.retainers.cycle.lines })).toBeVisible();
  // A paused retainer is never behind (R11).
  await expect(page.getByText(ar.retainers.behind)).toHaveCount(0);

  await page.getByRole('button', { name: ar.retainers.actions.resume }).click();
  await expect(page.getByText(ar.retainers.actions.done.active)).toBeVisible();
  await expect(
    page.getByRole('list', { name: ar.retainers.cycle.lines }).getByText('3/12'),
  ).toBeVisible();
});

test('an employee reads retainers without edit actions or money', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/retainers');
  await expect(page.getByRole('link', { name: ar.retainers.newRetainer })).toHaveCount(0);
  await page.getByRole('link', { name: /إدارة السوشيال ميديا/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('إدارة السوشيال ميديا');
  await expect(page.getByRole('button', { name: ar.common.edit })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ar.retainers.cycle.adjust })).toHaveCount(0);
  await expect(page.getByText(/USD/)).toHaveCount(0);
  await page.getByRole('tab', { name: ar.projects.page.tabs.extraWork }).click();
  await expect(page.getByRole('button', { name: ar.projects.extraWork.log })).toHaveCount(0);
});

test('finance sees the fee and estimates of a retainer but no edit actions', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, {
    signedIn: true,
    me: { ...financeWithoutTwoFactor, twoFactor: { enabled: true, required: true } },
  });
  await page.goto(`/retainers/${seedIds.socialRetainer}?tab=extra-work`);
  await expect(page.getByText(/1,500\.00\sUSD/)).toBeVisible();
  await expect(page.getByText(/200\.00\sUSD/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: ar.common.edit })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ar.projects.extraWork.log })).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: ar.projects.extraWork.actions.replace('{{title}}', 'ريل إضافي لافتتاح الفرع الثاني'),
    }),
  ).toHaveCount(0);
});

test('an ended retainer is read-only until reactivated', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto(`/retainers/${seedIds.endedRetainer}`);
  await expect(page.getByText(ar.retainers.cycle.none.endedTitle)).toBeVisible();
  await expect(page.getByRole('button', { name: ar.common.edit })).toHaveCount(0);
  await page.getByRole('button', { name: ar.retainers.actions.reactivate }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: ar.retainers.actions.reactivate })
    .click();
  await expect(page.getByText(ar.retainers.actions.done.reactivated)).toBeVisible();
  // Reactivating opens this month's cycle at once (R3).
  await expect(
    page.getByRole('list', { name: ar.retainers.cycle.lines }).getByText('0/1'),
  ).toBeVisible();
});

test('the audit log names retainer changes and links them to the retainer', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/audit');
  const status = page
    .getByRole('listitem')
    .filter({ hasText: ar.audit.actions.retainer.status_changed });
  await status.getByRole('button', { name: ar.audit.showDetails }).click();
  await expect(status.getByRole('cell', { name: ar.retainers.statuses.paused })).toBeVisible();
  await expect(status.getByRole('cell', { name: ar.retainers.statuses.active })).toBeVisible();

  const lines = page
    .getByRole('listitem')
    .filter({ hasText: ar.audit.actions.retainer.deliverables_updated });
  await lines.getByRole('button', { name: ar.audit.showDetails }).click();
  await expect(lines.getByText(`${ar.retainers.kinds.reel}4`)).toBeVisible();
  await lines.getByRole('link', { name: 'إدارة السوشيال ميديا' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('إدارة السوشيال ميديا');
});

test('form errors from the contract schema show in Arabic, never in English', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto(`/retainers/${seedIds.socialRetainer}`);
  const designs = page
    .getByRole('list', { name: ar.retainers.cycle.lines })
    .getByRole('listitem')
    .filter({ hasText: ar.retainers.kinds.design });
  await designs.getByRole('button', { name: ar.retainers.cycle.adjust }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(ar.retainers.cycle.amount).fill('0');
  await dialog.getByRole('button', { name: ar.common.save }).click();
  await expect(dialog.getByText(ar.retainers.cycle.errors.amount)).toBeVisible();
  await expect(dialog.getByText(/cannot be zero/)).toHaveCount(0);
});
