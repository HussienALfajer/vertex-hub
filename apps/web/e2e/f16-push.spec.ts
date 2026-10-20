import type { PushPayload } from '@vertex-hub/contracts';
import { mockApi } from './fixtures';
import { expect, test } from './test';

// F16 rules A8 and A14: the service worker shows pushes and closes those read elsewhere. The
// headless shell has no notification platform, so this file runs the full browser headless, and
// lets the app's service worker run (other specs block it).
test.use({ channel: 'chromium', serviceWorkers: 'allow' });

const ORIGIN = 'http://127.0.0.1:4173';

test('the service worker shows a push and closes what was read elsewhere', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['notifications'], { origin: ORIGIN });
  await mockApi(page, { signedIn: true });
  const cdp = await context.newCDPSession(page);
  const registrations = new Map<string, string>();
  cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations: updated }) => {
    for (const registration of updated) {
      registrations.set(registration.scopeURL, registration.registrationId);
    }
  });
  await cdp.send('ServiceWorker.enable');
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => registrations.get(`${ORIGIN}/`)).toBeTruthy();
  const registrationId = registrations.get(`${ORIGIN}/`) ?? '';

  // As the `log` transport writes it (rule A8).
  const push = (payload: PushPayload) =>
    cdp.send('ServiceWorker.deliverPushMessage', {
      origin: ORIGIN,
      registrationId,
      data: JSON.stringify(payload),
    });
  const [worker] = context.serviceWorkers();
  if (!worker) throw new Error('No service worker');
  const shown = () =>
    worker.evaluate(async () => {
      // The service worker's own globals are not in the app's DOM types.
      const scope = self as unknown as {
        registration: { getNotifications(): Promise<{ title: string; tag: string }[]> };
      };
      const notifications = await scope.registration.getNotifications();
      return notifications.map((n) => ({ title: n.title, tag: n.tag }));
    });
  const first: PushPayload = {
    kind: 'notification',
    deliveryId: '0199a000-0000-7000-8000-000000000001',
    notificationId: '0199a000-0000-7000-8000-000000000002',
    title: 'مهمة جديدة',
    body: 'أُسندت إليك «تصاميم منيو الخريف» بواسطة ليان الأحمد',
    link: '/tasks',
    tag: 'task:t1:task_assigned',
    requireInteraction: false,
    unreadCount: 1,
    close: [],
  };
  await push(first);
  await expect.poll(shown).toEqual([{ title: first.title, tag: first.tag }]);

  // Rule A14: the next push carries the tags read elsewhere; the worker closes them.
  await push({
    ...first,
    deliveryId: '0199a000-0000-7000-8000-000000000003',
    notificationId: '0199a000-0000-7000-8000-000000000004',
    title: 'تعليق جديد',
    tag: 'task:t2:task_commented',
    close: [first.tag],
  });
  await expect.poll(shown).toEqual([{ title: 'تعليق جديد', tag: 'task:t2:task_commented' }]);
});
