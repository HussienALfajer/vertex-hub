import { NOTIFICATION_TEXT } from '@vertex-hub/messages';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { employeeMe, manager, mockApi, notificationFor, seedIds } from './fixtures';
import { expect, test } from './test';

// F16 part B in the web app: inboxes, snooze, settings, the channel policy and following, against
// the mocked API (the rules themselves are covered by apps/api/test).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

const reviewText = fill(NOTIFICATION_TEXT.task_review_requested, {
  actor: 'ليان الأحمد',
  task: 'تصاميم منيو الخريف',
});

const needsYouTab = (n: number) => fill(ar.notifications.inboxes.needsYouCount, { n: String(n) });

test('the bell splits "Needs you" from "For your information", critical first', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/');
  await page
    .getByRole('button', { name: fill(ar.notifications.bellUnread, { count: '3' }) })
    .click();
  const panel = page.getByRole('dialog', { name: ar.notifications.title });

  await expect(panel.getByRole('tab', { name: needsYouTab(7) })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // The overdue task is critical: it carries the red mark and leads the list.
  const first = panel.getByRole('listitem').first();
  await expect(first).toContainText(ar.notifications.priorities.critical);
  await expect(first).toContainText('بوستات أسبوع الافتتاح');

  // A review someone else handled waits in "For your information", saying who.
  await panel.getByRole('tab', { name: ar.notifications.inboxes.fyi }).click();
  await expect(
    panel.getByText(fill(ar.notifications.resolution.handledBy, { name: 'عمر حداد' })),
  ).toBeVisible();

  await panel.getByRole('link', { name: ar.notifications.inboxes.done }).click();
  await expect(page).toHaveURL(/\/notifications\?inbox=done/);
  await expect(page.getByRole('main').getByText(ar.notifications.resolution.byYou)).toBeVisible();
});

test('snooze a row from the bell, then bring it back from the Snoozed tab', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/');
  await page
    .getByRole('button', { name: fill(ar.notifications.bellUnread, { count: '3' }) })
    .click();
  const panel = page.getByRole('dialog', { name: ar.notifications.title });
  const row = panel.getByRole('listitem').filter({ hasText: reviewText });
  await row.getByRole('button', { name: ar.notifications.snooze.later }).click();
  await page.getByRole('menuitem', { name: ar.notifications.snooze.options['1h'] }).click();

  // It leaves the list and the count.
  await expect(panel.getByRole('link', { name: reviewText })).toHaveCount(0);
  await expect(panel.getByRole('tab', { name: needsYouTab(6) })).toBeVisible();
  await expect(
    page.getByRole('button', { name: fill(ar.notifications.bellUnread, { count: '2' }) }),
  ).toBeVisible();

  await panel.getByRole('link', { name: ar.notifications.inboxes.snoozed }).click();
  await expect(page).toHaveURL(/inbox=snoozed/);
  const main = page.getByRole('main');
  const snoozed = main.getByRole('listitem').filter({ hasText: reviewText });
  await expect(snoozed).toContainText(/يعود/);
  await snoozed.getByRole('button', { name: ar.notifications.snooze.wake }).click();
  await expect(main.getByRole('link', { name: reviewText })).toHaveCount(0);

  await main.getByRole('tab', { name: /^تحتاجك/ }).click();
  await expect(main.getByRole('link', { name: reviewText })).toBeVisible();
});

test('settings: the morning push, and a whole category on or off at once', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/notifications/settings');
  const morning = page.getByRole('switch', { name: ar.notifications.settings.morningPush });
  await expect(morning).toBeChecked();
  await morning.click();
  await expect(page.getByText(ar.notifications.settings.saved)).toBeVisible();
  await expect(morning).not.toBeChecked();

  const allEmail = page.getByRole('switch', {
    name: fill(ar.notifications.settings.allLabel, {
      category: ar.notifications.categories.tasks,
      channel: ar.notifications.settings.email,
    }),
  });
  const emailOf = (type: keyof typeof ar.notifications.types) =>
    page.getByRole('switch', {
      name: fill(ar.notifications.settings.emailLabel, { name: ar.notifications.types[type] }),
    });
  await expect(allEmail).not.toBeChecked();
  await allEmail.click();
  await expect(emailOf('task_commented')).toBeChecked();
  await expect(emailOf('task_returned')).toBeChecked();
  await expect(allEmail).toBeChecked();
  await allEmail.click();
  await expect(emailOf('task_assigned')).not.toBeChecked();
});

test('the policy: management requires a channel, then resets it', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/');
  await page.getByRole('link', { name: ar.nav.notificationPolicy }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.notifications.policy.title);

  const commented = ar.notifications.types.task_commented;
  const push = page.getByRole('combobox', {
    name: fill(ar.notifications.policy.pushLabel, { name: commented }),
  });
  await push.click();
  await page.getByRole('option', { name: ar.notifications.policy.modes.required }).click();
  await expect(
    page.getByText(fill(ar.notifications.policy.saved, { name: commented })),
  ).toBeVisible();
  const row = page.getByRole('row').filter({ has: push });
  await expect(row).toContainText(ar.notifications.policy.changed);

  // The user's switch is now locked on.
  await page.goto('/notifications/settings');
  const pushSwitch = page.getByRole('switch', {
    name: fill(ar.notifications.settings.pushLabel, { name: commented }),
  });
  await expect(pushSwitch).toBeChecked();
  await expect(pushSwitch).toBeDisabled();

  await page.goto('/admin/notification-policy');
  await page
    .getByRole('button', { name: fill(ar.notifications.policy.resetLabel, { name: commented }) })
    .click();
  await expect(row).not.toContainText(ar.notifications.policy.changed);
});

test('the push delivery log, filtered by status', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/admin/notification-policy?tab=deliveries');
  const rows = page.getByRole('main').getByRole('row');
  await expect(rows).toHaveCount(4);
  await expect(page.getByText('Safari على iPhone')).toBeVisible();
  await expect(page.getByText(ar.notifications.deliveries.kinds.test)).toBeVisible();

  await page.getByRole('button', { name: ar.notifications.deliveries.statuses.gone }).click();
  await expect(page).toHaveURL(/status=/);
  await expect(rows).toHaveCount(2);
  await expect(page.getByText('410 Gone')).toBeVisible();
});

test('without the permission, the policy page is out of reach', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/admin/notification-policy');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: ar.nav.notificationPolicy })).toHaveCount(0);
});

test('follow a task by hand, then stop', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto(`/tasks/${seedIds.autumnMenu}`);
  const follow = page.getByRole('button', { name: new RegExp(ar.notifications.follow.follow) });
  await expect(follow).toContainText(fill(ar.notifications.follow.followers_two, {}));
  await follow.click();
  await expect(page.getByText(ar.notifications.follow.followed)).toBeVisible();
  const following = page.getByRole('button', {
    name: new RegExp(ar.notifications.follow.following),
  });
  await expect(following).toHaveAttribute('aria-pressed', 'true');
  await expect(following).toContainText('3');
  await following.click();
  await expect(page.getByText(ar.notifications.follow.unfollowed)).toBeVisible();
});

test('a critical toast stays beside a collapsed burst (rule B10)', async ({ page }) => {
  const generated = [1, 2, 3, 4].map((n) =>
    notificationFor(employeeMe, 5920 + n, {
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
  const overdue = notificationFor(employeeMe, 5930, {
    type: 'task_overdue',
    actor: null,
    subject: { type: 'task', id: seedIds.dishShoot },
    data: {
      task: {
        title: 'تصوير الأطباق',
        department: 'photography',
        client: 'مطعم الياسمين',
        project: null,
      },
      dueDate: '2026-09-28',
      dueTime: null,
    },
  });
  await mockApi(page, { signedIn: true, me: employeeMe, streamed: [overdue, ...generated] });
  await page.goto('/');
  const toasts = page.locator('[data-slot="toast"]');
  await expect(
    toasts.filter({ hasText: fill(ar.notifications.newMany_few, { n: '4' }) }),
  ).toBeVisible();
  await expect(toasts.filter({ hasText: 'تصوير الأطباق' })).toBeVisible();
  await expect(toasts).toHaveCount(2);
});
