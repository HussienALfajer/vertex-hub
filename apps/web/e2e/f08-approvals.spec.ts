import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  accountManagerMe,
  CONTENT_LINK_TOKEN,
  employeeMe,
  medicalReviewerMe,
  mockApi,
  PROJECTS_TODAY,
  seedIds,
} from './fixtures';
import { expect, test } from './test';

// F08 posts in approval links against the mocked API (the real rules are covered by apps/api/test).

async function onToday(page: Page) {
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
}

const section = (page: Page, title: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name: title }) });

/** A post of the client page's content plan, by the title the client reads. */
const postCard = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name: title }) });

/** The status badge of the post page's header. */
async function expectStatus(page: Page, status: keyof typeof ar.content.statuses) {
  await expect(page.locator('section').first().locator(`[data-status="${status}"]`)).toBeVisible();
}

test('the month goes to the client in one link; the client approves one post and returns another', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 1600 });
  await onToday(page);
  await mockApi(page, { signedIn: true, me: accountManagerMe, content: true });

  // The client's Content tab: "Send month" holds the month's ready posts (rule 21).
  await page.goto(`/clients/${seedIds.jasmine}?tab=content`);
  await page.getByRole('button', { name: /^أرسل الشهر للاعتماد \(1\)$/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('عنوان «ريل تحضير القهوة» كما يراه العميل')).toHaveValue(
    'ريل تحضير القهوة',
  );
  await expect(dialog.getByText('من الحبة إلى الفنجان في ثلاثين ثانية.')).toBeVisible();
  await dialog.getByRole('button', { name: ar.approvals.request.create }).click();
  await expect(dialog.getByText(ar.approvals.request.issuedTitle)).toBeVisible();
  await dialog.getByRole('link', { name: ar.approvals.request.open }).click();

  // The request page shows the post item with its type, date and caption.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مطعم الياسمين');
  await expect(page.getByRole('link', { name: 'المنشور: ريل تحضير القهوة' })).toBeVisible();
  await expect(page.getByText(ar.content.types.reel, { exact: true })).toBeVisible();

  // Nothing of the month is left to send, and the post page shows the link it waits in.
  await page.goto(`/clients/${seedIds.jasmine}?tab=content`);
  await expect(page.getByText(ar.content.sendMonth.noneReady)).toBeVisible();
  await expect(page.getByRole('button', { name: ar.content.sendMonth.action })).toBeDisabled();
  await page.goto(`/content/posts/${seedIds.coffeeReel}`);
  const panel = section(page, ar.tasks.approval.title);
  await expect(panel.getByText(ar.content.approval.sent)).toBeVisible();
  await expect(panel.getByText('هالة الشامي')).toBeVisible();

  // The client opens the month link on a phone: the content plan in publish order.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/a/${CONTENT_LINK_TOKEN}`);
  await expect(
    page.getByRole('heading', { level: 2, name: ar.approvals.public.contentPlan }),
  ).toBeVisible();
  const weekend = postCard(page, 'عرض نهاية الأسبوع');
  const sweets = postCard(page, 'حلويات الجمعة');
  await expect(sweets.getByText('#مطعم_الياسمين #حلويات')).toBeVisible();
  await expect(sweets.getByRole('list', { name: ar.approvals.public.mediaStrip })).toBeVisible();
  await expect(sweets.getByRole('img', { name: 'إنستغرام' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^اعتمد الكل \(2\)$/ })).toBeVisible();

  // Asking for changes on one post needs a note.
  await weekend.getByRole('button', { name: ar.approvals.public.requestChanges }).click();
  const changing = page.getByRole('dialog');
  await changing.getByLabel(ar.approvals.public.changes).fill('غيّروا السعر إلى 90 ألفًا.');
  await changing.getByRole('button', { name: ar.approvals.public.sendChanges }).click();
  await expect(weekend.getByText(ar.approvals.public.decided.changes_requested)).toBeVisible();
  // One post is left: "Approve all" needs two.
  await expect(page.getByRole('button', { name: /^اعتمد الكل/ })).toHaveCount(0);
  await sweets.getByRole('button', { name: ar.approvals.public.approve }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: ar.approvals.public.confirmApprove })
    .click();
  await expect(sweets.getByText(ar.approvals.public.decided.approved)).toBeVisible();

  // Back at the agency: one post approved, the other back in production with the note.
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto(`/content/posts/${seedIds.sweetsCarousel}`);
  await expectStatus(page, 'approved');
  await page.goto(`/content/posts/${seedIds.weekendOffer}`);
  await expectStatus(page, 'in_production');
  await expect(page.getByText('غيّروا السعر إلى 90 ألفًا.').first()).toBeVisible();

  // The client's approval history lists the post responses.
  await page.goto(`/clients/${seedIds.jasmine}?tab=approvals`);
  await expect(page.getByRole('link', { name: 'كاروسيل حلويات الجمعة' })).toBeVisible();
});

test('"Approve all" approves every pending post of the link at once', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onToday(page);
  await mockApi(page, { signedIn: false, content: true });

  await page.goto(`/a/${CONTENT_LINK_TOKEN}`);
  await page.getByRole('button', { name: /^اعتمد الكل \(2\)$/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(ar.approvals.public.approveAllBody)).toBeVisible();
  await dialog.getByLabel(ar.approvals.public.note).fill('خطة ممتازة.');
  await dialog.getByRole('button', { name: ar.approvals.public.confirmApproveAll }).click();
  await expect(page.getByText(ar.approvals.public.decided.approved)).toHaveCount(2);
  await expect(page.getByText('خطة ممتازة.')).toHaveCount(2);
  await expect(page.getByRole('button', { name: ar.approvals.public.approve })).toHaveCount(0);
});

test('Approvals lists posts beside tasks, by role', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await onToday(page);
  const api = await mockApi(page, { signedIn: true, me: medicalReviewerMe, content: true });

  // The medical queue: the healthcare client's post, marked as a post.
  await page.goto('/approvals');
  const row = page.getByRole('row').filter({ hasText: 'نصائح العناية بالأسنان' });
  await expect(row.getByText(ar.approvals.kinds.post, { exact: true })).toBeVisible();
  await row.getByRole('link', { name: 'نصائح العناية بالأسنان' }).click();
  await expect(page).toHaveURL(new RegExp(`/content/posts/${seedIds.dentalTips}$`));

  // Ready to send: the account manager's ready posts, filtered by publish month.
  api.signInAs(accountManagerMe);
  await page.goto('/approvals?tab=ready');
  const jasmine = page.getByRole('region', { name: 'مطعم الياسمين' });
  await expect(jasmine.getByRole('link', { name: 'ريل تحضير القهوة' })).toBeVisible();
  await page.getByRole('combobox', { name: ar.approvals.ready.month }).click();
  await page.getByRole('option', { name: /تشرين الأول/ }).click();
  await expect(jasmine.getByRole('link', { name: 'ريل تحضير القهوة' })).toBeVisible();

  // Without client scope there is no queue to send from.
  api.signInAs(employeeMe);
  await page.goto('/approvals?tab=ready');
  await expect(page.getByRole('tab', { name: ar.approvals.tabs.ready })).toHaveCount(0);
});
