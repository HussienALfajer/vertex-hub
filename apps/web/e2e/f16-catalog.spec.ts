import type { Notification, NotificationType } from '@vertex-hub/contracts';
import { notificationText } from '@vertex-hub/messages';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { catalogNotificationsSeed, mockApi, type NotificationRecord, seedIds } from './fixtures';
import { expect, test } from './test';

// F16 part C in the web app: the catalog's new types render their text and open their record
// (acceptance step C7). Who receives what is covered by apps/api/test.

/** Where each seeded type leads, and the tab it opens on. */
const LINKS: Partial<Record<NotificationType, { url: RegExp; tab?: string }>> = {
  payment_recorded: { url: new RegExp(`/invoices/${seedIds.overdueInvoice}$`) },
  quote_expiring: { url: new RegExp(`/quotes/${seedIds.sentQuote}$`) },
  milestone_completed: { url: new RegExp(`/projects/${seedIds.identityProject}$`) },
  post_published: { url: new RegExp(`/content/posts/${seedIds.openingPost}$`) },
  approval_opened: { url: new RegExp(`/approvals/requests/${seedIds.openRequest}$`) },
  contract_signed: {
    url: new RegExp(`/retainers/${seedIds.socialRetainer}\\?tab=contract$`),
    tab: ar.retainers.page.tabs.contract,
  },
  extra_work_created: {
    url: new RegExp(`/projects/${seedIds.identityProject}\\?tab=extra-work$`),
    tab: ar.projects.page.tabs.extraWork,
  },
  campaign_status_changed: { url: new RegExp(`/campaigns/${seedIds.autumnCampaign}$`) },
  department_manager_assigned: { url: new RegExp(`/departments/${seedIds.design}$`) },
  meeting_starting: { url: new RegExp(`/meetings/${seedIds.contentMeeting}$`) },
};

const departmentNames: Record<string, string> = { design: 'التصميم' };

const textOf = (record: NotificationRecord) =>
  notificationText(record as Notification, (code) => departmentNames[code] ?? '').text;

const seed = { signedIn: true, approvals: true, content: true, calendar: true } as const;

for (const record of catalogNotificationsSeed()) {
  test(`${record.type} renders its text and opens its record`, async ({ page }) => {
    const link = LINKS[record.type];
    if (!link) throw new Error(`No expected link for ${record.type}`);
    await mockApi(page, { ...seed, notifications: [record] });
    await page.goto(`/notifications?inbox=${record.inbox}`);
    await page
      .getByRole('main')
      .getByRole('link', { name: textOf(record), exact: true })
      .click();
    await expect(page).toHaveURL(link.url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    if (link.tab) {
      await expect(page.getByRole('tab', { name: link.tab })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
  });
}

test('a meeting about to start offers its link from the bell', async ({ page }) => {
  const meeting = catalogNotificationsSeed().filter((item) => item.type === 'meeting_starting');
  await mockApi(page, { ...seed, notifications: meeting });
  await page.goto('/');
  await page
    .getByRole('button', { name: ar.notifications.bellUnread.replace('{{count}}', '1') })
    .click();
  const panel = page.getByRole('dialog', { name: ar.notifications.title });
  await panel.getByRole('tab', { name: ar.notifications.inboxes.fyi }).click();

  const join = panel.getByRole('link', { name: ar.notifications.join });
  await expect(join).toHaveAttribute('href', 'https://meet.example.com/content-plan');
  await expect(join).toHaveAttribute('target', '_blank');
});
