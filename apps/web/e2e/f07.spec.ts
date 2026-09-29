import { expect, type Page, test } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { employeeMe, mockApi, seedIds } from './fixtures';

// F07 template screens against the mocked API (the real rules are covered by apps/api/test).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

/** Adds a step through the step dialog. */
async function addStep(
  page: Page,
  button: string,
  step: { title: string; department: string; day: string; dependsOn?: string },
) {
  await page.getByRole('button', { name: button }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(ar.templates.step.title).fill(step.title);
  await dialog.getByRole('combobox', { name: ar.templates.step.department }).click();
  await page.getByRole('option', { name: step.department }).click();
  await dialog.getByLabel(ar.templates.step.dueDay).fill(step.day);
  if (step.dependsOn) {
    await dialog.getByLabel(new RegExp(ar.templates.step.dependsOn)).fill(step.dependsOn);
    await page.getByRole('option', { name: step.dependsOn }).click();
  }
  await dialog.getByRole('button', { name: ar.templates.step.add }).click();
  await expect(dialog).toBeHidden();
}

test('create a project template, edit it, archive and restore it', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: ar.nav.label })
    .getByRole('link', { name: ar.nav.templates })
    .click();
  await expect(page.getByRole('link', { name: 'موقع إلكتروني' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'دورة السوشيال ميديا الشهرية' })).toBeVisible();

  await page.getByRole('link', { name: ar.templates.newTemplate }).click();
  await page.getByLabel(ar.templates.form.name).fill('شعار سريع');
  await page.getByRole('button', { name: ar.templates.addStage }).click();
  await page.getByLabel(fill(ar.templates.stageName, { position: '1' })).fill('التصميم');
  const addToStage = fill(ar.templates.addStepTo, { stage: 'التصميم' });
  await addStep(page, addToStage, { title: 'مسودات الشعار', department: 'التصميم', day: '3' });
  await addStep(page, addToStage, {
    title: 'الشعار النهائي',
    department: 'التصميم',
    day: '6',
    dependsOn: 'مسودات الشعار',
  });
  await expect(
    page.getByText(fill(ar.templates.waitsOn, { titles: 'مسودات الشعار' })),
  ).toBeVisible();

  // Moving a step above the one it waits on points at the step (rule 2).
  await page
    .getByRole('button', { name: fill(ar.templates.stepActions, { title: 'الشعار النهائي' }) })
    .click();
  await page.getByRole('menuitem', { name: ar.templates.moveUp }).click();
  await expect(page.getByText(ar.templates.step.errors.laterDependency)).toBeVisible();
  await page
    .getByRole('button', { name: fill(ar.templates.stepActions, { title: 'الشعار النهائي' }) })
    .click();
  await page.getByRole('menuitem', { name: ar.templates.moveDown }).click();
  await expect(page.getByText(ar.templates.step.errors.laterDependency)).toBeHidden();

  // A default assignee for the department the steps use.
  await page.getByRole('combobox', { name: 'التصميم', exact: true }).click();
  await page.getByRole('option', { name: /ليان الأحمد/ }).click();
  await page.getByRole('button', { name: ar.templates.form.create }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText('شعار سريع');
  await expect(page.getByText(ar.templates.new.created)).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'التصميم', exact: true })).toContainText(
    'ليان الأحمد',
  );

  // Edit and save the whole document again.
  await page.getByLabel(ar.templates.form.name).fill('شعار سريع للمطاعم');
  await expect(page.getByText(ar.templates.unsaved)).toBeVisible();
  await page.getByRole('button', { name: ar.templates.save }).click();
  await expect(page.getByText(ar.templates.saved)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('شعار سريع للمطاعم');

  await page.getByRole('button', { name: ar.templates.archive }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: ar.templates.archive }).click();
  await expect(page.getByText(ar.templates.archivedTitle)).toBeVisible();
  await expect(page.getByRole('button', { name: ar.templates.save })).toBeHidden();

  await page.getByRole('button', { name: ar.templates.restore }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: ar.templates.restore }).click();
  await expect(page.getByText(ar.templates.archivedTitle)).toBeHidden();
  await expect(page.getByRole('button', { name: ar.templates.archive })).toBeVisible();
});

test('a monthly template lists repeated steps and warns about an invalid default', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true });
  await page.goto(`/templates/${seedIds.monthlyTemplate}`);
  await expect(
    page.getByRole('heading', { level: 3, name: ar.templates.repeatedSteps }),
  ).toBeVisible();
  await expect(
    page.getByText(fill(ar.templates.perUnit, { kind: ar.retainers.kinds.design })),
  ).toBeVisible();
  await expect(page.getByText(ar.templates.warningsTitle)).toBeVisible();
  await expect(
    page.getByText(fill(ar.templates.invalidAssignee, { name: 'باسل يوسف' })),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'إدارة السوشيال ميديا' })).toBeVisible();
});

test('an employee reads templates without editing them', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/');
  // Reachable by everyone, listed for the people who apply or maintain templates.
  await expect(
    page
      .getByRole('navigation', { name: ar.nav.label })
      .getByRole('link', { name: ar.nav.templates }),
  ).toBeHidden();

  await page.goto('/templates');
  await expect(page.getByRole('link', { name: ar.templates.newTemplate })).toBeHidden();
  await page.getByRole('link', { name: 'موقع إلكتروني' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('موقع إلكتروني');
  await expect(page.getByRole('heading', { name: 'تصميم الواجهات' })).toBeVisible();
  await expect(page.getByText('ليان الأحمد')).toBeVisible();
  await expect(page.getByRole('button', { name: ar.templates.addStep })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ar.templates.save })).toBeHidden();
  await expect(page.getByRole('button', { name: ar.templates.archive })).toBeHidden();
});
