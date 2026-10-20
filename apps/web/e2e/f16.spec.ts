import type { BrowserContext, Page, Route } from '@playwright/test';
import ar from '../src/i18n/locales/ar.json' with { type: 'json' };
import { mockApi } from './fixtures';
import { expect, test } from './test';

// F16 part A: the installable app, push on this device and offline reading, against the mocked
// API. The app's service worker runs here (other specs block it); showing pushes is in
// f16-push.spec.ts, and the push rules themselves in apps/api/test and the worker's tests.
test.use({ serviceWorkers: 'allow' });

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';

const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((out, [key, value]) => out.replace(`{{${key}}}`, value), text);

/**
 * Push needs an active service worker, which first stores the app shell (a few MB): under load
 * that takes longer than an assertion waits, so the tests wait for it with the test's timeout.
 */
async function serviceWorkerReady(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
}

/** Waits until the service worker is active, then reloads so it controls the page. */
async function underServiceWorker(page: Page) {
  await serviceWorkerReady(page);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

/**
 * The browser's push service is out of reach in tests, and headless Chromium refuses the
 * notification permission: both are made up (the permission is "not asked yet" until the page
 * asks, and kept across reloads). The service worker, the app and its API calls are real.
 */
async function fakePushService(context: BrowserContext) {
  await context.addInitScript(() => {
    const granted = () => sessionStorage.getItem('e2e-permission') === 'granted';
    Object.defineProperty(Notification, 'permission', {
      get: () => (granted() ? 'granted' : 'default'),
    });
    Notification.requestPermission = async () => {
      sessionStorage.setItem('e2e-permission', 'granted');
      return 'granted';
    };
    const endpoint = 'https://fcm.googleapis.com/fcm/send/e2e-device';
    const subscription = (key: PushSubscriptionOptionsInit['applicationServerKey']) =>
      ({
        endpoint,
        options: { applicationServerKey: key },
        toJSON: () => ({
          endpoint,
          keys: { p256dh: 'BPublicKeyOfTheBrowser', auth: 'authSecret' },
        }),
        unsubscribe: async () => {
          sessionStorage.removeItem('e2e-subscribed');
          return true;
        },
      }) as unknown as PushSubscription;
    PushManager.prototype.subscribe = async (options?: PushSubscriptionOptionsInit) => {
      const key = new Uint8Array(options?.applicationServerKey as Uint8Array);
      sessionStorage.setItem('e2e-subscribed', JSON.stringify([...key]));
      return subscription(key.buffer);
    };
    // The subscription survives reloads with the key it was made for.
    PushManager.prototype.getSubscription = async () => {
      const key = sessionStorage.getItem('e2e-subscribed');
      return key ? subscription(new Uint8Array(JSON.parse(key) as number[]).buffer) : null;
    };
  });
}

const STORED = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-device',
  keys: { p256dh: 'BPublicKeyOfTheBrowser', auth: 'authSecret' },
};

test('turns push on for this device, sends a test and turns it off', async ({ page, context }) => {
  await fakePushService(context);
  const api = await mockApi(page, { signedIn: true });
  await page.goto('/');
  await serviceWorkerReady(page);

  // The home page invites while push is off on the device (rule A7).
  const invite = page.getByText(ar.push.card.offBody);
  await expect(invite).toBeVisible();
  await page.getByRole('button', { name: ar.push.turnOn }).click();
  await expect(page.getByText(ar.push.turnedOn)).toBeVisible();
  await expect(invite).toBeHidden();
  expect(api.push.subscriptions).toEqual([STORED]);

  // The device row (rule A12): on, with the test and the switch.
  await page.goto('/account');
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByText(ar.devices.thisDevice, { exact: true }) });
  await expect(row.getByText(ar.push.row.on)).toBeVisible();
  await row.getByRole('button', { name: ar.push.test }).click();
  await expect(page.getByText(ar.push.testSent)).toBeVisible();
  expect(api.push.tests).toBe(1);
  await row.getByRole('button', { name: ar.push.turnOff }).click();
  await expect(page.getByText(ar.push.turnedOff)).toBeVisible();
  await expect(row.getByText(ar.push.row.off)).toBeVisible();

  // Turned off by hand, it stays off at the next app load and the home page no longer invites.
  const stored = api.push.subscriptions.length;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: ar.dashboard.title })).toBeVisible();
  await expect(invite).toBeHidden();
  expect(api.push.subscriptions).toHaveLength(stored);
});

test('subscribes again silently on a new session while the permission stays', async ({
  page,
  context,
}) => {
  await fakePushService(context);
  const api = await mockApi(page, { signedIn: true });
  await page.goto('/');
  await serviceWorkerReady(page);
  await page.getByRole('button', { name: ar.push.turnOn }).click();
  await expect(page.getByText(ar.push.turnedOn)).toBeVisible();

  // Edge case 3: the next app load stores the browser's subscription on the session again.
  await page.reload();
  await expect.poll(() => api.push.subscriptions.length).toBe(2);
  expect(api.push.subscriptions[1]).toEqual(STORED);
});

test('settings: push per type, locked where management requires it', async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/notifications/settings');

  const overdue = ar.notifications.types.task_overdue;
  const pushOverdue = page.getByRole('switch', {
    name: fill(ar.notifications.settings.pushLabel, { name: overdue }),
    exact: true,
  });
  await expect(pushOverdue).toBeChecked();
  await expect(pushOverdue).toBeDisabled();

  const commented = ar.notifications.types.task_commented;
  const pushCommented = page.getByRole('switch', {
    name: fill(ar.notifications.settings.pushLabel, { name: commented }),
    exact: true,
  });
  await expect(pushCommented).toBeChecked();
  const saved = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/me/notification-settings') && request.method() === 'PUT',
  );
  await pushCommented.click();
  const body = (await saved).postDataJSON() as { pushTypes: string[] };
  expect(body.pushTypes).not.toContain('task_commented');
  expect(body.pushTypes).toContain('task_overdue');
  await expect(pushCommented).not.toBeChecked();

  // The device's own state heads the page: headless Chromium refuses notifications.
  await expect(page.getByText(ar.push.state.blocked)).toBeVisible();
});

test('without the server keys there is no push to turn on', async ({ page }) => {
  await mockApi(page, { signedIn: true, pushAvailable: false });
  await page.goto('/notifications/settings');
  await expect(page.getByRole('heading', { name: ar.notifications.settings.title })).toBeVisible();
  await expect(page.getByText(ar.push.card.title)).toBeHidden();
  await expect(
    page.getByRole('switch', {
      name: fill(ar.notifications.settings.pushLabel, {
        name: ar.notifications.types.task_overdue,
      }),
    }),
  ).toHaveCount(0);
});

test.describe('installing', () => {
  test('a computer installs through the browser offer, or dismisses the card', async ({ page }) => {
    await mockApi(page, { signedIn: true });
    await page.goto('/');
    const card = page.getByText(ar.pwa.install.cardTitle);
    await expect(card).toBeHidden();

    // The browser's offer arrives (Chrome fires it when the app is installable).
    const offer = () =>
      page.evaluate(() => {
        const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
          prompt: async () => undefined,
          userChoice: Promise.resolve({ outcome: 'accepted' }),
        });
        window.dispatchEvent(event);
      });
    await offer();
    await expect(card).toBeVisible();
    await page.getByRole('button', { name: ar.pwa.install.notNow }).click();
    await expect(card).toBeHidden();

    // Dismissed for 30 days on this device; the user menu still offers it.
    await page.reload();
    await offer();
    await page.getByRole('button', { name: ar.user.menu }).click();
    await page.getByRole('menuitem', { name: ar.pwa.install.menu }).click();
    await expect(page.getByRole('button', { name: ar.user.menu })).toBeVisible();
    await page.getByRole('button', { name: ar.user.menu }).click();
    await expect(page.getByRole('menuitem', { name: ar.pwa.install.menu })).toHaveCount(0);
  });

  test.describe('on iPhone', () => {
    test.use({ userAgent: IPHONE });

    test('the card leads to the guide, iPhone first', async ({ page }) => {
      await mockApi(page, { signedIn: true });
      await page.goto('/');
      await page.getByRole('link', { name: ar.pwa.install.how }).click();
      await expect(page).toHaveURL(/\/install$/);
      await expect(page.getByRole('heading', { name: ar.pwa.guide.title })).toBeVisible();
      const first = page.getByRole('heading', { level: 2 }).first();
      await expect(first).toContainText(ar.pwa.guide.iphone.title);
      await expect(first).toContainText(ar.pwa.guide.thisDevice);
      await expect(page.getByText(ar.pwa.guide.iphone.share)).toBeVisible();
    });
  });
});

test('offline, the app opens with the kept data and nothing financial', async ({
  page,
  context,
}) => {
  await mockApi(page, { signedIn: true });
  await page.goto('/');
  await underServiceWorker(page);
  await expect(page.getByRole('heading', { name: ar.dashboard.title })).toBeVisible();
  // The cache is saved a moment after the data arrives.
  await page.waitForTimeout(1500);

  // The mocked API would still answer: offline, every request fails as it would.
  const offline = (route: Route) => route.abort('internetdisconnected');
  await page.route('**/api/**', offline);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: ar.pwa.offline.hint })).toBeVisible();
  // Actions are off (rule A5).
  await expect(page.getByRole('button', { name: ar.dashboard.refresh })).toBeDisabled();

  // Never persisted: the invoices were not kept.
  await page
    .getByRole('navigation', { name: ar.nav.label })
    .getByRole('link', {
      name: ar.nav.invoices,
    })
    .click();
  // Each section of the screen that needed the data says so; one is enough here.
  await expect(page.getByText(ar.pwa.offline.notAvailable).first()).toBeVisible();

  await page.unroute('**/api/**', offline);
  await context.setOffline(false);
  await expect(page.getByRole('status').filter({ hasText: ar.pwa.offline.hint })).toBeHidden();
});
