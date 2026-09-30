import type { Page } from '@playwright/test';
import type { MeResponse } from '@vertex-hub/contracts';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  accountManagerMe,
  employeeMe,
  manager,
  mockApi,
  PROJECTS_TODAY,
  seedIds,
} from './fixtures';
import { expect, test } from './test';

// F10 task files against the mocked API (the real rules are covered by apps/api/test/files.test.ts).

async function onTasksToday(page: Page) {
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
}

const filesSection = (page: Page) =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: ar.tasks.files.title }) });

const deliverable = (page: Page, name: string) =>
  filesSection(page)
    .getByRole('listitem')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();

const file = (name: string, mimeType: string) => ({
  name,
  mimeType,
  buffer: Buffer.from(`${name} content`),
});

test('references and deliverables: upload, link, new version, preview, remove a version', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await onTasksToday(page);
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto(`/tasks/${seedIds.autumnMenu}`);
  const section = filesSection(page);
  await expect(deliverable(page, 'غلاف المنيو').getByText('v2', { exact: true })).toBeVisible();

  // Two references at once: the executable is refused in place, the image is attached.
  await section.getByRole('button', { name: ar.tasks.files.addReferences }).click();
  let dialog = page.getByRole('dialog', { name: ar.tasks.files.addReferencesTitle });
  await dialog
    .locator('input[type=file]')
    .setInputFiles([
      file('moodboard.png', 'image/png'),
      file('setup.exe', 'application/x-msdownload'),
    ]);
  await expect(dialog.getByRole('alert')).toHaveText(ar.errors.FILE_TYPE_BLOCKED);
  await expect(dialog.getByText('moodboard.png')).toBeHidden();
  await dialog.getByRole('button', { name: 'تجاهل setup.exe' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(ar.files.added)).toBeVisible();
  await expect(section.getByText('moodboard', { exact: true })).toBeVisible();

  // A deliverable as a link.
  await section.getByRole('button', { name: ar.tasks.files.addDeliverable }).click();
  dialog = page.getByRole('dialog', { name: ar.tasks.files.addDeliverableTitle });
  await dialog.getByRole('tab', { name: ar.files.upload.linkTab }).click();
  await dialog.getByLabel(ar.files.upload.url).fill('https://drive.google.com/file/d/poster');
  await dialog.getByLabel(ar.files.upload.label).fill('بوستر الإطلاق');
  await dialog.getByRole('button', { name: ar.files.upload.addLink }).click();
  await expect(dialog).toBeHidden();
  await expect(deliverable(page, 'بوستر الإطلاق')).toBeVisible();

  // v3 of the cover, with a note.
  const cover = deliverable(page, 'غلاف المنيو');
  await cover.getByRole('button', { name: 'إجراءات غلاف المنيو' }).click();
  await page.getByRole('menuitem', { name: ar.files.newVersion }).click();
  dialog = page.getByRole('dialog', { name: 'إصدار جديد من «غلاف المنيو»' });
  await dialog.getByLabel(ar.files.note).fill('تكبير الشعار');
  await dialog.locator('input[type=file]').setInputFiles(file('menu-cover-v3.png', 'image/png'));
  await expect(dialog).toBeHidden();
  await expect(page.getByText(ar.files.versionAdded)).toBeVisible();
  await expect(cover.getByText('v3', { exact: true })).toBeVisible();
  await expect(cover.getByText('تكبير الشعار')).toBeVisible();

  // The history lists every version; the oldest is removed.
  await cover.getByRole('button', { name: '3 إصدارات' }).click();
  const v1 = cover.getByRole('listitem').filter({ has: page.getByText('v1', { exact: true }) });
  await v1.getByRole('button', { name: 'أزل غلاف المنيو v1' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: ar.files.removeAction }).click();
  await expect(page.getByText(ar.files.removedDone)).toBeVisible();
  await expect(v1).toBeHidden();

  // References preview in turn; the arrow keys follow the reading direction.
  await section.getByRole('button', { name: 'عاين دليل الهوية' }).click();
  await expect(page.getByRole('dialog', { name: 'دليل الهوية' }).locator('iframe')).toHaveAttribute(
    'title',
    'دليل الهوية',
  );
  await page.keyboard.press('ArrowLeft');
  dialog = page.getByRole('dialog', { name: 'صور الأطباق' });
  await expect(dialog.getByRole('img', { name: 'صور الأطباق' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('a delivered task is read-only for files; managers still move the final marker', async ({
  page,
}) => {
  await onTasksToday(page);
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/tasks/${seedIds.octoberCover}`);
  const section = filesSection(page);
  await expect(section.getByText(ar.tasks.files.closedHint)).toBeVisible();
  await expect(section.getByRole('button', { name: ar.tasks.files.addDeliverable })).toBeHidden();
  await expect(section.getByRole('button', { name: ar.tasks.files.addReferences })).toBeHidden();

  const cover = deliverable(page, 'غلاف أكتوبر');
  await expect(cover.getByRole('button', { name: 'إجراءات غلاف أكتوبر' })).toBeHidden();
  await cover.getByRole('button', { name: ar.files.versions_two }).click();
  const row = (number: number) =>
    cover.getByRole('listitem').filter({ has: page.getByText(`v${number}`, { exact: true }) });
  await expect(row(2).getByText(ar.files.finalAuto)).toBeVisible();

  await row(1).getByRole('button', { name: ar.files.markFinal }).click();
  await expect(page.getByText('صار v1 هو النهائي')).toBeVisible();
  await expect(row(1).getByText('بيد سارة الخطيب')).toBeVisible();
  await expect(cover.getByText('النهائي: v1')).toBeVisible();
  await expect(row(2).getByRole('button', { name: ar.files.markFinal })).toBeVisible();
});

test('everyone adds references; only task workers and managers change deliverables', async ({
  page,
}) => {
  await onTasksToday(page);
  // A designer who is neither the assignee nor a manager of the task.
  const designer: MeResponse = {
    ...employeeMe,
    user: { id: seedIds.basel, name: 'باسل يوسف', email: 'basel@vertex.example', image: null },
  };
  await mockApi(page, { signedIn: true, me: designer });
  await page.goto(`/tasks/${seedIds.autumnMenu}`);
  const section = filesSection(page);
  await expect(deliverable(page, 'غلاف المنيو')).toBeVisible();
  await expect(section.getByRole('button', { name: ar.tasks.files.addReferences })).toBeVisible();
  await expect(section.getByRole('button', { name: ar.tasks.files.addDeliverable })).toBeHidden();
  await expect(section.getByRole('button', { name: 'إجراءات غلاف المنيو' })).toBeHidden();
  await expect(section.getByText(ar.files.showRemoved)).toBeHidden();
  await expect(section.getByRole('link', { name: 'نزّل صور الأطباق' })).toHaveAttribute(
    'href',
    /\/api\/files\/versions\/.+\/content\?download=1$/,
  );
});
