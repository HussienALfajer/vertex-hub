import { EMAIL_LIMITS, type Notification } from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import { notificationBatchEmail } from './staff-emails.js';

const fileAdded = (title: string, file: string): Notification =>
  ({
    id: '0190a3c2-0000-7000-8000-0000000000d1',
    type: 'task_file_added',
    actor: { id: '0190a3c2-0000-7000-8000-0000000000a1', name: 'ليان الأحمد' },
    subject: { type: 'task', id: '0190a3c2-0000-7000-8000-0000000000b1' },
    data: {
      task: { title, department: 'design', client: null, project: null },
      file,
    },
    count: 1,
    read: false,
    createdAt: '2026-10-05T07:00:00.000Z',
    updatedAt: '2026-10-05T07:00:00.000Z',
  }) as Notification;

describe('notification batch email (rules 6–9)', () => {
  const batch = (items: Notification[], more = 0) =>
    notificationBatchEmail(
      { notifications: { items, more }, departments: {} },
      'https://hub.example.com',
    );

  it('takes the subject of one item from its text', () => {
    const { subject } = batch([fileAdded('منيو الخريف', 'menu.pdf')]);
    expect(subject).toBe('أضاف ليان الأحمد الملف «menu.pdf» إلى «منيو الخريف»');
  });

  it('keeps a long item text within the subject limit', () => {
    const { subject, sections } = batch([fileAdded('م'.repeat(160), `${'ملف'.repeat(40)}.pdf`)]);
    expect(subject).toHaveLength(EMAIL_LIMITS.subject);
    expect(subject.endsWith('…')).toBe(true);
    // The list keeps the whole text.
    expect(sections?.[0]?.items[0]?.text.length).toBeGreaterThan(EMAIL_LIMITS.subject);
  });

  it('counts the items, the cut ones included, when there are several', () => {
    const item = fileAdded('منيو الخريف', 'menu.pdf');
    expect(batch([item, item], 9).subject).toBe('لديك 11 إشعارًا جديدًا');
  });
});
