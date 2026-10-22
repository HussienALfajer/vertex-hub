import type { Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  attendanceCode,
  EXPIRED_MAC,
  employeeMe,
  HR_NOW,
  manager,
  mockApi,
  OFF_NETWORK_MAC,
  seedIds,
} from './fixtures';
import { expect, test } from './test';

// F17 part C in the web app: the attendance passkey, punches (the entrance code's link, field
// work), the month and its items, remote days and corrections, the Today board, the items in
// Approvals, the file's Attendance tab, HR settings and the entrance screen, against the mocked
// API (the rules themselves are covered by apps/api/test/hr-attendance*.test.ts).

const a = ar.hr.attendance;
const items = ar.hr.items;

/** WebAuthn needs a domain, not an IP address: the passkey specs open the app on `localhost`. */
const LOCAL = 'http://localhost:4173';

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(HR_NOW));
});

/** Chromium's virtual platform authenticator: verifies the user without a prompt. */
async function phoneAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

/** Signs Karim in on `localhost` with a phone, and registers its passkey (rule C3). */
async function employeeWithPasskey(page: Page) {
  await phoneAuthenticator(page);
  await page.context().grantPermissions(['geolocation'], { origin: LOCAL });
  await page.context().setGeolocation({ latitude: 33.5138, longitude: 36.2765, accuracy: 20 });
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto(`${LOCAL}/me/attendance`);
  const card = page.getByTestId('today-card');
  await expect(card.getByText(a.passkey.missingTitle)).toBeVisible();
  await page.getByRole('button', { name: a.passkey.register }).click();
  await page.getByRole('button', { name: a.passkey.confirm }).click();
  await expect(page.getByText(a.passkey.registered)).toBeVisible();
  await expect(page.getByTestId('passkey-card').getByText(a.passkey.active)).toBeVisible();
  return card;
}

test('an employee registers the passkey and checks in from the entrance code', async ({ page }) => {
  const card = await employeeWithPasskey(page);
  await expect(card.getByTestId('punch-office')).toHaveText(a.actions.scanIn);

  // The phone's camera opens the code's link (rule C5); the passkey needs a tap.
  await page.goto(`${LOCAL}/attend#${attendanceCode()}`);
  await page.getByRole('button', { name: a.attend.confirm }).click();
  const confirm = page.getByRole('dialog', { name: a.confirm.in });
  await expect(confirm.getByText(a.confirm.methods.office)).toBeVisible();
  await confirm.getByTestId('punch-confirm').click();
  await expect(page.getByTestId('attendance-greeting')).toContainText(
    fill(a.greeting.morning, { name: 'كريم' }),
  );

  await page.goto(`${LOCAL}/me/attendance`);
  await expect(card.getByText('المدخل الرئيسي')).toBeVisible();
  await expect(card.getByTestId('punch-office')).toHaveText(a.actions.scanOut);
});

test('an entrance code from outside the office, or an old one, is refused in plain words', async ({
  page,
}) => {
  await employeeWithPasskey(page);
  await page.goto(`${LOCAL}/attend#${attendanceCode(OFF_NETWORK_MAC)}`);
  await page.getByRole('button', { name: a.attend.confirm }).click();
  await expect(page.getByRole('alert')).toContainText(ar.errors.OFF_OFFICE_NETWORK);
  await expect(page.getByRole('button', { name: a.attend.scanAgain })).toBeVisible();

  await page.goto(`${LOCAL}/attend#${attendanceCode(EXPIRED_MAC)}`);
  await page.getByRole('button', { name: a.attend.confirm }).click();
  await expect(page.getByRole('alert')).toContainText(ar.errors.INVALID_CODE);
});

test('field work takes a reason and names one of today’s tasks (rule C11)', async ({ page }) => {
  const card = await employeeWithPasskey(page);
  await card.getByRole('button', { name: a.actions.field }).click();
  const dialog = page.getByRole('dialog', { name: a.field.title });
  await dialog.getByRole('button', { name: a.field.submit }).click();
  await expect(dialog.getByText(a.field.noteRequired)).toBeVisible();
  await dialog.getByLabel(a.field.note).fill('تصوير في موقع العميل');
  await dialog.getByRole('combobox', { name: a.field.work }).click();
  await page
    .getByRole('option', { name: fill(a.field.task, { title: 'تصوير منتجات المطعم' }) })
    .click();
  await dialog.getByRole('button', { name: a.field.submit }).click();
  await page.getByRole('dialog', { name: a.confirm.in }).getByTestId('punch-confirm').click();
  await expect(page.getByTestId('attendance-greeting')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card.getByText(/تصوير منتجات المطعم/)).toBeVisible();
  await expect(card.getByRole('link', { name: a.openInMaps })).toBeVisible();
});

test('the month shows the days and the employee justifies a pending item', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/me/attendance?tab=month');
  await expect(
    page.locator('[data-day="2026-10-14"]').getByText(a.dayStatuses.partial),
  ).toBeVisible();
  const late = page.locator(`[data-item="${'01920000-0000-7000-8000-000000009931'}"]`);
  await expect(late.getByText(items.statuses.pending)).toBeVisible();
  await late.getByRole('button', { name: items.justify }).click();
  const dialog = page.getByRole('dialog', { name: items.justifyTitle });
  await dialog.getByLabel(items.justification).fill('موعد طبيب صباحي');
  await dialog.getByRole('button', { name: items.sendJustification }).click();
  await expect(page.getByText(items.justificationSent)).toBeVisible();
  await expect(late.getByText('موعد طبيب صباحي')).toBeVisible();

  // A day opens with its punches.
  await page.locator('[data-day="2026-10-14"]').getByRole('button').click();
  await expect(page.getByRole('dialog').getByText(a.directions.in).first()).toBeVisible();
});

test('remote days and corrections are requests with their preview (rule C19)', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe });
  await page.goto('/me/attendance?tab=requests');
  const r = ar.hr.requests;
  await page.getByRole('button', { name: r.new.title }).first().click();
  const dialog = page.getByRole('dialog', { name: r.new.title });
  await dialog.getByRole('button', { name: r.kinds.remote_day }).click();
  await dialog.getByLabel(r.fields.startsOn, { exact: true }).fill('2026-10-25');
  await dialog.getByLabel(r.fields.endsOn, { exact: true }).fill('2026-10-26');
  await expect(dialog.getByTestId('request-preview')).toContainText(r.days_two);
  await dialog.getByLabel(r.fields.reason).fill('صيانة في المنزل');
  await dialog.getByRole('button', { name: r.new.submit }).click();
  await expect(page.getByText(r.new.submitted)).toBeVisible();
  await expect(page.getByText(r.kinds.remote_day).first()).toBeVisible();

  await page.getByRole('button', { name: r.new.title }).first().click();
  await dialog.getByRole('button', { name: r.kinds.correction }).click();
  await dialog.getByRole('button', { name: a.directions.out }).click();
  await dialog.getByLabel(r.fields.date).fill('2026-10-20');
  await dialog.getByLabel(r.fields.time).fill('17:10');
  await dialog.getByLabel(r.fields.reason).fill('نسيت تسجيل الانصراف');
  await expect(dialog.getByText(r.preview.ok.correction)).toBeVisible();
  await dialog.getByRole('button', { name: r.new.submit }).click();
  await expect(page.getByText(r.new.submitted).last()).toBeVisible();
});

test('the General Manager sees today, rejects a field punch and decides the items', async ({
  page,
}) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: ar.nav.label });
  await nav.getByRole('link', { name: ar.nav.hrToday }).click();
  await expect(page).toHaveURL(/\/hr\/today$/);
  const t = ar.hr.today;
  await expect(page.locator('[data-count="in"]')).toContainText('2');
  await expect(page.getByText(ar.errors.OFF_OFFICE_NETWORK)).toBeVisible();
  const field = page.getByRole('region', { name: t.groups.field });
  await expect(field.getByText(/تصوير منتجات المطعم/)).toBeVisible();
  await field.getByRole('button', { name: t.reject }).click();
  const reject = page.getByRole('dialog', { name: t.rejectTitle });
  await reject.getByRole('button', { name: t.reject }).click();
  await expect(reject.getByText(t.rejectNoteRequired)).toBeVisible();
  await reject.getByLabel(t.rejectNote).fill('الموقع لا يطابق المهمة');
  await reject.getByRole('button', { name: t.reject }).click();
  await expect(page.getByText(t.rejected)).toBeVisible();

  // Items in Approvals: one opened and decided, then a proposal applied to another.
  await page.goto('/hr/approvals?view=items');
  await expect(page.locator('[data-item]')).toHaveCount(4);
  await page.locator('[data-item]').last().getByRole('link').click();
  await expect(page.getByText('ازدحام على طريق المزة')).toBeVisible();
  await page.getByRole('button', { name: items.decide }).click();
  const decide = page.getByRole('dialog', { name: items.decideTitle });
  await expect(decide.getByRole('combobox', { name: items.fraction })).toHaveText(
    ar.hr.settings.fractions.half,
  );
  await decide.getByRole('button', { name: items.saveDecision }).click();
  await expect(page.getByText(items.decided)).toBeVisible();
  await expect(page.getByText(items.statuses.deducted).first()).toBeVisible();

  await page.goto('/hr/approvals?view=items');
  await expect(page.locator('[data-item]')).toHaveCount(3);
  const absence = page.locator('[data-item]').filter({ hasText: items.kinds.absence });
  await absence.getByRole('checkbox').click();
  const lateness = page.locator('[data-item]').filter({ hasText: items.kinds.lateness });
  await expect(lateness.getByRole('checkbox'), 'another proposal').toBeDisabled();
  await page.getByRole('button', { name: items.bulk.apply }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: items.bulk.apply }).click();
  await expect(page.getByText(items.bulk.done)).toBeVisible();
  await expect(page.locator('[data-item]')).toHaveCount(2);
});

test('People shows the passkey, and the file’s Attendance tab revokes one', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/hr/people');
  await expect(
    page.getByRole('columnheader', { name: ar.hr.people.columns.passkey }),
  ).toBeVisible();
  await expect(
    page.getByRole('row', { name: /نور السيد/ }).getByText(a.passkey.active),
  ).toBeVisible();
  await expect(
    page.getByRole('row', { name: /كريم الزين/ }).getByText(a.passkey.none),
  ).toBeVisible();

  await page.goto(`/hr/people/${seedIds.nour}?tab=attendance`);
  await expect(page.getByText('Chrome · Android')).toBeVisible();
  await page.getByRole('button', { name: a.passkey.revoke }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: a.passkey.revoke }).click();
  await expect(page.getByText(a.passkey.revoked)).toBeVisible();
  await expect(page.getByText(a.passkey.statuses.revoked)).toBeVisible();
  // The overtime of 12 October waits for a decision.
  await expect(page.getByText(items.kinds.overtime).first()).toBeVisible();
});

test('HR settings set the start date and pair an entrance screen', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: manager });
  await page.goto('/hr/settings');
  const s = ar.hr.settings;
  await expect(page.getByLabel(s.fields.attendanceStartsOn)).toHaveValue('2026-10-01');
  await expect(page.getByText(s.hints.attendanceStarted)).toBeVisible();

  await page.getByRole('tab', { name: s.tabs.screens }).click();
  const k = ar.hr.kiosks;
  await expect(page.locator('[data-kiosk="المدخل الرئيسي"]').getByText(k.paired)).toBeVisible();
  await page.getByRole('button', { name: k.add }).click();
  const dialog = page.getByRole('dialog', { name: k.addTitle });
  await dialog.getByLabel(k.name).fill('مدخل الاستوديو');
  await dialog.getByRole('button', { name: k.create }).click();
  await expect(page.getByTestId('pairing-code')).toHaveText('K7PX4MQ2');
});

test('the entrance screen pairs with its code and shows the rotating code', async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/kiosk');
  const k = ar.hr.kiosk;
  await page.getByLabel(k.pairingCode).fill('AAAAAAAA');
  await page.getByRole('button', { name: k.pair }).click();
  await expect(page.getByRole('alert')).toHaveText(ar.errors.INVALID_PAIRING_CODE);
  await expect(page.getByLabel(k.pairingCode)).toBeFocused();
  await page.getByLabel(k.pairingCode).fill('k7px4mq2');
  await page.getByRole('button', { name: k.pair }).click();
  await expect(page.getByTestId('kiosk-code')).toHaveAttribute('data-code', attendanceCode());
  await expect(page.getByText(k.scanHint)).toBeVisible();
});

test('the entrance screen says when it is offline, and greets after a punch', async ({ page }) => {
  await mockApi(page, { signedIn: false, kiosk: { paired: true, offline: true } });
  await page.goto('/kiosk');
  await expect(page.getByRole('alert')).toHaveText(ar.hr.kiosk.offline, { timeout: 15_000 });

  await mockApi(page, {
    signedIn: false,
    kiosk: {
      paired: true,
      greeting: {
        direction: 'in',
        firstName: 'كريم',
        partOfDay: 'morning',
        tasksDueToday: 2,
        firstEventAt: '2026-10-21T10:00:00.000Z',
        workedMinutes: null,
      },
    },
  });
  await page.goto('/kiosk');
  await expect(page.getByTestId('attendance-greeting')).toContainText(
    fill(a.greeting.morning, { name: 'كريم' }),
  );
});
