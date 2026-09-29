import { expect, type Page, test } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { employeeMe, mockApi, PROJECTS_TODAY, seedIds } from './fixtures';

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

/** Arabic plural forms the way i18next picks them (`ar` rules), for counted strings. */
function counted(forms: object, key: string, n: number, values = {}) {
  const rule = new Intl.PluralRules('ar').select(n);
  return fill((forms as Record<string, string>)[`${key}_${rule}`] as string, {
    n: String(n),
    ...values,
  });
}

test('create a project from the Website template and generate its tasks', async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
  await mockApi(page, { signedIn: true });
  await page.goto(`/projects/new?clientId=${seedIds.jasmine}`);
  await page.getByLabel(ar.projects.form.name).fill('موقع الحجوزات');
  await page.getByRole('combobox', { name: ar.projects.form.projectManager }).click();
  await page.getByRole('option', { name: /كريم الزين/ }).click();
  const departments = page.getByLabel(ar.projects.form.departments);
  await departments.fill('التطوير');
  await page.getByRole('option', { name: 'التطوير' }).click();
  await page.getByLabel(ar.projects.form.dueDate).fill('2026-12-20');

  // The template's stages replace the milestones, due on work days from the start (rule 7).
  await page.getByRole('combobox', { name: ar.templates.picker.project }).click();
  await page.getByRole('option', { name: 'موقع إلكتروني' }).click();
  const due = (position: number) =>
    page.getByLabel(fill(ar.projects.form.milestoneDue, { position: String(position) }));
  await expect(due(1)).toHaveValue('2026-10-14');
  await expect(due(5)).toHaveValue('2026-11-15');
  // They follow the start date: a week later, a week later.
  await page.getByLabel(ar.projects.form.startDate).fill('2026-10-17');
  await expect(due(1)).toHaveValue('2026-10-21');
  await page.getByLabel(ar.projects.form.startDate).fill(PROJECTS_TODAY);
  await expect(due(1)).toHaveValue('2026-10-14');
  await page.getByRole('button', { name: ar.projects.form.create }).click();

  // The project opens on its Tasks tab with the generate dialog and the template's plan.
  const dialog = page.getByRole('dialog', {
    name: fill(ar.templates.generate.projectTitle, { name: 'موقع الحجوزات' }),
  });
  await expect(dialog).toBeVisible();
  const preview = dialog.getByRole('region', { name: ar.templates.generate.preview });
  await expect(preview.getByRole('heading', { name: 'الاستكشاف' })).toBeVisible();
  await expect(preview.getByText(ar.templates.generate.milestone.existing).first()).toBeVisible();
  await expect(
    preview.getByText(fill(ar.templates.waitsOn, { titles: 'المخططات الأولية' })),
  ).toBeVisible();
  // Design tasks go to the department queue for this run only.
  const designer = dialog.getByRole('combobox', { name: 'التصميم', exact: true });
  await expect(designer).toContainText('ليان الأحمد');
  await designer.click();
  await page.getByRole('option', { name: ar.templates.departmentQueue }).click();
  await expect(designer).toContainText(ar.templates.departmentQueue);
  await expect(preview.getByText('ليان الأحمد')).toHaveCount(0);
  await dialog.getByRole('button', { name: counted(ar.templates.generate, 'submit', 10) }).click();

  await expect(page.getByText(counted(ar.templates.generate, 'done', 10))).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('list', { name: ar.templates.runs.title })).toContainText(
    'موقع إلكتروني',
  );
  await page.getByRole('link', { name: 'تصميم الواجهات' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('تصميم الواجهات');
  await expect(page.getByText(ar.templates.origin.generated)).toBeVisible();
  await expect(page.getByRole('link', { name: 'المخططات الأولية' })).toBeVisible();
});

test('link the monthly template, generate the month and its missing tasks', async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
  await mockApi(page, { signedIn: true });

  // Linking applies from the next cycle (rule 19): the panel shows the template.
  await page.goto(`/retainers/${seedIds.adsRetainer}`);
  const panel = page.getByRole('region', { name: ar.templates.retainer.title });
  await panel.getByRole('button', { name: ar.templates.retainer.link }).click();
  const linkDialog = page.getByRole('dialog', {
    name: fill(ar.templates.retainer.linkTitle, { name: 'الإعلانات الممولة' }),
  });
  await linkDialog.getByRole('combobox', { name: ar.templates.picker.monthly }).click();
  await page.getByRole('option', { name: 'دورة السوشيال ميديا الشهرية' }).click();
  await linkDialog.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.templates.retainer.saved)).toBeVisible();
  await expect(panel.getByRole('link', { name: 'دورة السوشيال ميديا الشهرية' })).toBeVisible();

  // A retainer linked after its cycle opened generates the month by hand (rule 17).
  await page.goto(`/retainers/${seedIds.socialRetainer}`);
  await panel.getByRole('button', { name: ar.templates.retainer.generate }).click();
  const dialog = page.getByRole('dialog');
  const preview = dialog.getByRole('region', { name: ar.templates.generate.preview });
  await expect(
    preview.getByRole('heading', { name: ar.templates.generate.fixedTasks }),
  ).toBeVisible();
  await expect(preview.getByText('تصميم 12')).toBeVisible();
  // The design default is archived: its tasks go to the department queue (rule 10).
  await expect(
    dialog.getByText(
      counted(ar.templates.generate.warnings, 'assignee_replaced', 12, { department: 'التصميم' }),
    ),
  ).toBeVisible();
  await dialog.getByRole('button', { name: counted(ar.templates.generate, 'submit', 18) }).click();
  await expect(page.getByText(counted(ar.templates.generate, 'done', 18))).toBeVisible();
  await expect(panel.getByText(ar.templates.runs.from)).toBeVisible();
  await expect(panel.getByRole('button', { name: ar.templates.retainer.generate })).toBeHidden();

  const designs = page.getByRole('listitem').filter({ hasText: ar.retainers.kinds.design });
  await expect(
    designs.getByText(fill(ar.templates.lines.tasks, { tasks: '14', committed: '12' })),
  ).toBeVisible();

  // Four more designs this month (two made by hand already): two missing tasks, generated on the line (rule 18).
  await designs
    .getByRole('button', {
      name: fill(ar.retainers.cycle.lineActions, { name: ar.retainers.kinds.design }),
    })
    .click();
  await page.getByRole('menuitem', { name: ar.retainers.cycle.changeCommitted }).click();
  const committed = page.getByRole('dialog', {
    name: fill(ar.retainers.cycle.committedTitle, { name: ar.retainers.kinds.design }),
  });
  await committed.getByLabel(ar.retainers.cycle.committed).fill('16');
  await committed.getByLabel(ar.retainers.cycle.reason).fill('حملة إضافية');
  await committed.getByRole('button', { name: ar.common.save }).click();
  await designs
    .getByRole('button', { name: counted(ar.templates.lines, 'generateMissing', 2) })
    .click();
  await expect(page.getByText(counted(ar.templates.generate, 'done', 2))).toBeVisible();
  await expect(
    designs.getByText(fill(ar.templates.lines.tasks, { tasks: '16', committed: '16' })),
  ).toBeVisible();
});
