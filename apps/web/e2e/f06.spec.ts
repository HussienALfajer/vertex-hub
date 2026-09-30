import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { accountManagerMe, employeeMe, mockApi, PROJECTS_TODAY, seedIds } from './fixtures';
import { expect, test } from './test';

// F06 task flows against the mocked API (the real rules are covered by apps/api/test).

/** Freezes the browser's clock on the seeded "today" so due dates and badges are stable. */
async function onTasksToday(page: Page) {
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
}

/** Clicks a workflow move in the task header, then confirms its dialog when it opens one. */
async function move(page: Page, name: string, note?: string) {
  await page.getByRole('button', { name, exact: true }).first().click();
  if (note !== undefined) {
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').first().fill(note);
    await dialog.getByRole('button', { name, exact: true }).click();
  }
}

async function expectStatus(page: Page, status: keyof typeof ar.tasks.statuses) {
  const hero = page.locator('section').first();
  await expect(hero.getByText(ar.tasks.statuses[status], { exact: true })).toBeVisible();
}

test('request → assign → work → internal return → client changes over the limit → approve → deliver', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Tall enough that the header's moves never sit under the toasts.
  await page.setViewportSize({ width: 1280, height: 2000 });
  await onTasksToday(page);
  const api = await mockApi(page, { signedIn: true, me: employeeMe });

  // A plain employee requests a banner from Design for a client's project.
  await page.goto('/tasks');
  await page.getByRole('link', { name: ar.tasks.actions.request }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.tasks.new.requestTitle);
  await page.getByRole('combobox', { name: ar.tasks.form.department }).click();
  await page.getByRole('option', { name: 'التصميم' }).click();
  await page.getByLabel(ar.tasks.form.title).fill('بانر الافتتاح');
  await page.getByLabel(ar.tasks.form.dueDate).fill('2026-10-13');
  await page.getByRole('combobox', { name: ar.tasks.form.client }).click();
  await page.getByRole('option', { name: /مطعم الياسمين/ }).click();
  await page.getByRole('combobox', { name: ar.tasks.form.engagement }).click();
  await page.getByRole('option', { name: 'الهوية البصرية الجديدة' }).click();
  await page.getByLabel(ar.tasks.form.revisionLimit).fill('1');
  await page.getByRole('button', { name: ar.tasks.form.sendRequest }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('بانر الافتتاح');
  await expect(page.getByText(ar.tasks.unassigned).first()).toBeVisible();
  const bannerUrl = page.url();

  // The Design manager finds it in the unassigned queue and assigns it.
  api.signInAs(accountManagerMe);
  await page.goto('/tasks');
  const queue = page.getByRole('region', {
    name: ar.tasks.my.sections.unassignedInMyDepartments,
  });
  await queue.getByRole('link', { name: 'بانر الافتتاح' }).click();
  await page.getByRole('button', { name: ar.tasks.actions.more }).click();
  await page.getByRole('menuitem', { name: ar.tasks.actions.reassign }).click();
  const reassign = page.getByRole('dialog');
  await reassign.getByRole('combobox', { name: ar.tasks.form.assignee }).click();
  await page.getByRole('option', { name: 'ليان الأحمد' }).click();
  await reassign.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.tasks.reassign.done)).toBeVisible();

  // A second task for Content waits on the banner.
  await page.goto('/tasks/new?mode=request');
  await page.getByRole('combobox', { name: ar.tasks.form.department }).click();
  await page.getByRole('option', { name: 'إدارة المحتوى' }).click();
  await page.getByLabel(ar.tasks.form.title).fill('نشر البانر');
  await page.getByLabel(ar.tasks.form.dueDate).fill('2026-10-15');
  await page.getByRole('combobox', { name: ar.tasks.form.client }).click();
  await page.getByRole('option', { name: /مطعم الياسمين/ }).click();
  const dependencies = page.getByLabel(ar.tasks.form.dependencies);
  await dependencies.fill('بانر');
  await page.getByRole('option', { name: 'بانر الافتتاح' }).click();
  await page.getByRole('button', { name: ar.tasks.form.sendRequest }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('نشر البانر');
  await expect(page.getByText(ar.tasks.blocked).first()).toBeVisible();
  const publishUrl = page.url();

  // The assignee starts, ticks a checklist item, adds a link and submits for review.
  await page.goto(bannerUrl);
  await move(page, ar.tasks.moves.start);
  await expectStatus(page, 'in_progress');
  await page.getByLabel(ar.tasks.checklist.add).fill('قص المقاسات');
  await page.getByRole('button', { name: ar.tasks.form.addItem, exact: true }).click();
  await page.getByRole('checkbox', { name: 'قص المقاسات' }).click();
  await expect(page.getByRole('checkbox', { name: 'قص المقاسات' })).toBeChecked();
  await page.getByRole('button', { name: ar.tasks.links.add }).click();
  await page.getByRole('dialog').getByLabel(ar.tasks.links.url).fill('https://drive.google.com/x');
  await page.getByRole('dialog').getByRole('button', { name: ar.tasks.links.add }).click();
  await expect(page.getByText(ar.tasks.links.added)).toBeVisible();
  await move(page, ar.tasks.moves.submit);
  await expectStatus(page, 'internal_review');

  // The manager returns it (an internal revision, never counted), then it goes to the client.
  await move(page, ar.tasks.moves.return, 'كبّر الشعار');
  await expectStatus(page, 'revisions');
  await expect(page.getByText(ar.tasks.revisions.internal, { exact: true })).toBeVisible();
  await move(page, ar.tasks.moves.resubmit);
  await move(page, ar.tasks.moves.send_to_client);
  await expectStatus(page, 'awaiting_client');

  // The account manager records changes twice: the second is over the limit of 1.
  await move(page, ar.tasks.moves.client_changes, 'غيّر الخلفية');
  await move(page, ar.tasks.moves.resubmit);
  await move(page, ar.tasks.moves.send_to_client);
  await move(page, ar.tasks.moves.client_changes, 'أضف رقم الهاتف');
  await expect(page.getByText(ar.tasks.overLimitPending).first()).toBeVisible();
  await page.getByRole('button', { name: ar.tasks.revisions.decide }).click();
  await page.getByRole('dialog').getByRole('button', { name: ar.tasks.revisions.decide }).click();
  await expect(page.getByText(ar.tasks.revisions.decided.extra_work)).toBeVisible();
  await expect(page.getByText(ar.tasks.overLimitPending)).toHaveCount(0);

  // The client approves: the waiting task is no longer blocked. Then the banner is delivered.
  await move(page, ar.tasks.moves.resubmit);
  await move(page, ar.tasks.moves.send_to_client);
  await page.getByRole('button', { name: ar.tasks.moves.client_approved, exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: ar.tasks.moves.client_approved, exact: true })
    .click();
  await expectStatus(page, 'approved');
  await page.goto(publishUrl);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('نشر البانر');
  await expect(page.getByText(ar.tasks.blocked)).toHaveCount(0);
  await page.goto(bannerUrl);
  await move(page, ar.tasks.moves.deliver);
  await expectStatus(page, 'delivered');

  // The over-limit decision logged extra work on the project.
  await page.goto(`/projects/${seedIds.identityProject}?tab=extra-work`);
  await expect(page.getByText('التعديل 2: بانر الافتتاح')).toBeVisible();
});

test('an employee sees every task but acts only on their own', async ({ page }) => {
  await onTasksToday(page);
  await mockApi(page, { signedIn: true, me: employeeMe });

  // Someone else's task: readable, without actions.
  await page.goto(`/tasks/${seedIds.openingPosts}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('بوستات أسبوع الافتتاح');
  await expect(page.getByText(ar.tasks.overLimitPending).first()).toBeVisible();
  await expect(page.getByRole('button', { name: ar.tasks.actions.more })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ar.tasks.revisions.decide })).toHaveCount(0);

  // Their own task waits on unfinished work, so it cannot start without an override.
  await page.goto(`/tasks/${seedIds.dishShoot}`);
  await expect(page.getByText(ar.tasks.blocked).first()).toBeVisible();
  await expect(page.getByRole('button', { name: ar.tasks.moves.start })).toHaveCount(0);

  // Assigning: a plain employee may pick only themselves, in their own department.
  await page.goto('/tasks/new');
  await page.getByRole('combobox', { name: ar.tasks.form.assignee }).click();
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText('كريم الزين');
});

test('the task list keeps its filters in the URL and sorts by column', async ({ page }) => {
  await onTasksToday(page);
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto('/tasks/list');
  await expect(page.getByRole('link', { name: 'تصاميم منيو الخريف' })).toBeVisible();

  await page.getByRole('button', { name: ar.tasks.filters.overdue }).click();
  await expect(page).toHaveURL(/overdue=true/);
  await expect(page.getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'تصاميم منيو الخريف' })).toBeVisible();
  await page.getByRole('button', { name: ar.tasks.filters.clear }).click();

  await page.getByRole('button', { name: ar.tasks.columns.priority }).click();
  await expect(page).toHaveURL(/sort=priority/);
  await expect(page.getByRole('columnheader', { name: ar.tasks.columns.priority })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  await expect(page.getByRole('row').nth(1)).toContainText('فيديو تعريفي للعيادة');
});

test('archiving a user with open tasks lists them with a link to each', async ({ page }) => {
  await onTasksToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto(`/team/${seedIds.karim}`);
  await page.getByRole('button', { name: ar.users.profile.actions }).click();
  await page.getByRole('menuitem', { name: ar.users.profile.archive }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: ar.users.confirm.archiveAction })
    .click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText('تنفيذ المهمة المفتوحة جلسة تصوير الأطباق')).toBeVisible();
  await dialog.getByRole('link', { name: ar.users.responsibilities.openTask }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('جلسة تصوير الأطباق');
});

test('the board moves a card by dragging it and through its "Move to…" menu', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await onTasksToday(page);
  await mockApi(page, { signedIn: true, me: accountManagerMe });

  // The Design manager finds the board in the navigation; it shows their department.
  await page.goto('/tasks');
  await page
    .getByRole('navigation', { name: ar.nav.label })
    .getByRole('link', { name: ar.nav.taskBoard })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.tasks.board.title);
  const column = (status: string) => page.locator(`li[data-status="${status}"]`);
  const card = page.locator(`li[data-task="${seedIds.autumnMenu}"]`);
  await expect(column('in_progress').locator(card)).toBeVisible();

  // Dragging marks the columns the task may move to; the assignee submits it for review.
  await card.hover();
  await page.mouse.down();
  await column('internal_review').hover();
  await expect(column('internal_review')).toHaveAttribute('data-drop', 'allowed');
  await expect(column('delivered')).toHaveAttribute('data-drop', 'refused');
  await column('internal_review').hover({ position: { x: 40, y: 80 } });
  await page.mouse.up();
  await expect(page.getByText(ar.tasks.moves.done.submit)).toBeVisible();
  await expect(column('internal_review').locator(card)).toBeVisible();

  // The keyboard way: a move that needs a note opens the task page's dialog.
  const logo = page.locator(`li[data-task="${seedIds.clinicLogo}"]`);
  await logo.getByRole('button', { name: /انقل/ }).click();
  await page.getByRole('menuitem', { name: ar.tasks.moves.return }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').first().fill('وحّد درجة الأخضر');
  await dialog.getByRole('button', { name: ar.tasks.moves.return }).click();
  await expect(column('revisions').locator(logo)).toBeVisible();
});

test('the board is linked for managers only, and reachable by everyone', async ({ page }) => {
  await onTasksToday(page);
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/tasks');
  const nav = page.getByRole('navigation', { name: ar.nav.label });
  await expect(nav.getByRole('link', { name: ar.nav.workload })).toBeVisible();
  await expect(nav.getByRole('link', { name: ar.nav.taskBoard })).toHaveCount(0);

  // The photographer's own department; their task waits on the menu designs, so it cannot start.
  await page.goto('/tasks/board');
  const shoot = page.locator(`li[data-task="${seedIds.dishShoot}"]`);
  await expect(page.locator('li[data-status="new"]').locator(shoot)).toBeVisible();
  await shoot.getByRole('button', { name: /انقل/ }).click();
  await expect(page.getByRole('menuitem', { name: ar.tasks.moves.cancel })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: ar.tasks.moves.start })).toHaveCount(0);
});

test('workload counts open the matching tasks in the list', async ({ page }) => {
  await onTasksToday(page);
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto('/tasks/workload');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.tasks.workload.title);
  const row = page.getByRole('row', { name: /ليان الأحمد/ });
  await expect(row).toBeVisible();

  // Next week, and back.
  await page.getByRole('button', { name: ar.tasks.workload.nextWeek }).click();
  await expect(page).toHaveURL(/week=2026-10-17/);
  await page.getByRole('button', { name: ar.tasks.workload.thisWeek }).click();
  await expect(page).not.toHaveURL(/week=/);

  await row.getByRole('link', { name: /المتأخرة/ }).click();
  await expect(page).toHaveURL(/\/tasks\/list\?.*overdue=true/);
  await expect(page.getByRole('link', { name: 'تصاميم منيو الخريف' })).toBeVisible();
});

test('project, retainer and client pages lead to their tasks', async ({ page }) => {
  await onTasksToday(page);
  await mockApi(page, { signedIn: true, me: accountManagerMe });

  // The project's Tasks tab groups them by milestone and presets new ones.
  await page.goto(`/projects/${seedIds.identityProject}?tab=tasks`);
  await expect(page.getByRole('link', { name: 'تصاميم منيو الخريف' })).toBeVisible();
  await expect(page.getByRole('heading', { name: ar.tasks.projectTab.noMilestone })).toBeVisible();
  await page.getByRole('link', { name: ar.tasks.projectTab.newForMilestone }).first().click();
  await expect(page).toHaveURL(/milestoneId=/);

  // A retainer line offers a task for it.
  await page.goto(`/retainers/${seedIds.socialRetainer}`);
  await page.getByRole('link', { name: ar.retainers.cycle.newTask }).first().click();
  await expect(page).toHaveURL(/cycleLineId=/);

  // The client's open tasks put the pending over-limit decision first.
  await page.goto(`/clients/${seedIds.jasmine}?tab=tasks`);
  const rows = page.getByRole('tabpanel').getByRole('listitem');
  await expect(rows.first()).toContainText('بوستات أسبوع الافتتاح');
  await expect(rows.first()).toContainText(ar.tasks.overLimitPending);
});
