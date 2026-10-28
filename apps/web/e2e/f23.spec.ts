import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  departmentManagerMe,
  departmentsSeed,
  employeeMe,
  mockApi,
  operationsManagerMe,
  seedIds,
} from './fixtures';
import { expect, pickOption, test } from './test';

// F23 flows against the mocked API (the real rules are covered by apps/api/test).

const department = (code: (typeof departmentsSeed)[number]['code']) => {
  const found = departmentsSeed.find((d) => d.code === code);
  if (!found) throw new Error(code);
  return found;
};

const targetOf = (category: string) =>
  ar.departments.archive.targetOf.replace('{{category}}', category);

test('the General Manager reorders the departments', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/departments');
  const cards = page.getByRole('main').getByRole('heading', { level: 2 });
  await expect(cards.first()).toHaveText('الإدارة العامة');

  await page.getByRole('button', { name: ar.departments.reorder.start }).click();
  await page.getByRole('button', { name: 'انقل العمليات الداخلية إلى الأعلى' }).click();
  const saved = page.waitForRequest(
    (request) => request.url().endsWith('/api/departments/order') && request.method() === 'PUT',
  );
  await page.getByRole('button', { name: ar.departments.reorder.save }).click();
  const { ids } = (await saved).postDataJSON() as { ids: string[] };
  expect(ids.slice(0, 2)).toEqual([
    department('internal_operations').id,
    department('general_management').id,
  ]);
  await expect(page.getByText(ar.departments.reorder.saved)).toBeVisible();
  await expect(cards.first()).toHaveText('العمليات الداخلية');
});

test('the General Manager creates a department and manages its members', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/departments');
  await page.getByRole('button', { name: ar.departments.create.open }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(ar.departments.detail.name).fill('التصميم');
  await dialog.getByLabel(ar.departments.detail.description).fill('تصوير الفيديو ومونتاجه.');
  await dialog.getByRole('radio', { name: ar.departments.colors.c3 }).click();
  await dialog.getByRole('radio', { name: ar.departments.icons.film }).click();
  await dialog.getByRole('button', { name: ar.departments.create.submit }).click();
  // Names are unique regardless of case (rule 3): the field says so.
  await expect(dialog.getByText(ar.errors.DEPARTMENT_NAME_TAKEN)).toBeVisible();
  await dialog.getByLabel(ar.departments.detail.name).fill('إنتاج الفيديو');
  await dialog.getByRole('button', { name: ar.departments.create.submit }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('إنتاج الفيديو');
  await expect(page.getByText(ar.departments.detail.noMembers)).toBeVisible();

  // What it grants: a new department grants nothing (rule 27).
  await page.getByRole('tab', { name: ar.departments.detail.tabs.grants }).click();
  await expect(page.getByText(ar.departments.grants.none)).toBeVisible();

  // Members: add two (rule 17), make one primary (rule 18), remove the other (rule 20).
  await page.getByRole('tab', { name: ar.departments.detail.tabs.members }).click();
  await page.getByRole('button', { name: ar.departments.members.add }).click();
  const add = page.getByRole('dialog');
  const people = add.getByRole('combobox', { name: ar.departments.members.people });
  await people.fill('كريم');
  await page.getByRole('option', { name: 'كريم الزين' }).click();
  await people.fill('نور');
  await page.getByRole('option', { name: 'نور السيد' }).click();
  await add.getByRole('button', { name: ar.departments.members.addSubmit, exact: true }).click();
  await expect(page.getByText('أُضيف عضوان')).toBeVisible();

  const karim = page.getByRole('listitem').filter({ hasText: 'كريم الزين' });
  await expect(karim.getByText(ar.departments.detail.secondary)).toBeVisible();
  await page.getByRole('button', { name: 'إجراءات كريم الزين' }).click();
  await page.getByRole('menuitem', { name: ar.departments.members.makePrimary }).click();
  await expect(karim.getByText(ar.departments.detail.primary, { exact: true })).toBeVisible();
  // A primary membership is never removed: the menu says why.
  await page.getByRole('button', { name: 'إجراءات كريم الزين' }).click();
  await expect(page.getByRole('menuitem', { name: ar.departments.members.remove })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.getByText(ar.departments.members.primaryLocked)).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'إجراءات نور السيد' }).click();
  await page.getByRole('menuitem', { name: ar.departments.members.remove }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: ar.departments.members.remove })
    .click();
  await expect(page.getByRole('listitem').filter({ hasText: 'نور السيد' })).toHaveCount(0);
});

test('the archive wizard moves a department’s work, and restore brings it back', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await mockApi(page, { signedIn: true });
  await page.goto(`/departments/${seedIds.design}`);
  await page.getByRole('button', { name: ar.departments.archive.open }).click();
  const wizard = page.getByRole('dialog');
  // One row per non-empty category, each with its target picker (rule 8).
  await expect(
    wizard.getByLabel(targetOf(ar.departments.archive.categories.members)),
  ).toBeVisible();
  await expect(wizard.getByLabel(targetOf(ar.departments.archive.categories.tasks))).toBeVisible();

  // Nothing chosen: every non-empty category needs a target (rule 9).
  await wizard.getByRole('button', { name: ar.common.next }).click();
  await expect(wizard.getByText(ar.errors.TRANSFER_TARGET_REQUIRED)).toBeVisible();

  await pickOption(page, wizard.getByLabel(ar.departments.archive.everything), 'التسويق');
  await pickOption(
    page,
    wizard.getByLabel(targetOf(ar.departments.archive.categories.services)),
    'التصوير',
  );
  await wizard.getByRole('button', { name: ar.common.next }).click();
  await expect(wizard.getByText(/تنتقل إلى التصوير/)).toBeVisible();
  const archived = page.waitForRequest((request) => request.url().endsWith('/archive'));
  await wizard.getByRole('button', { name: ar.departments.archive.submit }).click();
  const { targets } = (await archived).postDataJSON() as { targets: Record<string, string> };
  expect(targets.services).toBe(department('photography').id);
  expect(targets.members).toBe(department('marketing').id);

  await expect(
    page.getByText(ar.departments.archive.done.replace('{{name}}', 'التصميم')),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ar.departments.archivedBadge);
  // Rule 26: no overview while archived.
  await expect(page.getByRole('tab', { name: ar.departments.detail.tabs.overview })).toHaveCount(0);

  // The list's archived view shows it; restoring brings it back last (rule 16).
  // In the app: a reload would restore the list kept on the device (F16 rule A5).
  await page.getByRole('main').getByRole('link', { name: ar.departments.detail.back }).click();
  await page.getByRole('button', { name: ar.departments.archived }).click();
  await expect(
    page.getByRole('main').getByRole('heading', { level: 2, name: 'التصميم', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('main')
    .getByRole('heading', { level: 2, name: 'التصميم', exact: true })
    .click();
  await page.getByRole('button', { name: ar.departments.restore.open }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: ar.departments.restore.confirm })
    .click();
  await expect(page.getByText(ar.departments.restore.done)).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: ar.departments.detail.back }).click();
  await page.getByRole('button', { name: ar.departments.active }).click();
  await expect(page.getByRole('main').getByRole('heading', { level: 2 }).last()).toHaveText(
    'التصميم',
  );
});

test('a system department lists what it grants and its functions', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto(`/departments/${department('internal_operations').id}?tab=grants`);
  await expect(page.getByText(ar.permissions.users.manage)).toBeVisible();
  await expect(page.getByText(ar.departments.functions.escalations)).toBeVisible();
});

test('the Operations manager edits departments but neither creates nor archives', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: operationsManagerMe });
  await page.goto('/departments');
  await expect(page.getByRole('button', { name: ar.departments.reorder.start })).toBeVisible();
  await expect(page.getByRole('button', { name: ar.departments.create.open })).toHaveCount(0);
  await page.goto(`/departments/${seedIds.design}`);
  await expect(page.getByRole('button', { name: ar.common.edit, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: ar.departments.archive.open })).toHaveCount(0);
});

test('the overview shows the workload to the department’s manager only', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: departmentManagerMe });
  await page.goto(`/departments/${seedIds.design}`);
  await expect(page.getByText(ar.departments.overview.workload)).toBeVisible();
});

test('an employee sees the counts, without workload, history or edits', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto(`/departments/${seedIds.design}`);
  await expect(page.getByText(ar.departments.overview.overdue)).toBeVisible();
  await expect(page.getByText(ar.departments.overview.workload)).toHaveCount(0);
  await expect(page.getByRole('tab', { name: ar.departments.detail.tabs.history })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ar.common.edit, exact: true })).toHaveCount(0);
});
