import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  F06B_PARENT,
  F06B_SUBTASKS,
  mockF06b,
  mockF06bCreate,
  mockF06bSaveTemplate,
  mockF06bTree,
} from './f06b-fixtures';
import { accountManagerMe, manager, mockApi, PROJECTS_TODAY, seedIds } from './fixtures';
import { expect, test } from './test';

// F06B creation, templates, the tree and Workload against the mocked API (the rules are covered
// by apps/api/test; the task page by f06b-task-page.spec.ts).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1800 });
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
});

const rows = (page: Page) => page.locator('li[draggable="true"]');

async function pick(page: Page, scope: ReturnType<Page['locator']>, label: string, option: string) {
  await scope.getByRole('combobox', { name: label, exact: true }).click();
  await page
    .getByRole('option', { name: new RegExp(`^${option}`) })
    // A list opened before may stay in the page, hidden: pick from the open one.
    .filter({ visible: true })
    .first()
    .click();
}

/** Basics: a Marketing task assigned to the signed-in account manager, due on the 20th. */
async function basics(page: Page, title: string) {
  await pick(page, page.locator('form'), ar.tasks.form.department, 'التسويق');
  await pick(page, page.locator('form'), ar.tasks.form.assignee, 'ليان الأحمد');
  await page.getByLabel(ar.tasks.form.title).fill(title);
  await page.getByLabel(ar.tasks.form.dueDate).fill('2026-10-20');
}

async function next(page: Page, step: keyof typeof ar.tasks.wizard.steps) {
  await page.getByRole('button', { name: ar.tasks.wizard.next }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: new RegExp(ar.tasks.wizard.steps[step]) }),
  ).toBeVisible();
}

test('create by stages with files and a question, then the parent runs and one subtask reopens', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  const api = await mockF06bCreate(page, (input) =>
    input.subtasks.length > 0
      ? [{ subtaskIndex: 0, code: 'brief_missing' }]
      : [{ subtaskIndex: null, code: 'due_on_day_off', suggestedDate: '2026-10-21' }],
  );
  const f06b = await mockF06b(page, 'revisions');
  await page.goto(`/tasks/new?clientId=${seedIds.jasmine}&projectId=${seedIds.identityProject}`);
  await basics(page, 'حملة منيو الشتاء');

  // Subtasks: two stages, a Content subtask, then two Design ones (one to the queue).
  await next(page, 'subtasks');
  await page.getByRole('radio', { name: new RegExp(ar.tasks.subtasks.runModes.stages) }).click();
  await page.getByLabel(fill(ar.tasks.wizard.subtasks.stageNumber, { n: '1' })).fill('النصوص');
  await page
    .getByRole('button', { name: fill(ar.tasks.wizard.subtasks.addTo, { name: 'النصوص' }) })
    .click();
  await rows(page).nth(0).getByLabel(ar.tasks.form.title).fill('نصوص المنيو');
  await pick(page, rows(page).nth(0), ar.tasks.form.department, 'إدارة المحتوى');
  await page.getByRole('button', { name: ar.tasks.subtasks.addStage }).click();
  await page.getByLabel(fill(ar.tasks.wizard.subtasks.stageNumber, { n: '2' })).fill('التصميم');
  const addDesign = page.getByRole('button', {
    name: fill(ar.tasks.wizard.subtasks.addTo, { name: 'التصميم' }),
  });
  await addDesign.click();
  await rows(page).nth(1).getByLabel(ar.tasks.form.title).fill('تصميم صفحات المنيو');
  await pick(page, rows(page).nth(1), ar.tasks.form.department, 'التصميم');
  await pick(page, rows(page).nth(1), ar.tasks.form.assignee, 'ليان الأحمد');
  await addDesign.click();
  await rows(page).nth(2).getByLabel(ar.tasks.form.title).fill('ملفات الطباعة');
  await pick(page, rows(page).nth(2), ar.tasks.form.department, 'التصميم');
  await page.getByRole('button', { name: ar.tasks.wizard.subtasks.suggest }).click();
  await expect(page.getByText(ar.tasks.wizard.subtasks.suggested)).toBeVisible();
  // The preview draws two columns (rule C1).
  await expect(page.getByTestId('preview-lane')).toHaveCount(2);

  // Files: one chosen, one pasted (named as a screenshot), put on the design subtask.
  await next(page, 'files');
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'moodboard.png', mimeType: 'image/png', buffer: PNG });
  await page.evaluate(
    (bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    },
    [...PNG],
  );
  await expect(page.getByText('moodboard.png', { exact: true })).toBeVisible();
  const screenshotName = 'Screenshot 2026-10-10 09.00.00.png';
  await expect(page.getByText(screenshotName, { exact: true })).toBeVisible();
  await page
    .getByRole('combobox', { name: fill(ar.tasks.wizard.files.target, { name: screenshotName }) })
    .click();
  await page.getByRole('option', { name: 'تصميم صفحات المنيو' }).click();

  // Questions: one to Design.
  await next(page, 'questions');
  await page.getByRole('button', { name: ar.tasks.wizard.questions.add }).click();
  await pick(page, page.locator('form'), ar.tasks.questions.addressee, 'التصميم');
  const question = page.getByRole('textbox', { name: ar.tasks.questions.label });
  await question.click();
  await question.pressSequentially('ما المقاسات المطلوبة؟');

  // Review: the readiness warnings with where to fix them; they never block.
  await next(page, 'review');
  await expect(page.getByText(ar.tasks.wizard.review.warnings.brief_missing)).toBeVisible();
  await page.getByRole('button', { name: ar.tasks.form.create }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('تصاميم منيو الخريف');

  // One request (rule C2): stages, subtasks by stage, the files where they go, the question.
  const sent = api.created();
  expect(sent).toMatchObject({
    title: 'حملة منيو الشتاء',
    department: 'marketing',
    assigneeId: accountManagerMe.user.id,
    runMode: 'stages',
    stages: [{ name: 'النصوص' }, { name: 'التصميم' }],
    questions: [{ addressedDepartment: 'design' }],
  });
  expect(sent?.subtasks?.map((subtask) => [subtask.title, subtask.stageIndex])).toEqual([
    ['نصوص المنيو', 0],
    ['تصميم صفحات المنيو', 1],
    ['ملفات الطباعة', 1],
  ]);
  expect(sent?.subtasks?.[2]?.assigneeId).toBeNull();
  expect(sent?.files?.map((file) => [file.name, file.role])).toEqual([
    ['moodboard.png', 'reference'],
  ]);
  expect(sent?.subtasks?.[1]?.files?.map((file) => file.name)).toEqual([screenshotName]);
  expect(api.readinessChecks.at(-1)?.subtasks).toHaveLength(3);

  // The parent runs by stages: the copy stage handed over its note (rule A12).
  await expect(
    page.getByText('الأسماء معتمدة من المطعم، والأسعار تُضاف لاحقًا.').first(),
  ).toBeVisible();
  // The client asked for changes: only one delivered subtask is reopened (rule A10).
  await page.getByRole('button', { name: ar.tasks.subtasks.reopen }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: /تصميم صفحات المنيو/ }).click();
  await dialog.getByLabel(ar.tasks.subtasks.reopenNote).fill('تكبير صور الأطباق.');
  await dialog.getByRole('button', { name: /أعد فتح/ }).click();
  await expect(page.getByText(ar.tasks.subtasks.reopened)).toBeVisible();
  expect(f06b.sent.find((call) => call.path === '/subtasks/reopen')?.body).toEqual({
    items: [{ id: F06B_SUBTASKS.pages, note: 'تكبير صور الأطباق.' }],
  });
  // The draft is gone once saved.
  await page.goto('/tasks/new');
  await expect(page.getByText(ar.tasks.wizard.restored.title)).toBeHidden();
});

test('a reload keeps the draft, and Start over clears it', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto('/tasks/new');
  await page.getByLabel(ar.tasks.form.title).fill('مسودة لا تضيع');
  await next(page, 'subtasks');
  await page.getByRole('button', { name: ar.tasks.wizard.subtasks.add }).click();
  await rows(page).nth(0).getByLabel(ar.tasks.form.title).fill('خطوة أولى');
  // The draft is written a moment after the last change.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByText(ar.tasks.wizard.restored.title)).toBeVisible();
  await expect(rows(page).nth(0).getByLabel(ar.tasks.form.title)).toHaveValue('خطوة أولى');
  await page.getByRole('button', { name: ar.tasks.wizard.startOver }).click();
  await expect(page.getByLabel(ar.tasks.form.title)).toHaveValue('');
  await page.reload();
  await expect(page.getByText(ar.tasks.wizard.restored.title)).toBeHidden();
});

test('Create now confirms the readiness warnings before saving (rule C5)', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  const api = await mockF06bCreate(page, () => [{ subtaskIndex: null, code: 'brief_missing' }]);
  await mockF06b(page);
  await page.goto('/tasks/new');
  await basics(page, 'بانر سريع');
  await page.getByRole('button', { name: ar.tasks.wizard.createNow }).click();
  const confirm = page.getByRole('alertdialog', { name: ar.tasks.wizard.review.confirmTitle });
  await expect(confirm.getByText(ar.tasks.wizard.review.warnings.brief_missing)).toBeVisible();
  await confirm.getByRole('button', { name: ar.tasks.wizard.review.change }).click();
  expect(api.created()).toBeNull();
  await page.getByRole('button', { name: ar.tasks.wizard.createNow }).click();
  await confirm.getByRole('button', { name: ar.tasks.wizard.review.createAnyway }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('تصاميم منيو الخريف');
  expect(api.created()).toMatchObject({ title: 'بانر سريع', subtasks: [] });
});

test('a wrong brief field shows its error on the field (rule C7)', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto('/tasks/new');
  // Design is the account manager's own department: its brief fields show.
  await page.getByLabel(ar.tasks.brief.fields.colors).fill('red');
  await page.getByRole('button', { name: ar.tasks.wizard.createNow }).click();
  await expect(page.getByText(ar.tasks.briefFields.errors.colors)).toBeVisible();
});

test('starting from a task template fills every step with dates from the start day (rule D2)', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  const api = await mockF06bCreate(page);
  await mockF06b(page);
  await page.goto('/tasks/new');
  await page.getByRole('button', { name: ar.tasks.wizard.template.start }).click();
  const dialog = page.getByRole('dialog', { name: ar.tasks.wizard.template.title });
  await dialog.getByRole('radio', { name: /حملة سوشيال على مراحل/ }).click();
  await dialog.getByLabel(ar.tasks.wizard.template.startDate).fill('2026-10-12');
  await dialog.getByRole('button', { name: ar.tasks.wizard.template.apply }).click();
  await expect(page.getByText(ar.tasks.wizard.template.applied)).toBeVisible();
  await expect(page.getByLabel(ar.tasks.form.title)).toHaveValue('حملة الشتاء');
  // Work days from Monday the 12th, Fridays skipped: day 8 is the 20th.
  await expect(page.getByLabel(ar.tasks.form.dueDate)).toHaveValue('2026-10-20');
  await next(page, 'subtasks');
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByTestId('preview-lane')).toHaveCount(2);
  await page
    .getByRole('navigation', { name: ar.tasks.wizard.stepsLabel })
    .getByRole('button', { name: ar.tasks.wizard.steps.review })
    .click();
  // The root has no default assignee: it goes to Marketing's queue as a request.
  await page.getByRole('button', { name: ar.tasks.form.sendRequest }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('تصاميم منيو الخريف');
  expect(api.created()).toMatchObject({
    templateId: seedIds.socialTaskTemplate,
    runMode: 'stages',
    stages: [{ name: 'النصوص' }, { name: 'التصميم' }],
  });
  // The design default assignee applies where the user may assign (rule D2).
  expect(api.created()?.subtasks?.[1]?.assigneeId).toBe(accountManagerMe.user.id);
});

test('saving a task as a template from its menu (rule D1)', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await mockF06b(page);
  const api = await mockF06bSaveTemplate(page);
  await page.goto(`/tasks/${F06B_PARENT}`);
  await page.getByRole('button', { name: ar.tasks.actions.more }).click();
  await page.getByRole('menuitem', { name: ar.tasks.wizard.template.saveTitle }).click();
  const dialog = page.getByRole('dialog', { name: ar.tasks.wizard.template.saveTitle });
  await dialog.getByLabel(ar.templates.form.name).fill('منيو موسمي');
  await dialog.getByRole('switch', { name: ar.tasks.wizard.template.keepAssignees }).click();
  await dialog.getByRole('button', { name: ar.tasks.wizard.template.save }).click();
  await expect(
    page.getByText(fill(ar.tasks.wizard.template.saved, { name: 'منيو موسمي' })),
  ).toBeVisible();
  expect(api.sent()).toEqual({ name: 'منيو موسمي', description: null, keepAssignees: true });
});

test('the project tree highlights the bottleneck (rule D4)', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await mockF06bTree(page);
  await page.goto(`/projects/${seedIds.identityProject}?tab=tasks`);
  await page.getByRole('button', { name: ar.tasks.tree.tree }).click();
  const bottleneck = page.locator('[data-bottleneck]');
  await expect(bottleneck).toHaveCount(1);
  await expect(bottleneck.getByRole('link')).toHaveText('تصوير الأطباق');
  await expect(
    page.getByText(fill(ar.tasks.tree.waitsFor, { titles: 'تصوير الأطباق وتصميم صفحات المنيو' })),
  ).toBeVisible();
});

test('Workload shows estimated hours against capacity (rule C8)', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto('/tasks/workload');
  await expect(page.getByRole('columnheader', { name: ar.tasks.workload.hours })).toBeVisible();
  await expect(page.getByRole('meter').first()).toBeVisible();
});

test('the task template editor keeps the run mode and the sub-steps (rule D3)', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/templates/${seedIds.socialTaskTemplate}`);
  await expect(page.getByText(ar.templates.task.savedFrom)).toBeVisible();
  await page
    .getByRole('button', { name: fill(ar.templates.task.edit, { title: 'ريل الحملة' }) })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(ar.tasks.form.title).fill('ريل قصير للحملة');
  await dialog.getByRole('button', { name: ar.templates.task.apply, exact: true }).click();
  const saved = page.waitForRequest(
    (request) => request.method() === 'PUT' && request.url().includes('/api/templates/'),
  );
  await page.getByRole('button', { name: ar.templates.save }).click();
  const body = (await saved).postDataJSON();
  expect(body.runMode).toBe('stages');
  expect(body.steps.map((step: { title: string }) => step.title)).toEqual([
    'حملة الشتاء',
    'نصوص الحملة',
    'تصاميم الحملة',
    'ريل قصير للحملة',
  ]);
  expect(body.steps[3].parentKey).toBe(body.steps[0].key);
  await expect(page.getByText(ar.templates.saved)).toBeVisible();
});
