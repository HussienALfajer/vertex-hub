import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  ANNOUNCEMENTS_NOW,
  accountManagerMe,
  announcementIds,
  employeeMe,
  manager,
  mockApi,
} from './fixtures';
import { expect, test } from './test';

// F16 part D in the web app: the editor with the audience picker, the announcement page with
// its poll, acknowledgement and receipts, templates, the home pin and the critical dialog,
// against the mocked API (the rules themselves are covered by apps/api/test).

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

const a = ar.announcements;

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(ANNOUNCEMENTS_NOW));
});

/** Picks one entry of an audience source: its chip, then the entry in its search. */
async function pickSource(page: Page, source: keyof typeof ar.audiences.sources, entry: string) {
  const chip = page.getByRole('button', { name: ar.audiences.sources[source], exact: true });
  if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
  await page.getByRole('combobox', { name: ar.audiences.sources[source] }).fill(entry);
  await page.getByRole('option', { name: entry }).click();
}

test('an employee writes an announcement with a poll and sees who it reaches', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe, announcements: true });
  await page.goto('/announcements');
  await page.getByRole('link', { name: a.new }).click();
  await expect(page).toHaveURL(/\/announcements\/new$/);

  await page.getByLabel(a.form.title, { exact: true }).fill('جلسة تصوير المنيو');
  await page
    .getByRole('textbox', { name: a.form.body })
    .fill('نصوّر منيو الخريف يوم الثلاثاء في الاستوديو.');

  // Rule D2: the count and the names show before sending; a name can be left out.
  await expect(page.getByText(ar.audiences.emptyHint)).toBeVisible();
  await pickSource(page, 'departments', 'التصميم');
  await expect(page.getByText(ar.audiences.count_one)).toBeVisible();
  await pickSource(page, 'users', 'د. هبة النجار');
  await expect(page.getByText(fill(ar.audiences.count_two, {}))).toBeVisible();
  await page
    .getByRole('button', { name: fill(ar.audiences.exclude, { name: 'د. هبة النجار' }) })
    .click();
  await expect(page.getByText(ar.audiences.count_one)).toBeVisible();
  await page
    .getByRole('button', { name: fill(ar.audiences.restore, { name: 'د. هبة النجار' }) })
    .click();
  await expect(page.getByText(ar.audiences.count_two)).toBeVisible();

  // Critical and pinning are for managers: the employee sees why.
  await expect(
    page.getByRole('radio', { name: new RegExp(ar.notifications.priorities.critical) }),
  ).toBeDisabled();
  await expect(
    page.getByRole('radio', { name: new RegExp(ar.notifications.priorities.critical) }),
  ).toContainText(a.form.criticalNotAllowed);
  await expect(page.getByRole('switch', { name: a.form.pin })).toBeDisabled();

  await page.getByRole('checkbox', { name: new RegExp(a.form.requiresAck) }).check();
  await page.getByRole('switch', { name: a.form.addPoll }).click();
  await page.getByLabel(a.form.pollQuestion).fill('أي وقت يناسبكم؟');
  await page.getByRole('textbox', { name: fill(a.form.pollOption, { n: '1' }) }).fill('الصباح');
  await page.getByRole('textbox', { name: fill(a.form.pollOption, { n: '2' }) }).fill('الظهر');

  await page.getByRole('button', { name: a.form.submit.now }).click();
  await expect(page.getByText(a.form.done.sent)).toBeVisible();
  await expect(page).toHaveURL(/\/announcements\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'جلسة تصوير المنيو' })).toBeVisible();
  // The author sees the receipts and the poll's results, not a vote.
  await expect(page.getByRole('heading', { name: a.receipts.title })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'أي وقت يناسبكم؟' })).toBeVisible();
  await expect(page.getByRole('button', { name: a.poll.vote })).toHaveCount(0);
});

test('a department manager cannot send a critical announcement outside their departments', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: accountManagerMe, announcements: true });
  await page.goto('/announcements/new');
  await page.getByLabel(a.form.title, { exact: true }).fill('إغلاق الاستوديو');
  await page.getByRole('textbox', { name: a.form.body }).fill('يُغلق الاستوديو غدًا.');
  await pickSource(page, 'departments', 'التصوير');
  await expect(page.getByText(ar.audiences.count_one)).toBeVisible();
  await page.getByRole('radio', { name: new RegExp(ar.notifications.priorities.critical) }).click();
  // Critical forces the acknowledgement (rule D3).
  await expect(page.getByRole('checkbox', { name: new RegExp(a.form.requiresAck) })).toBeChecked();
  await page.getByRole('button', { name: a.form.submit.now }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: ar.errors.FORBIDDEN_AUDIENCE }).first(),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/announcements\/new$/);
});

test('a recipient opens a pinned announcement, votes and acknowledges it', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe, announcements: true });
  await page.goto('/');
  const pinned = page.getByRole('region', { name: a.home.title });
  await expect(pinned).toContainText('مواعيد الدوام في رمضان');
  await expect(pinned).toContainText(a.receipt.needsAck);
  // Folding is the recipient's own: the title stays.
  await pinned
    .getByRole('button', { name: fill(a.home.fold, { title: 'مواعيد الدوام في رمضان' }) })
    .click();
  await expect(pinned.getByText(/يبدأ الدوام/)).toHaveCount(0);
  await pinned.getByRole('link', { name: 'مواعيد الدوام في رمضان' }).click();

  await expect(page).toHaveURL(new RegExp(`/announcements/${announcementIds.ramadan}$`));
  const main = page.getByRole('main');
  await expect(main.getByText('الساعة العاشرة صباحًا')).toBeVisible();
  await expect(main.getByRole('link', { name: /جدول الدوام/ })).toHaveAttribute(
    'href',
    'https://vertex.example/ramadan',
  );
  // Results show only once the recipient voted (rule D11).
  await expect(main.getByText(a.poll.resultsAfterVoting)).toHaveCount(0);
  await main.getByRole('radio', { name: 'الخميس الثاني' }).click();
  await main.getByRole('button', { name: a.poll.vote }).click();
  await expect(page.getByText(a.poll.voted)).toBeVisible();
  await expect(main.getByText(a.poll.myChoice)).toBeVisible();
  await expect(main.getByText(fill(a.poll.voters_few, { n: '3' }))).toBeVisible();
  // Recipients never see who voted for what, and no receipts.
  await expect(main.getByText('عمر حداد')).toHaveCount(0);
  await expect(main.getByRole('heading', { name: a.receipts.title })).toHaveCount(0);

  await main.getByRole('button', { name: a.acknowledge }).click();
  await expect(page.getByText(a.acknowledged)).toBeVisible();
  await expect(main.getByRole('button', { name: a.acknowledge })).toHaveCount(0);
});

test('the author reads the receipts and reminds those who have not acknowledged', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager, announcements: true });
  await page.goto(`/announcements/${announcementIds.ramadan}`);
  const receipts = page.getByRole('main');
  await expect(receipts.getByRole('heading', { name: a.receipts.title })).toBeVisible();
  await receipts.getByRole('button', { name: a.receipts.filters.not_acknowledged }).click();
  await expect(receipts.getByRole('row', { name: /كريم الزين/ })).toContainText(
    fill(a.receipts.reminders_one, {}),
  );
  await expect(receipts.getByRole('row', { name: /ليان الأحمد/ })).toHaveCount(0);
  // A named poll shows the author who voted for what.
  await expect(receipts.getByText('عمر حداد').first()).toBeVisible();

  await receipts.getByRole('button', { name: a.receipts.remind }).click();
  await expect(page.getByText(a.receipts.reminded_two)).toBeVisible();
  // Once an hour: the second reminder is refused.
  await receipts.getByRole('button', { name: a.receipts.remind }).click();
  await expect(receipts.getByRole('alert')).toBeVisible();
});

test('the author edits a sent announcement: audience and priority stay locked', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager, announcements: true });
  await page.goto(`/announcements/${announcementIds.ramadan}`);
  await page.getByRole('main').getByRole('link', { name: ar.common.edit }).click();
  await expect(page.getByRole('heading', { name: a.form.editTitle })).toBeVisible();
  await expect(page.getByText(a.form.locked).first()).toBeVisible();
  await expect(
    page.getByRole('radio', { name: new RegExp(ar.notifications.priorities.important) }),
  ).toBeDisabled();
  // Someone voted: the poll is locked too.
  await expect(page.getByText(a.form.pollVoted)).toBeVisible();
  await page.getByLabel(a.form.title, { exact: true }).fill('مواعيد الدوام في رمضان (محدّثة)');
  await page.getByRole('checkbox', { name: new RegExp(a.form.notifyAgain) }).check();
  await page.getByRole('button', { name: a.form.submit.save }).click();
  await expect(page.getByRole('heading', { name: 'مواعيد الدوام في رمضان (محدّثة)' })).toBeVisible();
  await expect(page.getByText(/^عُدّل/)).toBeVisible();
});

test('start from a template, save a draft, then discard it', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager, announcements: true });
  await page.goto('/announcements/new');
  await page.getByRole('button', { name: a.templates.start }).click();
  const dialog = page.getByRole('dialog', { name: a.templates.title });
  await expect(dialog.getByText(a.templates.personal)).toBeVisible();
  await expect(dialog.getByText(a.templates.shared)).toBeVisible();
  await dialog
    .getByRole('listitem')
    .filter({ hasText: 'إجازة رسمية' })
    .getByRole('button', { name: a.templates.use })
    .click();
  await expect(page.getByLabel(a.form.title, { exact: true })).toHaveValue('عطلة رسمية');
  await expect(page.getByRole('textbox', { name: a.form.body })).toContainText('تُغلق الشركة');

  await pickSource(page, 'departments', 'التصميم');
  await page.getByRole('button', { name: a.form.sendModes.draft }).click();
  await page.getByRole('button', { name: a.form.submit.draft }).click();
  await expect(page.getByText(a.form.done.draft)).toBeVisible();
  await expect(page).toHaveURL(/\/announcements\/[0-9a-f-]+\/edit$/);
  // The toast sits over the form's last row: close it.
  await page
    .getByRole('dialog', { name: a.form.done.draft })
    .getByRole('button', { name: ar.common.close })
    .click();

  await page.getByRole('button', { name: a.form.discard }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: a.form.discard }).click();
  await expect(page).toHaveURL(/\/announcements\?view=sent$/);
  await expect(page.getByRole('link', { name: 'عطلة رسمية' })).toHaveCount(0);
});

test('only managers read every announcement; withdrawn ones stay marked for them', async ({
  page,
}) => {
  const api = await mockApi(page, { signedIn: true, me: employeeMe, announcements: true });
  await page.goto('/announcements');
  const tabs = page.getByRole('tablist', { name: a.view });
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'تغيير مكان الاجتماع' })).toHaveCount(0);

  api.signInAs(manager);
  await page.reload();
  await tabs.getByRole('tab', { name: a.views.all }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'تغيير مكان الاجتماع' });
  await expect(row).toContainText(a.statuses.withdrawn);
});

test('a critical announcement blocks the app until it is acknowledged', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe, criticalAnnouncement: true });
  await page.goto('/');
  const dialog = page.getByRole('alertdialog', { name: 'إخلاء المكتب للصيانة غدًا' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('احفظوا ملفاتكم')).toBeVisible();
  // No close button, and Escape does not close it (rule D6).
  await expect(dialog.getByRole('button', { name: ar.common.close })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: a.acknowledge }).click();
  await expect(dialog).toBeHidden();
});

test('sending without an audience says so and focuses the picker', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/announcements/new');
  await page.getByLabel(a.form.title, { exact: true }).fill('جلسة تصوير المنيو');
  await page.getByRole('textbox', { name: a.form.body }).fill('نصوّر يوم الثلاثاء.');
  await page.getByRole('button', { name: a.form.submit.now }).click();
  await expect(page.getByText(a.form.errors.audience)).toBeVisible();
  await expect(
    page.getByRole('button', { name: ar.audiences.sources.everyone, exact: true }),
  ).toBeFocused();
  await expect(page).toHaveURL(/\/announcements\/new$/);
});
