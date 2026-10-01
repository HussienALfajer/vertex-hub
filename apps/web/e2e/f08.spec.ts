import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  accountManagerMe,
  employeeMe,
  manager,
  medicalReviewerMe,
  mockApi,
  PROJECTS_TODAY,
  seedIds,
} from './fixtures';
import { expect, test } from './test';

// F08 content flows against the mocked API (the real rules are covered by apps/api/test).

/** Freezes the browser's clock on the seeded "today" so the calendar and badges are stable. */
async function onToday(page: Page) {
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
}

/** The status badge of the post page's header. */
async function expectStatus(page: Page, status: keyof typeof ar.content.statuses) {
  const hero = page.locator('section').first();
  await expect(hero.locator(`[data-status="${status}"]`)).toBeVisible();
}

const move = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true }).first().click();

test('create a post → link a task → review → publish delivers the task', async ({ page }) => {
  test.setTimeout(120_000);
  // Tall enough that the header's moves never sit under the toasts.
  await page.setViewportSize({ width: 1280, height: 2000 });
  await onToday(page);
  const api = await mockApi(page, { signedIn: true, me: accountManagerMe, content: true });

  // The account manager plans a post from the client's Content tab.
  await page.goto(`/clients/${seedIds.jasmine}?tab=content`);
  await page.getByRole('button', { name: ar.content.actions.new }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: ar.content.new.submit }).click();
  // Validation in place: a title and a platform are required.
  await expect(dialog.getByText(ar.content.form.errors.title)).toBeVisible();
  await expect(dialog.getByText(ar.content.form.errors.platforms)).toBeVisible();
  await dialog.getByLabel(ar.content.form.title).fill('عرض الفطور الشامي');
  await dialog.getByRole('checkbox', { name: 'إنستغرام' }).click();
  await dialog.getByLabel(ar.content.form.publishDate).fill('2026-10-20');
  await dialog
    .getByRole('textbox', { name: new RegExp(`^${ar.content.form.caption}`) })
    .fill('فطور شامي كامل كل جمعة.');
  await dialog.getByRole('switch', { name: ar.content.form.needsClientApproval }).click();
  await dialog.getByRole('button', { name: ar.content.new.submit }).click();
  await expect(page.getByText(ar.content.new.created)).toBeVisible();

  // It shows on the client's calendar, and on the calendar of all clients.
  await page.getByRole('link', { name: /عرض الفطور الشامي/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('عرض الفطور الشامي');
  await expectStatus(page, 'idea');
  const postUrl = page.url();

  // Linking the generated design task starts production (rule 7).
  await page.getByRole('button', { name: ar.content.tasks.link }).click();
  const link = page.getByRole('dialog');
  const offered = link.getByRole('listitem').filter({ hasText: 'تصميم قائمة المشروبات' });
  await expect(offered.getByText(ar.content.link.inCycle)).toBeVisible();
  await offered.getByRole('button', { name: ar.content.link.choose }).click();
  await expectStatus(page, 'in_production');
  // The task's final design is the post's media.
  await expect(page.getByText(ar.content.media.fromTasks)).toBeVisible();

  // The task page names the post and offers no delivery by hand.
  await page.getByRole('link', { name: 'تصميم قائمة المشروبات', exact: true }).click();
  await expect(page.getByRole('link', { name: 'عرض الفطور الشامي' })).toBeVisible();
  await expect(page.getByText(ar.content.taskPost.hint)).toBeVisible();
  await expect(page.getByRole('button', { name: ar.tasks.moves.deliver })).toHaveCount(0);

  // Submit, then pass the review: without client approval the post is approved.
  await page.goto(postUrl);
  await move(page, ar.content.moves.submit);
  await expectStatus(page, 'internal_review');
  await move(page, ar.content.moves.approve);
  await expectStatus(page, 'approved');
  await expect(page.getByText(ar.tasks.reviews.title)).toBeVisible();

  // Scheduling needs a publish time (rule 17).
  await move(page, ar.content.moves.schedule);
  await expect(page.getByText(ar.errors.PUBLISH_TIME_REQUIRED)).toBeVisible();

  // The date and time change freely after approval (rule 3).
  await page.getByRole('button', { name: ar.common.edit }).click();
  const details = page.getByRole('dialog');
  await details.getByLabel(ar.content.form.publishTime).fill('18:30');
  await details.getByRole('button', { name: ar.common.save }).click();
  await expect(page.getByText(ar.content.edit.saved)).toBeVisible();
  await expectStatus(page, 'approved');

  // Published with its link: the linked task is delivered with it (rule 18).
  await move(page, ar.content.moves.publish);
  const publish = page.getByRole('dialog');
  await publish
    .getByRole('textbox', {
      name: ar.content.publishing.linkOn.replace('{{platform}}', 'إنستغرام'),
    })
    .fill('https://www.instagram.com/p/breakfast');
  await publish.getByRole('button', { name: ar.content.moves.publish }).click();
  await expectStatus(page, 'published');
  await expect(page.getByRole('link', { name: 'instagram.com/p/breakfast' })).toBeVisible();
  const linked = page.getByRole('listitem').filter({ hasText: 'تصميم قائمة المشروبات' });
  await expect(linked.getByText(ar.tasks.statuses.delivered)).toBeVisible();
  // Published is final: no workflow move is left.
  await expect(page.getByRole('button', { name: ar.content.moves.publish })).toHaveCount(0);

  // An employee outside Content Management reads the post and gets no action.
  api.signInAs(employeeMe);
  await page.goto(postUrl);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('عرض الفطور الشامي');
  await expect(page.getByRole('button', { name: ar.tasks.actions.more })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ar.common.edit })).toHaveCount(0);
});

test('a return sends the post back with its note, and a cancelled post frees its task', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1800 });
  await onToday(page);
  await mockApi(page, { signedIn: true, me: accountManagerMe, content: true });

  // The reviewer returns a post in internal review with what must change.
  await page.goto(`/content/posts/${seedIds.hotDrinksPost}`);
  await move(page, ar.content.moves.return);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: ar.content.moves.return }).click();
  await expect(dialog.getByText(ar.tasks.move.errors.changes)).toBeVisible();
  await dialog.getByRole('textbox').fill('اذكروا الأسعار.');
  await dialog.getByRole('button', { name: ar.content.moves.return }).click();
  await expectStatus(page, 'in_production');
  // The note shows above the post and in its review history.
  await expect(page.getByText('اذكروا الأسعار.').first()).toBeVisible();

  // Cancelling needs a reason and unlinks the task (rule 19).
  await page.goto(`/content/posts/${seedIds.openingPost}`);
  await expect(page.getByRole('link', { name: 'تصميم عرض الافتتاح', exact: true })).toBeVisible();
  await page.getByRole('button', { name: ar.tasks.actions.more }).click();
  await page.getByRole('menuitem', { name: ar.content.moves.cancel }).click();
  const cancel = page.getByRole('dialog');
  await cancel.getByRole('textbox').fill('أُجّل الافتتاح.');
  await cancel.getByRole('button', { name: ar.content.moves.cancel }).click();
  await expectStatus(page, 'cancelled');
  await expect(page.getByText(ar.content.tasks.empty)).toBeVisible();
  await page.goto(`/tasks/${seedIds.openingDesign}`);
  await expect(page.getByText(ar.content.taskPost.hint)).toHaveCount(0);
});

test('a healthcare post waits for the medical review, never by its responsible person', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1600 });
  await onToday(page);
  const api = await mockApi(page, { signedIn: true, me: manager, content: true });

  // Sara is responsible for the post: she sees the stage and cannot review it medically.
  await page.goto(`/content/posts/${seedIds.dentalTips}`);
  await expect(page.getByText(ar.tasks.page.medicalTitle)).toBeVisible();
  await expect(page.getByRole('button', { name: ar.tasks.medical.approve })).toHaveCount(0);

  api.signInAs(medicalReviewerMe);
  await page.reload();
  await page.getByRole('button', { name: ar.tasks.medical.approve }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('ثلاث عادات يومية تحمي أسنانك.')).toBeVisible();
  await dialog.getByRole('button', { name: ar.tasks.medical.approve }).click();
  await expect(page.getByText(ar.content.medical.approved)).toBeVisible();
  await expectStatus(page, 'awaiting_client');
});

test('the calendar filters, moves between months and keeps its state in the URL', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1500 });
  await onToday(page);
  await mockApi(page, { signedIn: true, me: employeeMe, content: true });

  // Every active user reads the calendar; only edit scope creates posts.
  await page.goto('/content');
  await expect(page.getByRole('link', { name: /كاروسيل أطباق الخريف/ })).toBeVisible();
  await expect(page.getByRole('button', { name: ar.content.actions.new })).toHaveCount(0);

  await page.getByRole('combobox', { name: ar.content.filters.type }).click();
  await page.getByRole('option', { name: ar.content.types.reel }).click();
  await expect(page).toHaveURL(/type=reel/);
  await expect(page.getByRole('link', { name: /ريل كواليس المطبخ/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /كاروسيل أطباق الخريف/ })).toHaveCount(0);
  await page.getByRole('button', { name: ar.content.filters.clear }).click();

  await page.getByRole('button', { name: ar.content.calendar.next.month }).click();
  await expect(page).toHaveURL(/date=2026-11-01/);
  await expect(page.getByRole('link', { name: /حملة تشرين الثاني/ })).toBeVisible();
  await page.getByRole('button', { name: ar.content.calendar.next.month }).click();
  await expect(page.getByText(ar.content.calendar.emptyTitle)).toBeVisible();
  await page.getByRole('button', { name: ar.content.calendar.today }).click();
  await expect(page.getByRole('link', { name: /كاروسيل أطباق الخريف/ })).toBeVisible();

  // My posts: nothing waits for a user who is responsible for no post.
  await page.getByRole('tab', { name: ar.content.tabs.mine }).click();
  await expect(page).toHaveURL(/tab=mine/);
  await expect(page.getByText(ar.content.my.emptyTitle)).toBeVisible();
});
