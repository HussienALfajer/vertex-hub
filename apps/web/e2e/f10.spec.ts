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
// Client, project and retainer files (screens 4 and 5).

const docCard = (page: Page, name: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();

test('the client Files tab: library filters in the URL, documents, a confidential upload', async ({
  page,
}) => {
  await onTasksToday(page);
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto(`/clients/${seedIds.jasmine}?tab=files`);

  // Final deliverables of the client's tasks: an image and a link.
  await expect(page.getByRole('button', { name: 'عاين غلاف أكتوبر' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'عاين فيديو أكتوبر' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'غلاف فيسبوك لشهر أكتوبر' }).first()).toBeVisible();
  await page.getByRole('combobox', { name: ar.files.library.type }).click();
  await page.getByRole('option', { name: ar.files.types.image }).click();
  await expect(page).toHaveURL(/fileType=image/);
  await expect(page.getByRole('button', { name: 'عاين فيديو أكتوبر' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'عاين غلاف أكتوبر' })).toBeVisible();

  // The account manager reads the confidential contract; documents name their owner.
  await expect(docCard(page, 'عقد الخدمات 2026').getByText(ar.files.confidential)).toBeVisible();
  await expect(page.getByRole('link', { name: 'مشروع: الهوية البصرية الجديدة' })).toHaveAttribute(
    'href',
    /\/projects\/.+\?tab=documents$/,
  );
  await expect(page.getByRole('link', { name: 'عقد شهري: إدارة السوشيال ميديا' })).toBeVisible();

  await page.getByRole('button', { name: ar.files.documents.upload }).click();
  const dialog = page.getByRole('dialog', { name: ar.files.documents.uploadTitle });
  await dialog.getByRole('checkbox', { name: new RegExp(ar.files.confidentialChoice) }).check();
  await dialog.locator('input[type=file]').setInputFiles(file('nda.pdf', 'application/pdf'));
  await expect(dialog).toBeHidden();
  await expect(docCard(page, 'nda').getByText(ar.files.confidential)).toBeVisible();
  // The usage line is for scope-all holders only.
  await expect(page.getByText(/ملفات هذا العميل/)).toBeHidden();
});

test('confidential documents do not exist for other users', async ({ page }) => {
  await onTasksToday(page);
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto(`/clients/${seedIds.jasmine}?tab=files`);
  await expect(docCard(page, 'عرض السعر')).toBeVisible();
  await expect(page.getByText('عقد الخدمات 2026')).toBeHidden();
  await expect(page.getByRole('button', { name: ar.files.documents.upload })).toBeHidden();
});

test('scope-all users see the usage line, remove and restore a document', async ({ page }) => {
  await onTasksToday(page);
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/clients/${seedIds.jasmine}?tab=files`);
  await expect(page.getByText(/ملفات هذا العميل .+ · كل الملفات .+ · المتاح 150/)).toBeVisible();

  // A replaced version is removed, then found and restored with "Show removed".
  const quote = docCard(page, 'عرض السعر');
  await quote.getByRole('button', { name: 'إجراءات عرض السعر' }).click();
  await page.getByRole('menuitem', { name: ar.files.newVersion }).click();
  const dialog = page.getByRole('dialog', { name: 'إصدار جديد من «عرض السعر»' });
  await dialog.locator('input[type=file]').setInputFiles(file('quote-v2.pdf', 'application/pdf'));
  await expect(dialog).toBeHidden();
  await quote.getByRole('button', { name: ar.files.versions_two }).click();
  await quote.getByRole('button', { name: 'أزل عرض السعر v1' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: ar.files.removeAction }).click();
  await expect(page.getByText(ar.files.removedDone)).toBeVisible();
  await expect(quote.getByText('v1', { exact: true })).toBeHidden();
  const showRemoved = page.getByRole('switch', { name: ar.files.showRemoved });
  await showRemoved.click();
  const v1 = quote.getByRole('listitem').filter({ has: page.getByText('v1', { exact: true }) });
  await v1.getByRole('button', { name: ar.files.restore }).click();
  await expect(page.getByText(ar.files.restoredDone)).toBeVisible();
  await expect(v1.getByText(ar.files.removed, { exact: true })).toBeHidden();
  await showRemoved.click();

  // The whole document.
  await quote.getByRole('button', { name: 'إجراءات عرض السعر' }).click();
  await page.getByRole('menuitem', { name: ar.files.remove }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: ar.files.removeAction }).click();
  // Earlier toasts may still show.
  await expect(page.getByText(ar.files.removedDone).last()).toBeVisible();
  await expect(docCard(page, 'عرض السعر')).toBeHidden();

  await showRemoved.click();
  const removed = docCard(page, 'عرض السعر');
  await expect(removed.getByText(ar.files.removed, { exact: true })).toBeVisible();
  await removed.getByRole('button', { name: ar.files.restore }).click();
  await expect(page.getByText(ar.files.restoredDone).last()).toBeVisible();
});

test('brand kit: uploaded files by kind, a new logo version, a font upload', async ({ page }) => {
  await onTasksToday(page);
  await mockApi(page, { signedIn: true, me: accountManagerMe });
  await page.goto(`/clients/${seedIds.jasmine}?tab=brand-kit`);
  const logo = docCard(page, 'شعار الياسمين');
  await expect(logo.getByText('v2', { exact: true })).toBeVisible();
  await logo.getByRole('button', { name: ar.files.versions_two }).click();
  await expect(logo.getByText('v1', { exact: true })).toBeVisible();

  await logo.getByRole('button', { name: 'إجراءات شعار الياسمين' }).click();
  await page.getByRole('menuitem', { name: ar.files.newVersion }).click();
  let dialog = page.getByRole('dialog', { name: 'إصدار جديد من «شعار الياسمين»' });
  await dialog.locator('input[type=file]').setInputFiles(file('logo-2027.png', 'image/png'));
  await expect(dialog).toBeHidden();
  await expect(logo.getByText('v3', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: ar.files.brand.upload }).click();
  dialog = page.getByRole('dialog', { name: ar.files.brand.uploadTitle });
  await dialog.getByRole('combobox', { name: ar.files.brandKind }).click();
  await page.getByRole('option', { name: ar.clients.brandKit.fileKinds.font }).click();
  await dialog.locator('input[type=file]').setInputFiles(file('jasmine-sans.otf', 'font/otf'));
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('heading', { level: 3, name: ar.clients.brandKit.fileKinds.font }),
  ).toBeVisible();
  await expect(docCard(page, 'jasmine-sans')).toBeVisible();
});

test('a project manager adds a project document but cannot make it confidential', async ({
  page,
}) => {
  await onTasksToday(page);
  // Karim manages the visual identity project.
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto(`/projects/${seedIds.identityProject}?tab=documents`);
  await expect(docCard(page, 'محضر انطلاق المشروع')).toBeVisible();
  await page.getByRole('button', { name: ar.files.documents.upload }).click();
  const dialog = page.getByRole('dialog', { name: ar.files.documents.uploadTitle });
  await expect(dialog.getByRole('checkbox')).toBeHidden();
  await dialog.locator('input[type=file]').setInputFiles(file('handover.pdf', 'application/pdf'));
  await expect(dialog).toBeHidden();
  const handover = docCard(page, 'handover');
  await handover.getByRole('button', { name: 'إجراءات handover' }).click();
  await expect(page.getByRole('menuitem', { name: ar.files.rename })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: ar.files.makeConfidential })).toBeHidden();
});

test('the retainer Documents tab lists its documents', async ({ page }) => {
  await onTasksToday(page);
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto(`/retainers/${seedIds.socialRetainer}?tab=documents`);
  await expect(docCard(page, 'ملحق العقد الشهري')).toBeVisible();
  await expect(page.getByRole('button', { name: ar.files.documents.upload })).toBeHidden();
});

test('the audit log links file entries to their owner', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/audit');
  const version = page
    .getByRole('listitem')
    .filter({ hasText: ar.audit.actions.file_version.created });
  await version.getByRole('button', { name: ar.audit.showDetails }).click();
  await expect(version.getByRole('cell', { name: ar.files.versionKinds.upload })).toBeVisible();
  await expect(version.getByRole('cell', { name: 'v2' })).toBeVisible();
  await expect(version.getByRole('link', { name: ar.audit.openTask })).toHaveAttribute(
    'href',
    `/tasks/${seedIds.autumnMenu}`,
  );
  const logo = page.getByRole('listitem').filter({ hasText: ar.audit.actions.file_item.created });
  await logo.getByRole('link', { name: 'شعار الياسمين في مطعم الياسمين' }).click();
  await expect(page).toHaveURL(/tab=brand-kit/);
});
