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

// F11 calendar and shoot flows against the mocked API (the real rules are covered by apps/api/test).

/** Freezes the browser's clock on the seeded "today" so the calendar and the forms are stable. */
async function onToday(page: Page) {
  await page.clock.setFixedTime(new Date(`${PROJECTS_TODAY}T09:00:00+03:00`));
}

const pick = async (page: Page, combobox: ReturnType<Page['getByRole']>, option: string) => {
  await combobox.click();
  // The list of the select picked before may still be closing (its options fading out): pick from
  // the list that is open now, once it has settled.
  const list = page.locator('[data-slot="select-content"][data-open]:not([data-starting-style])');
  await list.getByRole('option', { name: option }).click();
};

test('book a shoot from a task with a conflict warning → tick → close creates the editing task', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 2200 });
  await onToday(page);
  const api = await mockApi(page, { signedIn: true, me: accountManagerMe, calendar: true });

  // The account manager books from the client's open Photography task.
  await page.goto(`/tasks/${seedIds.dishShoot}`);
  await page.getByRole('link', { name: ar.calendar.actions.bookShoot }).click();
  await expect(page).toHaveURL(/\/shoots\/new\?taskId=/);
  await expect(page.getByLabel(ar.calendar.form.title)).toHaveValue('جلسة تصوير الأطباق');

  // Validation in place: the type, the time, the place and the crew are required.
  await page.getByRole('button', { name: ar.calendar.form.book }).click();
  await expect(page.getByText(ar.calendar.form.errors.type)).toBeVisible();
  await expect(page.getByText(ar.calendar.form.errors.time)).toBeVisible();
  await expect(page.getByText(ar.calendar.form.errors.location)).toBeVisible();
  await expect(page.getByText(ar.calendar.form.errors.crew)).toBeVisible();

  await page.getByRole('button', { name: ar.calendar.shootTypes.product }).click();
  await page.getByLabel(ar.calendar.form.date).fill('2026-10-12');
  await page.getByLabel(ar.calendar.form.startTime).fill('11:00');
  await page.getByLabel(ar.calendar.form.endTime).fill('14:00');
  await page.getByLabel(ar.calendar.form.location, { exact: true }).fill('استوديو فيرتكس');
  const members = page.getByRole('combobox', { name: ar.calendar.form.crewMember });
  await pick(page, members.first(), 'كريم الزين');
  await page.getByRole('button', { name: ar.calendar.form.addCrew }).click();
  await pick(page, members.nth(1), 'ليان الأحمد');
  await page.getByRole('button', { name: ar.calendar.form.addShot }).click();
  await page.getByLabel('اللقطة 1', { exact: true }).fill('الطبق الرئيسي من الأعلى');

  // Rule 5: both are booked that morning; the form lists it before saving.
  await expect(page.getByText(ar.calendar.form.conflictsBody)).toBeVisible();
  await expect(page.getByText('ليان الأحمد: الاجتماع «خطة محتوى تشرين الثاني»')).toBeVisible();
  await expect(page.getByText('كريم الزين: جلسة التصوير «أطباق الخريف»')).toBeVisible();

  // Saving asks first, then sends `acceptConflicts`.
  await page.getByRole('button', { name: ar.calendar.form.book }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText(ar.calendar.form.confirmConflictsTitle)).toBeVisible();
  await confirm.getByRole('button', { name: ar.calendar.form.saveAnyway }).click();
  await expect(page.getByText(ar.calendar.form.booked)).toBeVisible();
  await expect(page).toHaveURL(/\/shoots\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('جلسة تصوير الأطباق');
  await expect(page.locator('section').first().locator('[data-conflict]')).toBeVisible();

  // The task shows its shoot, and is due on the shoot's day.
  await page.goto(`/tasks/${seedIds.dishShoot}`);
  await expect(page.getByRole('link', { name: 'جلسة تصوير الأطباق' })).toBeVisible();
  await expect(page.getByRole('link', { name: ar.calendar.actions.bookShoot })).toHaveCount(0);
  await expect(page.getByText(/12 تشرين الأول 2026/).first()).toBeVisible();

  // Edge case 1: the task is taken by now; a second booking from it is refused, and says why.
  await page.goto(`/shoots/new?taskId=${seedIds.dishShoot}`);
  await page.getByRole('button', { name: ar.calendar.shootTypes.product }).click();
  await page.getByLabel(ar.calendar.form.date).fill('2026-10-15');
  await page.getByLabel(ar.calendar.form.startTime).fill('10:00');
  await page.getByLabel(ar.calendar.form.endTime).fill('11:00');
  await page.getByLabel(ar.calendar.form.location, { exact: true }).fill('استوديو فيرتكس');
  await pick(page, members.first(), 'كريم الزين');
  await page.getByRole('button', { name: ar.calendar.form.book }).click();
  await expect(page.getByRole('alert').getByText(ar.errors.TASK_NOT_BOOKABLE)).toBeVisible();

  // On a phone, the lead ticks the last shot of this morning's shoot, then closes it.
  api.signInAs(employeeMe);
  await page.setViewportSize({ width: 390, height: 1600 });
  await page.goto(`/shoots/${seedIds.coffeeShoot}`);
  const logo = page.getByRole('checkbox', { name: /لقطة قريبة لشعار الكيس/ });
  await expect(page.getByText('المنجز 2 من 3')).toBeVisible();
  await logo.click();
  await expect(page.getByText('المنجز 3 من 3')).toBeVisible();
  await logo.click();
  await expect(page.getByText('المنجز 2 من 3')).toBeVisible();

  await page.getByRole('button', { name: ar.calendar.actions.close }).click();
  const dialog = page.getByRole('dialog');
  // The unticked shot is a warning, never a block; the editing task is proposed for the lead.
  await expect(dialog.getByText('لم تُنجز 1 من 3 في قائمة اللقطات')).toBeVisible();
  await expect(dialog.getByRole('switch', { name: /أنشئ مهمة المونتاج/ })).toBeChecked();
  await expect(dialog.getByLabel(ar.calendar.close.taskTitle)).toHaveValue(
    'مونتاج: منتجات ركن القهوة',
  );
  await expect(dialog.getByRole('combobox', { name: ar.calendar.close.assignee })).toHaveText(
    /كريم الزين/,
  );
  // Three work days after the Saturday it is closed on.
  await expect(dialog.getByLabel(ar.calendar.close.dueDate)).toHaveValue('2026-10-13');
  await dialog
    .getByLabel(new RegExp(`^${ar.calendar.close.rawFilesUrl}`))
    .fill('https://drive.google.com/drive/folders/coffee-raw');
  await dialog.getByRole('button', { name: ar.calendar.close.action }).click();
  await expect(page.getByText(ar.calendar.close.doneWithTask)).toBeVisible();
  const hero = page.locator('section').first();
  await expect(hero.locator('[data-status="completed"]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'مونتاج: منتجات ركن القهوة' })).toBeVisible();
  await expect(page.getByRole('link', { name: /drive\.google\.com/ })).toBeVisible();
  // Closing is final: no action is left, and the list is read-only.
  await expect(page.getByRole('button', { name: ar.calendar.actions.close })).toHaveCount(0);
  await expect(logo).toBeDisabled();

  // The editing task carries the raw files link and waits on the delivered shoot task.
  await page.getByRole('link', { name: 'مونتاج: منتجات ركن القهوة' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مونتاج: منتجات ركن القهوة');
  await expect(page.getByRole('link', { name: /coffee-raw/ })).toBeVisible();
});

test('cancel with a reason, reopen despite a conflict, and the calendar filters', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1500 });
  await onToday(page);
  await mockApi(page, { signedIn: true, me: manager, calendar: true });

  // The month shows shoots, meetings and key dates; the double-booked ones are marked.
  await page.goto('/calendar');
  const autumn = page.getByRole('link', { name: /أطباق الخريف/ });
  await expect(autumn).toBeVisible();
  await expect(autumn.locator('[data-conflict]')).toBeVisible();
  await expect(page.getByText('خطة محتوى تشرين الثاني').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /تجديد عقد/ }).first()).toBeVisible();
  await expect(page.locator('[data-shoot-status="cancelled"]')).toBeVisible();
  // Edge case 9: a booking of an archived client stays, with the client marked.
  await expect(page.getByText(/عميل تجريبي \(مؤرشف\)/).first()).toBeVisible();

  // "Mine": the General Manager is on no crew, but organizes and attends meetings.
  await page.getByRole('button', { name: ar.calendar.filters.mine }).click();
  await expect(page).toHaveURL(/userId=me/);
  await expect(page.getByText('خطة محتوى تشرين الثاني').first()).toBeVisible();
  await expect(autumn).toHaveCount(0);
  await page.getByRole('button', { name: ar.calendar.filters.clear }).click();

  // Cancelling needs a reason.
  await autumn.click();
  await page.getByRole('button', { name: ar.calendar.actions.more }).click();
  await page.getByRole('menuitem', { name: ar.calendar.actions.cancel }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: ar.calendar.cancel.action }).click();
  await expect(dialog.getByText(ar.calendar.cancel.errors.reason)).toBeVisible();
  await dialog.getByLabel(ar.calendar.cancel.reason).fill('المطبخ مغلق للصيانة ذلك اليوم.');
  await dialog.getByRole('button', { name: ar.calendar.cancel.action }).click();
  await expect(page.getByText(ar.calendar.cancel.done, { exact: true })).toBeVisible();
  await expect(page.getByText('السبب: المطبخ مغلق للصيانة ذلك اليوم.')).toBeVisible();
  await expect(page.getByRole('link', { name: ar.calendar.actions.edit })).toHaveCount(0);

  // Reopening runs the conflict check again and asks before going on.
  await page.getByRole('button', { name: ar.calendar.actions.reopen }).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.getByRole('button', { name: ar.calendar.actions.reopen }).click();
  await expect(confirm.getByText('ليان الأحمد: الاجتماع «خطة محتوى تشرين الثاني»')).toBeVisible();
  await confirm.getByRole('button', { name: ar.calendar.reopen.anyway }).click();
  await expect(page.getByText(ar.calendar.reopen.done)).toBeVisible();
  await expect(page.locator('section').first().locator('[data-status="scheduled"]')).toBeVisible();
});

test('a user without shoot scope sees the calendar and the shoot, but no actions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await onToday(page);
  await mockApi(page, { signedIn: true, me: medicalReviewerMe, calendar: true });

  await page.goto('/calendar');
  await expect(page.getByRole('link', { name: /أطباق الخريف/ })).toBeVisible();
  await expect(page.getByRole('link', { name: ar.calendar.actions.bookShoot })).toHaveCount(0);

  await page.getByRole('link', { name: /أطباق الخريف/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('أطباق الخريف');
  await expect(page.getByRole('link', { name: ar.calendar.actions.edit })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ar.calendar.actions.close })).toHaveCount(0);
  await expect(page.getByRole('button', { name: ar.calendar.actions.more })).toHaveCount(0);
  await expect(page.getByRole('checkbox').first()).toBeDisabled();
  // The freelancer's phone is one tap away for everyone on the day.
  await expect(page.getByRole('link', { name: '+963955700800' })).toHaveAttribute(
    'href',
    'tel:+963955700800',
  );

  // The booking form is not theirs to open.
  await page.goto('/shoots/new');
  await expect(page).toHaveURL(/\/calendar$/);
});

test('create a meeting with a conflict warning → open it → edit → cancel', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1500 });
  await onToday(page);
  await mockApi(page, { signedIn: true, me: manager, calendar: true });

  await page.goto('/calendar');
  await page.getByRole('button', { name: ar.calendar.actions.newMeeting }).click();
  const dialog = page.getByRole('dialog');

  // Validation in place: the title and the time are required.
  await dialog.getByRole('button', { name: ar.calendar.meetings.form.create }).click();
  await expect(dialog.getByText(ar.calendar.meetings.form.errors.title)).toBeVisible();
  await expect(dialog.getByText(ar.calendar.meetings.form.errors.time)).toBeVisible();

  await dialog.getByLabel(ar.calendar.meetings.form.title).fill('تحضير تصوير الأطباق');
  await pick(
    page,
    dialog.getByRole('combobox', { name: ar.calendar.form.client }),
    'مطعم الياسمين',
  );
  await dialog.getByLabel(ar.calendar.form.date).fill('2026-10-12');
  await dialog.getByLabel(ar.calendar.form.startTime).fill('10:30');
  await dialog.getByLabel(ar.calendar.form.endTime).fill('11:30');
  await dialog.getByLabel(new RegExp(`^${ar.calendar.meetings.attendees}`)).fill('كريم');
  await page.getByRole('option', { name: 'كريم الزين' }).click();
  // The contacts of the picked client are offered.
  await dialog.getByLabel(new RegExp(`^${ar.calendar.meetings.contacts}`)).fill('هالة');
  await page.getByRole('option', { name: 'هالة الشامي' }).click();

  // Rule 5: the attendee is on a shoot then; the dialog lists it before saving.
  const clash = 'كريم الزين: جلسة التصوير «أطباق الخريف»';
  await expect(dialog.getByText(clash)).toBeVisible();

  // Saving asks first, then sends `acceptConflicts`.
  await dialog.getByRole('button', { name: ar.calendar.meetings.form.create }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText(ar.calendar.form.confirmConflictsTitle)).toBeVisible();
  await confirm.getByRole('button', { name: ar.calendar.form.saveAnyway }).click();
  await expect(page.getByText(ar.calendar.meetings.form.created)).toBeVisible();

  // Both bookings carry the conflict mark on the calendar; the meeting opens its page.
  const card = page.getByRole('link', { name: /تحضير تصوير الأطباق/ });
  await expect(card.locator('[data-conflict]')).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('تحضير تصوير الأطباق');
  await expect(page.getByText(clash)).toBeVisible();
  await expect(page.getByRole('link', { name: '+963944555666' })).toHaveAttribute(
    'href',
    'tel:+963944555666',
  );

  // Moving it after the shoot clears the warning, and saving no longer asks.
  await page.getByRole('button', { name: ar.calendar.meetings.actions.edit }).click();
  await expect(dialog.getByLabel(ar.calendar.meetings.form.title)).toHaveValue(
    'تحضير تصوير الأطباق',
  );
  await dialog.getByLabel(ar.calendar.form.startTime).fill('14:00');
  await dialog.getByLabel(ar.calendar.form.endTime).fill('15:00');
  await expect(dialog.getByText(clash)).toHaveCount(0);
  await dialog.getByRole('button', { name: ar.calendar.form.save }).click();
  await expect(page.getByText(ar.calendar.meetings.form.saved)).toBeVisible();
  const hero = page.locator('section').first();
  await expect(hero.locator('[data-conflict]')).toHaveCount(0);

  // Cancelling is final: the reason shows and the meeting can no longer be edited.
  await page.getByRole('button', { name: ar.calendar.actions.more }).click();
  await page.getByRole('menuitem', { name: ar.calendar.meetings.actions.cancel }).click();
  await dialog.getByLabel(new RegExp(`^${ar.calendar.cancel.reason}`)).fill('طلب العميل التأجيل.');
  await dialog.getByRole('button', { name: ar.calendar.meetings.actions.cancel }).click();
  await expect(page.getByText(ar.calendar.meetings.cancel.done, { exact: true })).toBeVisible();
  await expect(page.getByText('السبب: طلب العميل التأجيل.')).toBeVisible();
  await expect(hero.locator('[data-status="cancelled"]')).toBeVisible();
  await expect(page.getByRole('button', { name: ar.calendar.meetings.actions.edit })).toHaveCount(
    0,
  );
  // The menu left with the meeting's actions: the focus goes to the heading.
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
});

test('an employee creates meetings and edits only the ones they organize', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await onToday(page);
  await mockApi(page, { signedIn: true, me: employeeMe, calendar: true });

  // Someone else's meeting: everything is readable, nothing is editable.
  await page.goto(`/meetings/${seedIds.contentMeeting}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('خطة محتوى تشرين الثاني');
  await expect(page.getByRole('link', { name: /meet\.google\.com/ })).toBeVisible();
  await expect(page.getByRole('button', { name: ar.calendar.meetings.actions.edit })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: ar.calendar.actions.more })).toHaveCount(0);

  // Every user creates a meeting and becomes its organizer.
  await page.goto('/calendar');
  await page.getByRole('button', { name: ar.calendar.actions.newMeeting }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(ar.calendar.meetings.form.title).fill('تجهيز معدات التصوير');
  await dialog.getByLabel(ar.calendar.form.date).fill('2026-10-15');
  await dialog.getByLabel(ar.calendar.form.startTime).fill('09:00');
  await dialog.getByLabel(ar.calendar.form.endTime).fill('09:30');
  await dialog.getByRole('button', { name: ar.calendar.meetings.form.create }).click();
  await expect(page.getByText(ar.calendar.meetings.form.created)).toBeVisible();
  await page.getByRole('link', { name: /تجهيز معدات التصوير/ }).click();
  await expect(page.getByRole('button', { name: ar.calendar.meetings.actions.edit })).toBeVisible();
  // Archiving stays with meeting scope `all`.
  await page.getByRole('button', { name: ar.calendar.actions.more }).click();
  await expect(
    page.getByRole('menuitem', { name: ar.calendar.meetings.actions.cancel }),
  ).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: ar.calendar.meetings.actions.archive }),
  ).toHaveCount(0);
});
