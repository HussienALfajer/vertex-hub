import type { PushPayload } from '@vertex-hub/contracts';

/*
 * F16 rules A8 and A14 inside the service worker. Only types come from the contracts: the worker
 * stays small, and the payload is trusted (only the server's VAPID key can send it), so a shape
 * check is enough.
 */

/** What a shown push keeps for its click (rule A10). */
export interface PushData {
  link: string;
  deliveryId: string;
  /** Null for the test push; the app closes shown pushes whose notification was read (A14). */
  notificationId: string | null;
}

/** What the worker tells an open window after a click (src/features/app/service-worker.ts). */
export interface OpenMessage {
  type: 'open';
  link: string;
}

/**
 * A notification's link as a path of the app, or null when it would leave it: browsers read a
 * backslash after the first slash as a slash, so a link can look like a path and open another
 * site.
 */
export function appPath(link: unknown, origin: string): string | null {
  if (typeof link !== 'string' || !link.startsWith('/')) return null;
  try {
    const url = new URL(link, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

/** The pushed payload, or null when it is not one the app sends. */
export function readPushPayload(text: string | null | undefined): PushPayload | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const payload = value as Partial<PushPayload>;
  const valid =
    typeof payload.deliveryId === 'string' &&
    (payload.notificationId === null || typeof payload.notificationId === 'string') &&
    typeof payload.title === 'string' &&
    typeof payload.body === 'string' &&
    typeof payload.link === 'string' &&
    payload.link.startsWith('/') &&
    typeof payload.tag === 'string' &&
    typeof payload.unreadCount === 'number' &&
    Array.isArray(payload.close);
  return valid ? (payload as PushPayload) : null;
}

/** How the platform shows the push: Arabic, right to left, replacing older ones with its tag. */
export function notificationOptions(payload: PushPayload): NotificationOptions {
  const data: PushData = {
    link: payload.link,
    deliveryId: payload.deliveryId,
    notificationId: payload.notificationId,
  };
  return {
    body: payload.body,
    tag: payload.tag,
    lang: 'ar',
    dir: 'rtl',
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    requireInteraction: payload.requireInteraction === true,
    data,
  };
}

/** The data a shown push carries, or null for one the app did not show. */
export function readPushData(data: unknown): PushData | null {
  if (typeof data !== 'object' || data === null) return null;
  const { link, deliveryId, notificationId } = data as Partial<PushData>;
  if (typeof link !== 'string' || typeof deliveryId !== 'string') return null;
  return {
    link,
    deliveryId,
    notificationId: typeof notificationId === 'string' ? notificationId : null,
  };
}
