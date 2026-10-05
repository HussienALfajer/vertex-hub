import { NOTIFICATION_TEXT } from '@vertex-hub/messages';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { mockApi, seedIds } from './fixtures';
import { expect, test } from './test';

// P2A reminders against the mocked API (the real rules are covered by apps/api/test).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

const behindText = fill(NOTIFICATION_TEXT.retainer_behind.few, {
  retainer: 'إدارة السوشيال ميديا',
  n: '7',
});

test('a retainer behind alert lists its short lines and opens the retainer on This month', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/notifications');

  const alert = page.getByRole('main').getByRole('listitem').filter({ hasText: behindText });
  // Up to three lines, with the ready work, then how many more.
  await expect(alert).toContainText(`${ar.retainers.kinds.design} 9/12`);
  await expect(alert).toContainText(
    fill(NOTIFICATION_TEXT.behindLineReady, { line: '', ready: '2' }),
  );
  await expect(alert).toContainText(`${ar.retainers.kinds.story} 5/8`);
  await expect(alert).not.toContainText(ar.retainers.kinds.monthly_report);
  await expect(alert).toContainText(fill(NOTIFICATION_TEXT.behindMore, { n: '1' }));

  await alert.getByRole('link', { name: behindText }).click();
  await expect(page).toHaveURL(new RegExp(`/retainers/${seedIds.socialRetainer}$`));
  const designs = page
    .getByRole('list', { name: ar.retainers.cycle.lines })
    .getByRole('listitem')
    .filter({ hasText: ar.retainers.kinds.design });
  await expect(designs).toContainText(ar.retainers.cycle.ready_two);
});

test('a pending over-limit decision opens its task', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/notifications');
  await page
    .getByRole('main')
    .getByRole('link', { name: /^قرار معلّق منذ .*التعديل رقم 3 على «تصاميم منيو الخريف»/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${seedIds.autumnMenu}$`));
});

test('both reminders are locked on in the settings', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/notifications/settings');
  for (const type of ['retainer_behind', 'task_over_limit_pending'] as const) {
    const notifyMe = page.getByRole('switch', { name: ar.notifications.types[type] });
    await expect(notifyMe).toBeChecked();
    await expect(notifyMe).toBeDisabled();
  }
});
