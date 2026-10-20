import { describe, expect, it } from 'vitest';
import {
  isPushServiceEndpoint,
  PUSH_LIMITS,
  pushPayloadSchema,
  pushSubscriptionInputSchema,
  pushTag,
  pushText,
} from './push.js';

describe('push (spec F16 part A)', () => {
  it('accepts only https push endpoints with both keys', () => {
    const keys = { p256dh: 'BPublic', auth: 'secret' };
    expect(
      pushSubscriptionInputSchema.safeParse({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys,
      }).success,
    ).toBe(true);
    expect(
      pushSubscriptionInputSchema.safeParse({
        endpoint: 'http://fcm.googleapis.com/fcm/send/abc',
        keys,
      }).success,
    ).toBe(false);
    expect(
      pushSubscriptionInputSchema.safeParse({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'BPublic', auth: '' },
      }).success,
    ).toBe(false);
  });

  it('accepts only the browsers push services, never a host a user chose', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://wns2-db5p.notify.windows.com/w/?token=abc',
      'https://web.push.apple.com/abc',
    ]) {
      expect(isPushServiceEndpoint(endpoint), endpoint).toBe(true);
    }
    for (const endpoint of [
      'https://127.0.0.1/abc',
      'https://localhost/abc',
      'https://notify.windows.com.evil.example/abc',
      'https://evilnotify.windows.com/abc',
      'not a url',
    ]) {
      expect(isPushServiceEndpoint(endpoint), endpoint).toBe(false);
    }
  });

  it('cuts texts to 140 characters (edge case 6)', () => {
    expect(pushText('short')).toBe('short');
    const cut = pushText('x'.repeat(200));
    expect(cut).toHaveLength(PUSH_LIMITS.body);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('tags a push by subject and type (rule A8)', () => {
    expect(pushTag({ subjectType: 'task', subjectId: 'id', type: 'task_commented' })).toBe(
      'task:id:task_commented',
    );
  });

  it('keeps the largest payload under 3 KB (edge case 6)', () => {
    const id = '0192a5a0-0000-7000-8000-000000000001';
    const tag = pushTag({
      subjectType: 'approval_request',
      subjectId: id,
      type: 'task_medical_review_requested',
    });
    const payload = pushPayloadSchema.parse({
      kind: 'notification',
      deliveryId: id,
      notificationId: id,
      title: pushText('ع'.repeat(500)),
      body: pushText('ع'.repeat(500)),
      link: `/clients/${id}/report?month=2026-10-01&tab=ads`,
      tag,
      requireInteraction: true,
      unreadCount: 9999,
      close: Array.from({ length: PUSH_LIMITS.closeTags }, () => tag),
    });
    expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThan(
      PUSH_LIMITS.payloadBytes,
    );
  });
});
