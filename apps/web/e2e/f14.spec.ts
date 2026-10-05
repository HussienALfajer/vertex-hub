import { NOTIFICATION_TEXT } from '@vertex-hub/messages';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { employeeMe, manager, mockApi, notificationFor, seedIds } from './fixtures';
import { expect, test } from './test';

// F14 notification screens against the mocked API (the real rules are covered by apps/api/test).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

const bellLabel = (count: number) => fill(ar.notifications.bellUnread, { count: String(count) });

const reviewText = fill(NOTIFICATION_TEXT.task_review_requested, {
  actor: 'ليان الأحمد',
  task: 'تصاميم منيو الخريف',
});

test('the bell counts unread notifications and opens one, marking it read', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/');

  await page.getByRole('button', { name: bellLabel(3) }).click();
  const panel = page.getByRole('dialog', { name: ar.notifications.title });
  await expect(panel.getByRole('link', { name: reviewText })).toBeVisible();
  // A merged comment says how many; the daily job's reminders have no actor.
  await expect(
    panel.getByRole('link', {
      name: fill(NOTIFICATION_TEXT.task_commented_merged.two, { task: 'تصاميم منيو الخريف' }),
    }),
  ).toBeVisible();
  await expect(
    panel.getByRole('link', {
      name: fill(NOTIFICATION_TEXT.tasks_generated_queued.few, {
        n: '4',
        template: 'إطلاق موقع',
        department: 'التصميم',
      }),
    }),
  ).toBeVisible();

  await panel.getByRole('link', { name: reviewText }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${seedIds.autumnMenu}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('تصاميم منيو الخريف');
  await expect(page.getByRole('button', { name: bellLabel(2) })).toBeVisible();
});

test('a template run notice opens the department queue', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/');
  await page.getByRole('button', { name: bellLabel(3) }).click();
  await page
    .getByRole('dialog', { name: ar.notifications.title })
    .getByRole('link', { name: /إطلاق موقع/ })
    .click();
  await expect(page).toHaveURL(/\/tasks\/list\?.*assignee=unassigned/);
  await expect(page).toHaveURL(/department=/);
});

test('a pushed notification shows a toast that opens its subject', async ({ page }) => {
  await mockApi(page, {
    signedIn: true,
    me: employeeMe,
    streamed: [
      notificationFor(employeeMe, 5900, {
        type: 'task_assigned',
        actor: { id: manager.user.id, name: manager.user.name },
        subject: { type: 'task', id: seedIds.dishShoot },
        data: {
          task: {
            title: 'تصوير الأطباق',
            department: 'photography',
            client: 'مطعم الياسمين',
            project: null,
          },
        },
      }),
    ],
  });
  await page.goto('/');

  const text = fill(NOTIFICATION_TEXT.task_assigned, {
    actor: manager.user.name,
    task: 'تصوير الأطباق',
  });
  const toast = page.locator('[data-slot="toast"]').filter({ hasText: text });
  await expect(toast).toBeVisible();
  await expect(page.getByRole('button', { name: bellLabel(2) })).toBeVisible();
  await toast.getByRole('button', { name: ar.notifications.open }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${seedIds.dishShoot}$`));
  await expect(page.getByRole('button', { name: bellLabel(1) })).toBeVisible();
});

test('more than three notifications at once collapse into one toast', async ({ page }) => {
  const streamed = [1, 2, 3, 4, 5].map((n) =>
    notificationFor(employeeMe, 5900 + n, {
      type: 'tasks_generated',
      actor: null,
      subject: { type: 'template_run', id: seedIds.monthlyTemplate },
      data: {
        template: `قالب ${n}`,
        count: 2,
        department: 'photography',
        unassigned: false,
        client: 'مطعم الياسمين',
        project: null,
        retainer: 'إدارة السوشيال ميديا',
      },
    }),
  );
  await mockApi(page, { signedIn: true, me: employeeMe, streamed });
  await page.goto('/');

  const summary = fill(ar.notifications.newMany_few, { n: '5' });
  await expect(page.locator('[data-slot="toast"]').filter({ hasText: summary })).toBeVisible();
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(1);
  await page.getByRole('button', { name: ar.notifications.open }).click();
  await expect(page.getByRole('dialog', { name: ar.notifications.title })).toBeVisible();
});

test('filter unread, mark all read, and see the empty state', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.notifications.title);
  await expect(page.getByRole('main').getByRole('link')).not.toHaveCount(0);

  await page
    .getByRole('button', { name: ar.notifications.readFilters.unread, exact: true })
    .click();
  await expect(page).toHaveURL(/unread=true/);
  await expect(page.getByRole('main').getByRole('link', { name: reviewText })).toBeVisible();

  // Mark one read, then the rest; the unread filter empties.
  await page
    .getByRole('main')
    .getByRole('button', { name: ar.notifications.markRead })
    .first()
    .click();
  await expect(page.getByRole('button', { name: bellLabel(2) })).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: ar.notifications.markAllRead }).click();
  await expect(page.getByText(ar.notifications.emptyUnread)).toBeVisible();
  await expect(
    page.getByRole('button', { name: ar.notifications.bell, exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: ar.notifications.readFilters.all, exact: true }).click();
  await page
    .getByRole('main')
    .getByRole('button', { name: ar.notifications.markUnread })
    .first()
    .click();
  await expect(page.getByRole('button', { name: bellLabel(1) })).toBeVisible();
});

test('filter by category', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/notifications');
  await page.getByRole('combobox', { name: ar.notifications.category }).click();
  await page.getByRole('option', { name: ar.notifications.categories.clients_projects }).click();
  await expect(page).toHaveURL(/category=clients_projects/);
  const rows = page.getByRole('main').getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('عيادة الشفاء');
});

test('mute a type; action-required types stay on', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/notifications/settings');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.notifications.settings.title);

  // Each switch is named by its type; locked ones add the hint.
  const notifyMe = (type: keyof typeof ar.notifications.types) =>
    page.getByRole('switch', { name: ar.notifications.types[type] });
  await expect(notifyMe('task_assigned')).toBeChecked();
  await expect(notifyMe('task_assigned')).toBeDisabled();

  await notifyMe('task_commented').click();
  await expect(page.getByText(ar.notifications.settings.saved)).toBeVisible();
  await expect(notifyMe('task_commented')).not.toBeChecked();

  await page.reload();
  await expect(notifyMe('task_commented')).not.toBeChecked();
});

test('an empty bell', async ({ page }) => {
  await mockApi(page, { signedIn: true, notifications: [] });
  await page.goto('/');
  await page.getByRole('button', { name: ar.notifications.bell, exact: true }).click();
  await expect(page.getByText(ar.notifications.emptyTitle)).toBeVisible();
});
