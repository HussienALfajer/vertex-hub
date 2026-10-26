import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { F06B_PARENT, F06B_SUBTASKS, mockF06b } from './f06b-fixtures';
import { accountManagerMe, mockApi, PROJECTS_TODAY } from './fixtures';
import { expect, test } from './test';

// F06B on the task page against the mocked API (the rules are covered by apps/api/test).

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1800 });
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
  await mockApi(page, { signedIn: true, me: accountManagerMe });
});

test('the parent shows its stages, timeline, handover and what holds its submit', async ({
  page,
}) => {
  await mockF06b(page);
  await page.goto(`/tasks/${F06B_PARENT}`);
  const subtasks = page.locator('section', {
    has: page.getByRole('heading', { name: ar.tasks.subtasks.title, exact: true }),
  });
  // Rule A3: three stages, the first finished with its handover summary (rule A12).
  await expect(subtasks.getByRole('heading', { name: 'المرحلة 1: النصوص' })).toBeVisible();
  await expect(
    subtasks.getByText('الأسماء معتمدة من المطعم، والأسعار تُضاف لاحقًا.').first(),
  ).toBeVisible();
  // The timeline: the print files wait for the two design-stage subtasks.
  await expect(subtasks.getByText(/ينتظر: تصوير الأطباق، تصميم صفحات المنيو/)).toBeVisible();
  // Rules A8 and C6, said before the submit button is pressed.
  await expect(page.getByText(/بقي 1 من معايير القبول/)).toBeVisible();
  await expect(page.getByText(/بقيت 3 من المهام الفرعية/)).toBeVisible();
  // The brief's fields (rule C7).
  await expect(page.getByText('A4 · 1080 × 1350')).toBeVisible();
});

test('a question to a department, and the open-questions filter', async ({ page }) => {
  const api = await mockF06b(page);
  await page.goto(`/tasks/${F06B_PARENT}`);
  await page.getByRole('button', { name: ar.tasks.thread.ask, exact: true }).click();
  // Sending without an addressee asks for one first.
  const editor = page.getByRole('textbox', { name: ar.tasks.questions.label });
  await editor.click();
  await editor.pressSequentially('هل نطبع على ورق مطفي؟');
  await page.getByRole('button', { name: ar.tasks.thread.askAction }).click();
  await expect(page.getByText(ar.tasks.questions.errors.addressee)).toBeVisible();
  await page.getByRole('combobox', { name: ar.tasks.questions.addressee }).click();
  await page.getByRole('option', { name: 'التصميم' }).click();
  await page.getByRole('button', { name: ar.tasks.thread.askAction }).click();
  await expect(page.getByText(ar.tasks.questions.asked)).toBeVisible();
  const asked = api.sent.find((call) => call.path === '/questions');
  expect(asked?.body).toMatchObject({ addressedDepartment: 'design', files: [] });

  // The filter shows the open questions only.
  await page.getByRole('button', { name: ar.tasks.thread.openQuestions }).click();
  await expect(page.getByText('هل صُوّرت أطباق الحلويات؟')).toBeHidden();
  await expect(page.getByText('ما المقاسات المطلوبة لنسخة إنستغرام من المنيو؟')).toBeVisible();
});

test('reopening one delivered subtask with a note (rule A10)', async ({ page }) => {
  const api = await mockF06b(page, 'revisions');
  await page.goto(`/tasks/${F06B_PARENT}`);
  await page.getByRole('button', { name: ar.tasks.subtasks.reopen }).click();
  const dialog = page.getByRole('dialog');
  // A pick without a note is refused.
  await dialog.getByRole('checkbox', { name: /تصميم صفحات المنيو/ }).click();
  await dialog.getByRole('button', { name: /أعد فتح/ }).click();
  await expect(dialog.getByText(ar.tasks.subtasks.errors.reopenNote)).toBeVisible();
  await dialog.getByLabel(ar.tasks.subtasks.reopenNote).fill('تكبير صور الأطباق.');
  await dialog.getByRole('button', { name: /أعد فتح/ }).click();
  await expect(page.getByText(ar.tasks.subtasks.reopened)).toBeVisible();
  expect(api.sent.find((call) => call.path === '/subtasks/reopen')?.body).toEqual({
    items: [{ id: F06B_SUBTASKS.pages, note: 'تكبير صور الأطباق.' }],
  });
});

test('changing the run mode (rule A4)', async ({ page }) => {
  const api = await mockF06b(page);
  await page.goto(`/tasks/${F06B_PARENT}`);
  await page.getByRole('button', { name: ar.tasks.subtasks.runModes.sequential }).click();
  await expect(page.getByText(ar.tasks.subtasks.runModeChanged)).toBeVisible();
  expect(api.sent.find((call) => call.path === '/run-mode')?.body).toEqual({
    runMode: 'sequential',
  });
});
