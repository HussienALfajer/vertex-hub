import { z } from 'zod';
import { calendarDateSchema } from './dates.js';
import { pageQuerySchema, pageSchema, queryListSchema } from './lists.js';
import { type NotificationPriority, notificationSchema } from './notifications.js';

/*
 * F16 part A (ADR 0036): Web Push to every signed-in device. One subscription per session; the
 * API stores and queues, the worker encrypts and sends with VAPID and reports each outcome.
 */

export const PUSH_LIMITS = {
  /** A push service URL. */
  endpoint: 1000,
  /** The browser's public keys, base64url. */
  key: 200,
  /** A push service's refusal, as kept on the delivery. */
  error: 500,
  /** Rule A9 and edge case 6: body texts are cut to this many characters. */
  body: 140,
  /** Rule A14: tags of read notifications a payload carries. */
  closeTags: 20,
  /** Rule A14: how far back the close list looks. */
  closeHours: 24,
  /** Edge case 6: the encoded payload stays under this many bytes. */
  payloadBytes: 3 * 1024,
  /** Rule A12: test pushes per device. */
  testIntervalSeconds: 60,
  /** Rule A13: consecutive failed messages before a subscription is deleted. */
  failures: 10,
  /** Rule A15: deliveries are purged this many days after creation. */
  retentionDays: 30,
} as const;

/**
 * The browsers' push services (ADR 0036: outbound traffic goes only there): Chrome, Edge and
 * Android (FCM), Firefox, Edge on Windows (WNS) and Safari. A subscription elsewhere is refused,
 * so the worker never posts to a host a user chose.
 */
export const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  '.notify.windows.com',
  'web.push.apple.com',
] as const;

/** Whether a push endpoint is on a known push service: exact host, or a subdomain of a `.` entry. */
export function isPushServiceEndpoint(endpoint: string): boolean {
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return false;
  }
  return PUSH_SERVICE_HOSTS.some((known) =>
    known.startsWith('.') ? host.endsWith(known) : host === known,
  );
}

/** `GET /api/me/push/config`: without VAPID keys, push is unavailable and the app hides it. */
export const pushConfigSchema = z
  .object({ available: z.boolean(), vapidPublicKey: z.string().nullable() })
  .meta({ id: 'PushConfig' });

export type PushConfig = z.infer<typeof pushConfigSchema>;

/** Rule A7: the browser's `PushSubscription`, stored on the current session. */
export const pushSubscriptionInputSchema = z
  .object({
    endpoint: z
      .url({ protocol: /^https$/ })
      .max(PUSH_LIMITS.endpoint)
      .refine(isPushServiceEndpoint, 'Not a known push service'),
    keys: z.object({
      p256dh: z.string().min(1).max(PUSH_LIMITS.key),
      auth: z.string().min(1).max(PUSH_LIMITS.key),
    }),
  })
  .meta({ id: 'PushSubscriptionInput' });

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;

export const PUSH_DELIVERY_KINDS = ['notification', 'morning_summary', 'test'] as const;

export const pushDeliveryKindSchema = z.enum(PUSH_DELIVERY_KINDS).meta({ id: 'PushDeliveryKind' });

export type PushDeliveryKind = z.infer<typeof pushDeliveryKindSchema>;

/** `gone`: the push service refused the subscription for good (404, 410). */
export const PUSH_DELIVERY_STATUSES = ['queued', 'sent', 'gone', 'failed'] as const;

export const pushDeliveryStatusSchema = z
  .enum(PUSH_DELIVERY_STATUSES)
  .meta({ id: 'PushDeliveryStatus' });

export type PushDeliveryStatus = z.infer<typeof pushDeliveryStatusSchema>;

/** Rule A8: Web Push urgency and time to live, by priority. */
export const PUSH_DELIVERY_OPTIONS: Record<
  NotificationPriority,
  { urgency: 'high' | 'normal' | 'low'; ttlSeconds: number }
> = {
  critical: { urgency: 'high', ttlSeconds: 24 * 60 * 60 },
  important: { urgency: 'high', ttlSeconds: 12 * 60 * 60 },
  normal: { urgency: 'normal', ttlSeconds: 4 * 60 * 60 },
  informational: { urgency: 'low', ttlSeconds: 4 * 60 * 60 },
};

/** Rule A12: a device's push state in the signed-in devices list. */
export const devicePushSchema = z
  .object({
    state: z.enum(['on', 'off']),
    /** The last push the device's push service accepted. */
    lastDeliveredAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'DevicePush' });

export type DevicePush = z.infer<typeof devicePushSchema>;

/** Rule A15: one push of the delivery log. */
export const pushDeliverySchema = z
  .object({
    id: z.uuid(),
    user: z.object({ id: z.uuid(), name: z.string() }),
    device: z.string(),
    kind: pushDeliveryKindSchema,
    /** Null for the test and the morning push, and once the notification was purged. */
    notification: notificationSchema.nullable(),
    status: pushDeliveryStatusSchema,
    error: z.string().nullable(),
    createdAt: z.iso.datetime(),
    sentAt: z.iso.datetime().nullable(),
    clickedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'PushDelivery' });

export type PushDelivery = z.infer<typeof pushDeliverySchema>;

export const pushDeliveryListQuerySchema = pageQuerySchema.extend({
  userId: z.uuid().optional(),
  status: queryListSchema(pushDeliveryStatusSchema).optional(),
  /** First and last business day (Damascus) of the push's creation, inclusive. */
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
});

export type PushDeliveryListQuery = z.infer<typeof pushDeliveryListQuerySchema>;

export const pushDeliveryPageSchema = pageSchema(pushDeliverySchema).meta({
  id: 'PushDeliveryPage',
  description: 'Pushes of the last 30 days, newest first',
});

export type PushDeliveryPage = z.infer<typeof pushDeliveryPageSchema>;

/**
 * What the service worker receives (rule A8): the rendered texts, where it leads, the tag that
 * replaces an older notice about the same thing, the unread count for the icon badge and the tags
 * to close (rule A14). No money amount is ever part of it (rule A9).
 */
export const pushPayloadSchema = z.object({
  kind: pushDeliveryKindSchema,
  /** The delivery, for `POST /api/me/push/deliveries/:id/click`. */
  deliveryId: z.uuid(),
  notificationId: z.uuid().nullable(),
  title: z.string().max(PUSH_LIMITS.body),
  body: z.string().max(PUSH_LIMITS.body),
  /** A path of the web app. */
  link: z.string().startsWith('/'),
  tag: z.string(),
  requireInteraction: z.boolean(),
  unreadCount: z.number().int().min(0),
  close: z.array(z.string()).max(PUSH_LIMITS.closeTags),
});

export type PushPayload = z.infer<typeof pushPayloadSchema>;

/** Rule A8: a notice's tag, so a newer push about the same thing replaces the older one. */
export function pushTag(notification: {
  subjectType: string;
  subjectId: string;
  type: string;
}): string {
  return `${notification.subjectType}:${notification.subjectId}:${notification.type}`;
}

/** Edge case 6: cuts a text to the push limit, with an ellipsis. */
export function pushText(text: string): string {
  return text.length <= PUSH_LIMITS.body ? text : `${text.slice(0, PUSH_LIMITS.body - 1)}…`;
}
