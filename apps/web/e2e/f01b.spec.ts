import type { Browser, Page } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import {
  DEVICES_NOW,
  employeeMe,
  manager,
  mockApi,
  type SessionRecord,
  sessionsSeed,
} from './fixtures';
import { expect, test } from './test';

// F01B flows against the mocked API (the real rules are covered by apps/api/test). The pages of a
// test share one list of sessions, as browsers share the server.

const OFFICE_CHROME = '01920000-0000-7000-9000-000000000001';
const OFFICE_EDGE = '01920000-0000-7000-9000-000000000002';
const KARIM_CHROME = '01920000-0000-7000-9000-000000000004';

/** A second browser on the same mocked server, signed in with `session`. */
async function openBrowser(
  browser: Browser,
  baseURL: string | undefined,
  sessions: SessionRecord[],
  session: string,
  me = manager,
): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(DEVICES_NOW));
  await mockApi(page, { signedIn: true, me, sessions, session });
  return page;
}

const deviceRow = (page: Page, label: string) =>
  page.getByRole('listitem').filter({ hasText: label }).first();

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(DEVICES_NOW));
});

test('lists the open sessions with places and the colleagues on the same device', async ({
  page,
}) => {
  const api = await mockApi(page, { signedIn: true, session: OFFICE_CHROME });
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: ar.devices.title })).toBeVisible();

  const current = deviceRow(page, 'Chrome · Windows');
  await expect(current.getByText(ar.devices.thisDevice, { exact: true })).toBeVisible();
  await expect(current).toContainText('Damascus، سوريا · 185.12.34.56');
  await expect(current).toContainText(ar.devices.activeNow);
  // Rule 15: Karim signed in later in this Chrome; Layan probably in Firefox on this PC.
  await expect(current).toContainText(`كريم الزين (التصوير)، ${ar.devices.shared.sameBrowser}`);
  await expect(current).toContainText(`ليان الأحمد (التصميم)، ${ar.devices.shared.sameDevice}`);
  await expect(current.getByRole('button', { name: ar.devices.signOut })).toHaveCount(0);

  // The phone moved on to another address: shown with its place.
  const phone = deviceRow(page, 'Safari · iOS');
  await expect(phone).toContainText('Aleppo، سوريا');
  await expect(phone).toContainText(`${ar.devices.from} 2001:db8:85a3::8a2e:370:7334 · Gaziantep`);

  // Rule 5: the hardware of this session was reported on load.
  await expect.poll(() => api.hardwareReports.length).toBeGreaterThan(0);
  expect(api.hardwareReports[0]).toMatchObject({ cores: expect.any(Number) });
});

test('a colleague signed in after me in the same browser sees me there', async ({ page }) => {
  await mockApi(page, { signedIn: true, me: employeeMe, session: KARIM_CHROME });
  await page.goto('/account');
  await expect(deviceRow(page, 'Chrome · Windows')).toContainText(
    `سارة الخطيب (الإدارة العامة)، ${ar.devices.shared.sameBrowser}`,
  );
});

test('signs out another device, which goes to sign-in at its next request', async ({
  page,
  browser,
  baseURL,
}) => {
  const sessions = sessionsSeed();
  await mockApi(page, { signedIn: true, sessions, session: OFFICE_CHROME });
  const edge = await openBrowser(browser, baseURL, sessions, OFFICE_EDGE);
  await edge.goto('/account');
  await expect(
    deviceRow(edge, 'Edge · Windows').getByText(ar.devices.thisDevice, { exact: true }),
  ).toBeVisible();

  await page.goto('/account');
  await deviceRow(page, 'Edge · Windows').getByRole('button', { name: ar.devices.signOut }).click();
  const dialog = page.getByRole('alertdialog', { name: 'تسجيل الخروج من Edge · Windows؟' });
  await expect(dialog).toContainText('Damascus، سوريا');
  await expect(dialog).toContainText('185.12.34.56');
  await dialog.getByRole('button', { name: ar.devices.signOut }).click();
  await expect(page.getByText(ar.devices.signOutOne.done)).toBeVisible();
  await expect(page.getByText('Edge · Windows')).toHaveCount(0);
  // Its row is gone: the focus lands on the card's own action, not the page.
  await expect(page.getByRole('button', { name: ar.devices.signOutAll })).toBeFocused();

  // Edge's next request is refused: sign-in, saying why.
  await edge.getByRole('navigation', { name: ar.nav.label }).getByRole('link').first().click();
  await expect(edge).toHaveURL(/\/login/);
  await expect(edge.getByText(ar.login.signedOut.elsewhere)).toBeVisible();
  await edge.context().close();
});

test('a device signed out meanwhile says so', async ({ page }) => {
  const sessions = sessionsSeed();
  await mockApi(page, { signedIn: true, sessions, session: OFFICE_CHROME });
  await page.goto('/account');
  await deviceRow(page, 'Safari · iOS').getByRole('button', { name: ar.devices.signOut }).click();
  // Edge case 3: another tab signed the phone out first.
  sessions.splice(
    sessions.findIndex((s) => s.id === '01920000-0000-7000-9000-000000000003'),
    1,
  );
  await page.getByRole('alertdialog').getByRole('button', { name: ar.devices.signOut }).click();
  await expect(page.getByText(ar.devices.signOutOne.gone)).toBeVisible();
  await expect(page.getByText('Safari · iOS')).toHaveCount(0);
});

test('signs out all other devices, then every device with this one', async ({ page }) => {
  await mockApi(page, { signedIn: true, session: OFFICE_CHROME });
  await page.goto('/account');

  // A choice left by a cancelled dialog is not kept: each opening starts on the default.
  await page.getByRole('button', { name: ar.devices.signOutAll }).click();
  await page.getByRole('radio', { name: ar.devices.signOutAllDialog.all }).click();
  await page.getByRole('button', { name: ar.common.cancel }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  await page.getByRole('button', { name: ar.devices.signOutAll }).click();
  let dialog = page.getByRole('alertdialog', { name: ar.devices.signOutAllDialog.title });
  await expect(dialog).toContainText('حسابك مفتوح على جهازين آخرين.');
  await expect(
    dialog.getByRole('radio', { name: ar.devices.signOutAllDialog.others }),
  ).toBeChecked();
  await dialog.getByRole('button', { name: ar.devices.signOut }).click();
  await expect(page.getByText(ar.devices.signOutAllDialog.done)).toBeVisible();
  await expect(page.getByText('Edge · Windows')).toHaveCount(0);
  await expect(page.getByText('Safari · iOS')).toHaveCount(0);

  // No other device left: only "with this one" can be chosen.
  await page.getByRole('button', { name: ar.devices.signOutAll }).click();
  dialog = page.getByRole('alertdialog', { name: ar.devices.signOutAllDialog.title });
  await expect(dialog).toContainText(ar.devices.signOutAllDialog.body_zero);
  await expect(
    dialog.getByRole('radio', { name: ar.devices.signOutAllDialog.others }),
  ).toBeDisabled();
  await expect(dialog.getByRole('radio', { name: ar.devices.signOutAllDialog.all })).toBeChecked();
  await dialog.getByRole('button', { name: ar.devices.signOut }).click();
  await expect(page).toHaveURL(/\/login\?signedOut=all$/);
  await expect(page.getByText(ar.login.signedOut.all)).toBeVisible();
});
