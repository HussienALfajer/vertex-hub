import { describe, expect, it } from 'vitest';
import { createAnnouncementTemplateSchema } from './announcement-templates.js';
import {
  announcementBodySchema,
  announcementExcerpt,
  createAnnouncementSchema,
  isPollCloseTime,
  isSchedulable,
  pollClosingReminderAt,
  pollInputSchema,
  pollVoteSchema,
  updateAnnouncementSchema,
} from './announcements.js';
import { audienceSchema } from './audiences.js';
import { channelModeOf, notificationBox, notificationPriority } from './notifications.js';

const paragraph = (text: string, marks?: unknown[]) => ({
  type: 'paragraph',
  content: [{ type: 'text', text, ...(marks ? { marks } : {}) }],
});

const doc = (...content: unknown[]) => ({ type: 'doc', content });

const valid = {
  title: 'دوام رمضان',
  body: doc(paragraph('يبدأ الدوام الساعة العاشرة')),
  priority: 'normal',
  requiresAck: false,
  audience: { everyone: true },
  send: 'now',
} as const;

describe('announcement body (rule D13)', () => {
  it('accepts paragraphs, level-3 headings, lists, bold, italic and https or mailto links', () => {
    const body = doc(
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'العنوان' }] },
      paragraph('نص', [{ type: 'bold' }, { type: 'italic' }]),
      paragraph('رابط', [{ type: 'link', attrs: { href: 'https://vertex.example/a' } }]),
      paragraph('بريد', [{ type: 'link', attrs: { href: 'mailto:hr@vertex.example' } }]),
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              paragraph('أول'),
              {
                type: 'orderedList',
                attrs: { start: 2 },
                content: [{ type: 'listItem', content: [paragraph('داخلي')] }],
              },
            ],
          },
        ],
      },
    );
    expect(announcementBodySchema.safeParse(body).success).toBe(true);
  });

  it('refuses other nodes, marks, heading levels and link protocols', () => {
    const refused = [
      doc({ type: 'codeBlock', content: [{ type: 'text', text: 'x' }] }),
      doc({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'x' }] }),
      doc(paragraph('x', [{ type: 'underline' }])),
      doc(paragraph('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])),
      doc(paragraph('x', [{ type: 'link', attrs: { href: 'http://vertex.example' } }])),
      doc({ type: 'image', attrs: { src: 'https://vertex.example/a.png' } }),
      doc(),
      doc({ type: 'paragraph' }),
    ];
    for (const body of refused) expect(announcementBodySchema.safeParse(body).success).toBe(false);
  });

  it('drops unknown attributes, such as a link target or an inline style', () => {
    const parsed = announcementBodySchema.parse(
      doc({
        type: 'paragraph',
        attrs: { style: 'color: red' },
        content: [
          {
            type: 'text',
            text: 'x',
            marks: [{ type: 'link', attrs: { href: 'https://a.example', target: '_blank' } }],
          },
        ],
      }),
    );
    expect(parsed).toEqual(
      doc(paragraph('x', [{ type: 'link', attrs: { href: 'https://a.example' } }])),
    );
  });

  it('holds at most 10 000 characters of text', () => {
    expect(announcementBodySchema.safeParse(doc(paragraph('x'.repeat(10_000)))).success).toBe(true);
    expect(announcementBodySchema.safeParse(doc(paragraph('x'.repeat(10_001)))).success).toBe(
      false,
    );
  });

  it('gives the first 140 characters as one line of plain text', () => {
    expect(
      announcementExcerpt(
        announcementBodySchema.parse(doc(paragraph('سطر  أول'), paragraph('سطر ثان'))),
      ),
    ).toBe('سطر أول سطر ثان');
    expect(
      announcementExcerpt(announcementBodySchema.parse(doc(paragraph('x'.repeat(200))))),
    ).toHaveLength(140);
  });
});

describe('announcement inputs (rules D3, D5, D10)', () => {
  it('forces the acknowledgement of a critical announcement', () => {
    expect(createAnnouncementSchema.parse({ ...valid, priority: 'critical' }).requiresAck).toBe(
      true,
    );
    expect(updateAnnouncementSchema.parse({ priority: 'critical' }).requiresAck).toBe(true);
  });

  it('needs the time of a scheduled announcement, and a link for a link label', () => {
    expect(createAnnouncementSchema.safeParse({ ...valid, send: 'schedule' }).success).toBe(false);
    expect(
      createAnnouncementSchema.safeParse({
        ...valid,
        send: 'schedule',
        scheduledAt: '2026-10-21T09:00:00+03:00',
      }).success,
    ).toBe(true);
    expect(createAnnouncementSchema.safeParse({ ...valid, linkLabel: 'الملف' }).success).toBe(
      false,
    );
    expect(
      createAnnouncementSchema.safeParse({ ...valid, linkUrl: 'http://vertex.example' }).success,
    ).toBe(false);
  });

  it('schedules 5 minutes to 90 days ahead', () => {
    const now = new Date('2026-10-20T09:00:00Z');
    const ahead = (ms: number) => new Date(now.getTime() + ms);
    expect(isSchedulable(ahead(4 * 60_000), now)).toBe(false);
    expect(isSchedulable(ahead(5 * 60_000), now)).toBe(true);
    expect(isSchedulable(ahead(90 * 86_400_000), now)).toBe(true);
    expect(isSchedulable(ahead(90 * 86_400_000 + 1), now)).toBe(false);
  });
});

describe('audience (rule D1)', () => {
  it('needs at least one source', () => {
    expect(audienceSchema.safeParse({}).success).toBe(false);
    expect(audienceSchema.safeParse({ departments: [], exclude: [] }).success).toBe(false);
    expect(audienceSchema.safeParse({ roles: ['finance'] }).success).toBe(true);
  });

  it('holds at most 200 entries per list', () => {
    const ids = Array.from(
      { length: 201 },
      (_, n) => `0192a5a0-0000-7000-8000-${String(n).padStart(12, '0')}`,
    );
    expect(audienceSchema.safeParse({ users: ids }).success).toBe(false);
    expect(audienceSchema.safeParse({ users: ids.slice(0, 200) }).success).toBe(true);
  });
});

describe('announcement notifications (rule D3)', () => {
  const content = (priority: 'critical' | 'important' | 'normal' | 'informational', ack = false) =>
    ({
      type: 'announcement',
      data: { title: 'x', excerpt: 'y', priority, requiresAck: ack },
    }) as const;

  it("takes the announcement's priority, and needs you when it asks for an acknowledgement", () => {
    expect(notificationPriority(content('informational'))).toBe('informational');
    expect(notificationBox(content('normal', true))).toBe('action');
    expect(notificationBox(content('normal'))).toBe('info');
  });

  it('pushes by priority; a critical one always, whatever the policy', () => {
    const off = { announcement: { push: 'off', email: 'off' } } as const;
    expect(channelModeOf(content('critical', true), 'push', {})).toBe('required');
    expect(channelModeOf(content('critical', true), 'push', off)).toBe('required');
    expect(channelModeOf(content('important'), 'push', {})).toBe('on');
    expect(channelModeOf(content('normal'), 'push', {})).toBe('on');
    expect(channelModeOf(content('informational'), 'push', {})).toBe('off');
    expect(channelModeOf(content('normal'), 'push', off)).toBe('off');
    expect(channelModeOf(content('normal'), 'email', {})).toBe('off');
  });
});

describe('polls (rule D11)', () => {
  const poll = { question: 'أي يوم يناسب الاجتماع؟', options: ['الأحد', 'الاثنين'] };

  it('takes 2 to 10 distinct options, single choice, named and results for everyone by default', () => {
    expect(pollInputSchema.parse(poll)).toEqual({
      ...poll,
      multiple: false,
      anonymous: false,
      results: 'everyone_after_voting',
      closesAt: null,
    });
    expect(pollInputSchema.safeParse({ ...poll, options: ['الأحد'] }).success).toBe(false);
    expect(
      pollInputSchema.safeParse({ ...poll, options: Array.from({ length: 11 }, (_, i) => `${i}`) })
        .success,
    ).toBe(false);
    expect(pollInputSchema.safeParse({ ...poll, options: ['الأحد', 'الأحد'] }).success).toBe(false);
    expect(pollInputSchema.safeParse({ ...poll, question: 'لا' }).success).toBe(false);
    expect(createAnnouncementSchema.parse({ ...valid, poll }).poll?.options).toHaveLength(2);
  });

  it('closes 1 hour to 90 days after sending', () => {
    const sentAt = new Date('2026-10-20T09:00:00Z');
    const later = (ms: number) => new Date(sentAt.getTime() + ms);
    expect(isPollCloseTime(later(3_599_000), sentAt)).toBe(false);
    expect(isPollCloseTime(later(3_600_000), sentAt)).toBe(true);
    expect(isPollCloseTime(later(90 * 86_400_000), sentAt)).toBe(true);
    expect(isPollCloseTime(later(90 * 86_400_000 + 1000), sentAt)).toBe(false);
  });

  it('reminds non-voters one day before closing, when the poll runs at least two days', () => {
    const sentAt = new Date('2026-10-20T09:00:00Z');
    expect(pollClosingReminderAt(sentAt, null)).toBeNull();
    expect(pollClosingReminderAt(sentAt, new Date('2026-10-22T08:59:00Z'))).toBeNull();
    expect(pollClosingReminderAt(sentAt, new Date('2026-10-22T09:00:00Z'))).toEqual(
      new Date('2026-10-21T09:00:00Z'),
    );
  });

  it('votes for one or more distinct options', () => {
    const id = '019a0000-0000-7000-8000-000000000001';
    expect(pollVoteSchema.safeParse({ optionIds: [] }).success).toBe(false);
    expect(pollVoteSchema.safeParse({ optionIds: [id, id] }).success).toBe(false);
    expect(pollVoteSchema.parse({ optionIds: [id] })).toEqual({ optionIds: [id] });
  });
});

describe('templates (rule D12)', () => {
  const template = {
    name: 'دوام رمضان',
    title: valid.title,
    body: valid.body,
    priority: 'critical',
    requiresAck: false,
  } as const;

  it('holds no audience, is personal by default and keeps the acknowledgement of critical', () => {
    const parsed = createAnnouncementTemplateSchema.parse({
      ...template,
      audience: { everyone: true },
    });
    expect(parsed).not.toHaveProperty('audience');
    expect(parsed.shared).toBe(false);
    expect(parsed.requiresAck).toBe(true);
  });

  it('needs a 3–60 character name and a link for a link label', () => {
    expect(createAnnouncementTemplateSchema.safeParse({ ...template, name: 'ab' }).success).toBe(
      false,
    );
    expect(
      createAnnouncementTemplateSchema.safeParse({ ...template, linkLabel: 'النموذج' }).success,
    ).toBe(false);
  });
});
