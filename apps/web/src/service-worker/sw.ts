import type { PrecacheEntry } from 'workbox-precaching';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
  appPath,
  notificationOptions,
  type OpenMessage,
  readPushData,
  readPushPayload,
} from './push-payload';

/*
 * The service worker (F16 rules A2, A4, A8, A10, A14; ADR 0036), built by vite-plugin-pwa. It
 * precaches the app shell, answers the app's pages with it offline, and shows pushes. API
 * responses never go through it: the app's own cache keeps what may be read offline (rule A5).
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

const manifest = self.__WB_MANIFEST;
precacheAndRoute(manifest);
cleanupOutdatedCaches();

// Every page of the app is the same shell. In `pnpm dev` nothing is precached, so Vite answers.
const shell = 'index.html';
if (manifest.some((entry) => (typeof entry === 'string' ? entry : entry.url) === shell)) {
  registerRoute(new NavigationRoute(createHandlerBoundToURL(shell), { denylist: [/^\/api\//] }));
}

// Rule A6: the app asks before a waiting version takes over.
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('push', (event) => {
  const payload = readPushPayload(event.data?.text());
  if (!payload) return;
  event.waitUntil(
    (async () => {
      // Rule A14: what the user read or resolved elsewhere leaves this screen.
      const close = new Set(payload.close);
      for (const shown of await self.registration.getNotifications()) {
        if (close.has(shown.tag)) shown.close();
      }
      // Rule A4: the icon shows the unread count; platforms without badges ignore it.
      await setBadge(payload.unreadCount);
      await self.registration.showNotification(payload.title, notificationOptions(payload));
    })(),
  );
});

// Rule A10: focus an open window of the app and navigate it, or open the app at the link.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = readPushData(event.notification.data);
  const link = appPath(data?.link, self.location.origin);
  if (!data || !link) return;
  event.waitUntil(
    (async () => {
      // Marks the notification read and records the click; the app catches up on focus.
      const clicked = fetch(
        `/api/me/push/deliveries/${encodeURIComponent(data.deliveryId)}/click`,
        {
          method: 'POST',
          credentials: 'same-origin',
        },
      ).catch(() => undefined);
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        open.postMessage({ type: 'open', link } satisfies OpenMessage);
      } else {
        await self.clients.openWindow(link);
      }
      await clicked;
    })(),
  );
});

async function setBadge(count: number) {
  const navigator = self.navigator as WorkerNavigator & Partial<NavigatorBadge>;
  try {
    if (count > 0) await navigator.setAppBadge?.(count);
    else await navigator.clearAppBadge?.();
  } catch {
    // Badges are a nicety: a refusal changes nothing else.
  }
}
