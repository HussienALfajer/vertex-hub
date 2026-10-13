import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { mockApi, PROJECTS_TODAY, seedIds } from './fixtures';
import { expect, test } from './test';

// F05C PR 1 anniversary cycles against the mocked API (the real rules are covered by apps/api/test).

async function onProjectsToday(page: Page) {
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
}

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{{${key}}}`, value), text);

const thisCycle = (page: Page) =>
  page.getByText(ar.retainers.page.thisCycle, { exact: true }).locator('..');

test('the header names the current cycle, its period and the days left (Y6)', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto(`/retainers/${seedIds.socialRetainer}`);
  // From 1 March, 10 October is in cycle 8; open-ended, it has no term position.
  await expect(
    thisCycle(page).getByText(fill(ar.retainers.cycleNumber, { number: '8' })),
  ).toBeVisible();
  await expect(page.getByTestId('cycle-period')).toHaveText(
    `1 تشرين الأول – 31 تشرين الأول 2026 · ${fill(ar.retainers.daysLeft_many, { n: '22' })}`,
  );
  await page.getByRole('tab', { name: ar.retainers.page.tabs.history }).click();
  const history = page.getByRole('list', { name: ar.retainers.history.title });
  await expect(history.getByText(fill(ar.retainers.cycleNumber, { number: '7' }))).toBeVisible();
});

test('resuming inside a term opens its cycle now, as k of N (P3)', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto(`/retainers/${seedIds.adsRetainer}`);
  await expect(
    page.getByText(fill(ar.retainers.nextCycleOn, { date: '1 تشرين الثاني 2026' })),
  ).toBeVisible();
  // Term 2 covers cycle 6: no choice to make, its charge is due anyway.
  await page.getByRole('button', { name: ar.retainers.actions.resume }).click();
  await expect(
    page.getByRole('dialog', {
      name: fill(ar.retainers.resume.title, { name: 'الإعلانات الممولة' }),
    }),
  ).toHaveCount(0);
  await expect(page.getByText(ar.retainers.actions.done.active)).toBeVisible();
  await expect(
    thisCycle(page).getByText(fill(ar.retainers.cycleOf, { position: '1', cycles: '3' })),
  ).toBeVisible();
  await expect(page.getByTestId('cycle-period')).toContainText(
    '10 تشرين الأول – 31 تشرين الأول 2026',
  );
});

test('reactivating from the next cycle opens nothing until its day (P2, P4)', async ({ page }) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto(`/retainers/${seedIds.endedRetainer}`);
  await page.getByRole('button', { name: ar.retainers.actions.reactivate }).click();
  const dialog = page.getByRole('dialog', {
    name: fill(ar.retainers.reactivate.title, { name: 'تصوير المنيو الموسمي' }),
  });
  await expect(dialog.getByText(ar.retainers.resume.body)).toBeVisible();
  // From the next cycle is the default.
  await expect(
    dialog.getByRole('button', {
      name: fill(ar.retainers.resume.next, { date: '1 تشرين الثاني 2026' }),
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByText(ar.retainers.resume.nextHint)).toBeVisible();
  await dialog.getByRole('button', { name: ar.retainers.resume.now }).click();
  await expect(dialog.getByText(/دورة كاملة من اليوم حتى 31 تشرين الأول 2026/)).toBeVisible();
  await dialog
    .getByRole('button', { name: fill(ar.retainers.resume.next, { date: '1 تشرين الثاني 2026' }) })
    .click();
  await dialog.getByRole('button', { name: ar.retainers.actions.reactivate }).click();
  await expect(page.getByText(ar.retainers.actions.done.reactivated)).toBeVisible();
  await expect(
    thisCycle(page).getByText(fill(ar.retainers.nextCycleOn, { date: '1 تشرين الثاني 2026' })),
  ).toBeVisible();
  await expect(page.getByTestId('cycle-period')).toHaveCount(0);
});

test('a retainer that started cycles ago is still edited by name (B1 checks a sent start date only)', async ({
  page,
}) => {
  await onProjectsToday(page);
  await mockApi(page, { signedIn: true });
  await page.goto(`/retainers/${seedIds.socialRetainer}`);
  // The header's edit button; the fee card has its own.
  await page.getByRole('button', { name: ar.common.edit }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(ar.retainers.form.name).fill('إدارة السوشيال ميديا والمحتوى');
  await dialog.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.projects.edit.saved)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('إدارة السوشيال ميديا والمحتوى');
});
