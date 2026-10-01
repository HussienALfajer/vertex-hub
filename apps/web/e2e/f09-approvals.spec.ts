import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  accountManagerMe,
  EXPIRED_LINK_TOKEN,
  employeeMe,
  mockApi,
  notificationFor,
  OPEN_LINK_TOKEN,
  PROJECTS_TODAY,
  seedIds,
} from './fixtures';
import { expect, test } from './test';

// F09 approval links against the mocked API (the real rules are covered by apps/api/test).

async function onTasksToday(page: Page) {
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
}

const hero = (page: Page) => page.locator('section').first();

const section = (page: Page, title: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name: title }) });

/** An item of the client page, by its title. */
const card = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 2, name: title }) });

test('ready tasks go to the client in one link; the client approves one and asks to change another', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 1400 });
  await onTasksToday(page);
  await mockApi(page, { signedIn: true, me: accountManagerMe, approvals: true });

  // Ready to send: the account manager's clients, each with its ready tasks.
  await page.goto('/approvals');
  const jasmine = page.getByRole('region', { name: 'مطعم الياسمين' });
  await expect(jasmine.getByRole('link', { name: 'بنر الموقع' })).toBeVisible();
  await expect(jasmine.getByRole('link', { name: 'ستوري افتتاح الفرع' })).toBeVisible();
  // The task waiting in the open link is not ready; another manager's client is not listed.
  await expect(page.getByRole('link', { name: 'ريل عرض الخريف' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'عيادة الشفاء' })).toHaveCount(0);
  const create = jasmine.getByRole('button', { name: ar.approvals.ready.create });
  await expect(create).toBeDisabled();
  await jasmine.getByRole('button', { name: ar.approvals.ready.selectAll }).click();
  await jasmine.getByRole('button', { name: /^أنشئ رابط اعتماد \(2\)$/ }).click();

  // The request: the contact with final approval, a message and the titles the client reads.
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: ar.approvals.request.contact })).toContainText(
    'هالة الشامي',
  );
  await dialog.getByLabel(ar.approvals.request.message).fill('أعمال الأسبوع جاهزة.');
  await dialog.getByLabel('عنوان «بنر الموقع» كما يراه العميل').fill('بنر الصفحة الرئيسية');
  await dialog.getByRole('button', { name: ar.approvals.request.create }).click();

  // The link is shown once, to copy or to send on WhatsApp to the contact's phone.
  await expect(dialog.getByText(ar.approvals.request.issuedTitle)).toBeVisible();
  const link = await dialog.getByLabel(ar.approvals.link.label).inputValue();
  expect(link).toMatch(/\/a\/link-token-\d+$/);
  await expect(dialog.getByRole('link', { name: ar.approvals.link.whatsApp })).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\/963944555666\?text=/,
  );
  await dialog.getByRole('link', { name: ar.approvals.request.open }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مطعم الياسمين');
  await expect(page.getByText(ar.approvals.itemStatuses.pending)).toHaveCount(2);
  const requestUrl = page.url();

  // The task page shows the link it waits in.
  await page.goto(`/tasks/${seedIds.siteBanner}`);
  const panel = section(page, ar.tasks.approval.title);
  await expect(panel.getByText(ar.approvals.states.open)).toBeVisible();
  await expect(panel.getByText('هالة الشامي')).toBeVisible();
  await expect(panel.getByRole('button', { name: ar.tasks.approval.create })).toHaveCount(0);

  // The client opens the link on a phone: no account, the titles and the snapshot, no download.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(new URL(link).pathname);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مرحبًا هالة الشامي');
  await expect(page.getByText('أعمال الأسبوع جاهزة.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: ar.nav.label })).toHaveCount(0);
  const banner = card(page, 'بنر الصفحة الرئيسية');
  const story = card(page, 'ستوري افتتاح الفرع');
  await expect(story.getByText('نفتتح فرعنا الجديد يوم الجمعة.')).toBeVisible();
  await expect(page.getByRole('link', { name: ar.files.download })).toHaveCount(0);
  await banner.getByRole('button', { name: 'عاين بنر الموقع' }).click();
  await expect(page.getByRole('dialog').getByRole('img', { name: 'بنر الموقع' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: ar.common.close }).click();

  // Approving is confirmed as final.
  await banner.getByRole('button', { name: ar.approvals.public.approve }).click();
  const approving = page.getByRole('dialog');
  await expect(approving.getByText(ar.approvals.public.approveBody)).toBeVisible();
  await approving.getByRole('button', { name: ar.approvals.public.confirmApprove }).click();
  await expect(banner.getByText(ar.approvals.public.decided.approved)).toBeVisible();

  // Asking for changes needs a note.
  await story.getByRole('button', { name: ar.approvals.public.requestChanges }).click();
  const changing = page.getByRole('dialog');
  await changing.getByRole('button', { name: ar.approvals.public.sendChanges }).click();
  await expect(changing.getByText(ar.approvals.public.errors.note)).toBeVisible();
  await changing.getByLabel(ar.approvals.public.changes).fill('غيّروا الموعد إلى السبت.');
  await changing.getByRole('button', { name: ar.approvals.public.sendChanges }).click();
  await expect(story.getByText(ar.approvals.public.decided.changes_requested)).toBeVisible();

  // The decisions are final: after a reload nothing is left to decide.
  await page.reload();
  await expect(story.getByText('غيّروا الموعد إلى السبت.')).toBeVisible();
  await expect(page.getByRole('button', { name: ar.approvals.public.approve })).toHaveCount(0);

  // Back at the agency: the approved task with its version marked by the client.
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto(`/tasks/${seedIds.siteBanner}`);
  await expect(hero(page).getByText(ar.tasks.statuses.approved, { exact: true })).toBeVisible();
  await expect(section(page, ar.tasks.files.title).getByText(ar.files.finalByClient)).toBeVisible();
  const responses = section(page, ar.tasks.responses.title);
  await expect(responses.getByText(ar.tasks.responses.channels.link)).toBeVisible();

  // The other is back in revisions with the client's note as a counted revision.
  await page.goto(`/tasks/${seedIds.openingStory}`);
  await expect(hero(page).getByText(ar.tasks.statuses.revisions, { exact: true })).toBeVisible();
  await expect(
    section(page, ar.tasks.revisions.title).getByText('غيّروا الموعد إلى السبت.'),
  ).toBeVisible();

  // The request is completed, and nothing is left to send.
  await page.goto(requestUrl);
  await expect(hero(page).getByText(ar.approvals.states.completed)).toBeVisible();
  await expect(page.getByRole('button', { name: ar.approvals.requestPage.reissue })).toHaveCount(0);
  await page.goto('/approvals');
  await expect(page.getByText(ar.approvals.ready.emptyTitle)).toBeVisible();
});

test('a link is reissued and revoked, and a response by hand shows on the client page', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 1400 });
  await onTasksToday(page);
  await mockApi(page, { signedIn: true, me: accountManagerMe, approvals: true });

  // Sent: the open and the expired request; other states on request.
  await page.goto('/approvals?tab=sent');
  await expect(page.getByRole('row')).toHaveCount(3);
  await expect(page.getByRole('row').nth(1)).toContainText(ar.approvals.states.open);
  await expect(page.getByRole('row').nth(1)).toContainText('أُجيب 2 من 3');
  await expect(page.getByRole('row').nth(2)).toContainText(ar.approvals.states.expired);
  await page.getByRole('switch', { name: ar.approvals.sent.mine }).click();
  await expect(page.getByRole('row')).toHaveCount(2);
  await page.getByRole('link', { name: 'مطعم الياسمين' }).click();

  // The request page: each item with its answer, and the reminder after the 48-hour notice.
  await expect(page.getByText('ممتاز، انشروه الخميس.')).toBeVisible();
  await expect(page.getByRole('link', { name: ar.approvals.requestPage.remind })).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\/963944555666\?text=/,
  );

  // A response recorded by hand closes the item; the client page says who recorded it.
  await page.goto(`/tasks/${seedIds.autumnReel}`);
  await hero(page)
    .getByRole('button', { name: ar.tasks.moves.client_approved, exact: true })
    .click();
  const recording = page.getByRole('dialog');
  await recording.getByRole('combobox', { name: ar.tasks.move.responder }).click();
  await page.getByRole('option').nth(1).click();
  await recording.getByRole('button', { name: ar.tasks.moves.client_approved }).click();
  await expect(hero(page).getByText(ar.tasks.statuses.approved, { exact: true })).toBeVisible();
  await page.goto(`/a/${OPEN_LINK_TOKEN}`);
  const reel = card(page, 'ريل عرض الخريف');
  await expect(reel).toContainText(ar.approvals.public.recordedByAgency);
  // An image the browser cannot show (TIFF) opens its preview; only the archive is a download.
  await expect(reel.getByRole('button', { name: 'عاين تصميم الطباعة' })).toBeVisible();
  await expect(reel.getByRole('link', { name: ar.files.download })).toHaveCount(1);
  await expect(page.getByRole('link', { name: ar.files.download })).toHaveCount(1);
  await expect(page.getByRole('button', { name: ar.approvals.public.approve })).toHaveCount(0);

  // The expired request: a new link replaces the old one, shown once.
  await page.goto(`/a/${EXPIRED_LINK_TOKEN}`);
  await expect(page.getByText(ar.approvals.public.expiredTitle)).toBeVisible();
  await page.goto(`/approvals/requests/${seedIds.expiredRequest}`);
  await expect(page.getByText(ar.approvals.requestPage.expiredTitle)).toBeVisible();
  await page.getByRole('button', { name: ar.approvals.requestPage.reissue }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: ar.approvals.requestPage.reissue })
    .click();
  const reissued = page.getByRole('dialog');
  await expect(reissued.getByText(ar.approvals.requestPage.reissuedTitle)).toBeVisible();
  const link = await reissued.getByLabel(ar.approvals.link.label).inputValue();
  await reissued.getByRole('button', { name: ar.approvals.request.done }).click();
  await expect(hero(page).getByText(ar.approvals.states.open)).toBeVisible();
  await page.goto(`/a/${EXPIRED_LINK_TOKEN}`);
  await expect(page.getByText(ar.approvals.public.invalidTitle)).toBeVisible();
  await page.goto(new URL(link).pathname);
  await expect(card(page, 'بنر الموقع')).toBeVisible();

  // Revoked, the link stops working and the task is ready to send again.
  await page.goto(`/approvals/requests/${seedIds.expiredRequest}`);
  await page.getByRole('button', { name: ar.approvals.requestPage.revoke }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: ar.approvals.requestPage.revoke })
    .click();
  await expect(hero(page).getByText(ar.approvals.states.revoked)).toBeVisible();
  await expect(page.getByText(ar.approvals.withdrawnReasons.revoked)).toBeVisible();
  await page.goto(new URL(link).pathname);
  await expect(page.getByText(ar.approvals.public.invalidTitle)).toBeVisible();
  await page.goto(`/tasks/${seedIds.siteBanner}`);
  await expect(
    section(page, ar.tasks.approval.title).getByRole('button', {
      name: ar.tasks.approval.create,
    }),
  ).toBeEnabled();
});

test('everyone reads requests; only client scope acts, and a notification opens its request', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await onTasksToday(page);
  const api = await mockApi(page, {
    signedIn: true,
    me: employeeMe,
    approvals: true,
    notifications: [
      notificationFor(accountManagerMe, 5101, {
        type: 'approval_no_response',
        actor: null,
        subject: { type: 'approval_request', id: seedIds.openRequest },
        data: { client: 'مطعم الياسمين', contact: 'هالة الشامي' },
      }),
    ],
  });

  // An employee: only the Sent tab, read-only requests, nothing to create on the task.
  await page.goto('/approvals');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: ar.approvals.tabs.sent })).toBeVisible();
  await page.getByRole('link', { name: 'مطعم الياسمين' }).first().click();
  await expect(page.getByText('ممتاز، انشروه الخميس.')).toBeVisible();
  await expect(page.getByRole('button', { name: ar.approvals.requestPage.reissue })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ar.approvals.requestPage.revoke })).toHaveCount(0);
  await page.goto(`/tasks/${seedIds.openingStory}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ستوري افتتاح الفرع');
  await expect(page.getByRole('button', { name: ar.tasks.approval.create })).toHaveCount(0);

  // The client's Approvals tab: its requests and its responses, for everyone who reads clients.
  await page.goto(`/clients/${seedIds.jasmine}?tab=approvals`);
  await expect(page.getByRole('row')).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'بوست قائمة المشروبات' })).toBeVisible();
  await expect(page.getByText('غيّروا سعر العرض إلى 45 ألف ليرة.')).toBeVisible();

  // The account manager: the 48-hour notice opens the request, with its actions.
  api.signInAs(accountManagerMe);
  await page.goto('/notifications');
  await page.getByRole('link', { name: /هالة الشامي/ }).click();
  await expect(page).toHaveURL(new RegExp(`/approvals/requests/${seedIds.openRequest}$`));
  await expect(page.getByRole('button', { name: ar.approvals.requestPage.revoke })).toBeVisible();

  // The task ready to send creates its link from the task page.
  await page.goto(`/tasks/${seedIds.openingStory}`);
  const panel = section(page, ar.tasks.approval.title);
  await panel.getByRole('button', { name: ar.tasks.approval.create }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: ar.approvals.request.create }).click();
  await expect(dialog.getByText(ar.approvals.request.issuedTitle)).toBeVisible();
  await dialog.getByRole('button', { name: ar.approvals.request.done }).click();
  await expect(panel.getByText(ar.approvals.states.open)).toBeVisible();
  await expect(panel.getByRole('button', { name: ar.tasks.approval.create })).toHaveCount(0);
});
