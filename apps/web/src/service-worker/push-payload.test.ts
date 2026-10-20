import type { PushPayload } from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import { appPath, notificationOptions, readPushData, readPushPayload } from './push-payload';

const payload: PushPayload = {
  kind: 'notification',
  deliveryId: '0199a000-0000-7000-8000-000000000001',
  notificationId: '0199a000-0000-7000-8000-000000000002',
  title: 'مهمة جديدة',
  body: 'أُسندت إليك «تصميم الهوية» بواسطة ليان',
  link: '/tasks/t1',
  tag: 'task:t1:task_assigned',
  requireInteraction: false,
  unreadCount: 3,
  close: ['task:t0:task_commented'],
};

describe('readPushPayload (F16 rule A8)', () => {
  it('reads what the worker sends', () => {
    expect(readPushPayload(JSON.stringify(payload))).toEqual(payload);
    expect(readPushPayload(JSON.stringify({ ...payload, notificationId: null }))).not.toBeNull();
  });

  it('refuses anything else', () => {
    expect(readPushPayload(undefined)).toBeNull();
    expect(readPushPayload('not json')).toBeNull();
    expect(readPushPayload('null')).toBeNull();
    expect(readPushPayload(JSON.stringify({ ...payload, title: 1 }))).toBeNull();
    expect(readPushPayload(JSON.stringify({ ...payload, close: undefined }))).toBeNull();
  });

  it('refuses a link that is not a path (the click checks it stays in the app: appPath)', () => {
    expect(readPushPayload(JSON.stringify({ ...payload, link: 'https://example.com' }))).toBeNull();
  });
});

const titles = { open: 'افتح', snooze: 'ذكّرني بعد ساعة' };

describe('notificationOptions', () => {
  it('shows Arabic right to left, replaces by tag and keeps what the click needs', () => {
    const options = notificationOptions({ ...payload, requireInteraction: true }, titles);
    expect(options).toMatchObject({
      body: payload.body,
      tag: payload.tag,
      lang: 'ar',
      dir: 'rtl',
      requireInteraction: true,
    });
    expect(readPushData(options.data)).toEqual({
      link: payload.link,
      deliveryId: payload.deliveryId,
      notificationId: payload.notificationId,
    });
  });

  it('offers "Open" and "Remind me in an hour" on a notification only (rule A11)', () => {
    expect(notificationOptions(payload, titles).actions).toEqual([
      { action: 'open', title: titles.open },
      { action: 'snooze', title: titles.snooze },
    ]);
    const test = notificationOptions({ ...payload, kind: 'test', notificationId: null }, titles);
    expect(test.actions).toBeUndefined();
  });

  it('ignores the data of a notification the app did not show', () => {
    expect(readPushData(undefined)).toBeNull();
    expect(readPushData({ link: '/x' })).toBeNull();
  });
});

describe('appPath (rule A10)', () => {
  const origin = 'https://hub.vertexmedia.pro';

  it('keeps a path of the app with its search and hash', () => {
    expect(appPath('/tasks/t1?tab=files#c1', origin)).toBe('/tasks/t1?tab=files#c1');
  });

  it('refuses links that leave the app', () => {
    const backslash = String.raw`/\evil.example`;
    for (const link of ['//evil.example', backslash, 'https://evil.example', 'x', 1]) {
      expect(appPath(link, origin), String(link)).toBeNull();
    }
  });
});
