import { describe, expect, it } from 'vitest';
import { EMAIL_KINDS, emailAudienceOf, emailListQuerySchema } from './emails.js';
import { emailResultJobSchema, emailSendJobSchema } from './jobs.js';

const id = '0190a3c2-0000-7000-8000-000000000001';

describe('email kinds', () => {
  it('sends client kinds to clients and the rest to staff', () => {
    expect(emailAudienceOf('client_invoice')).toBe('client');
    expect(emailAudienceOf('client_ad_budget_low')).toBe('client');
    expect(emailAudienceOf('digest')).toBe('staff');
    expect(emailAudienceOf('test')).toBe('staff');
    expect(EMAIL_KINDS.filter((kind) => emailAudienceOf(kind) === 'client')).toHaveLength(11);
  });
});

describe('email log query', () => {
  it('reads repeated filters as lists and one value as a list of one', () => {
    const query = emailListQuerySchema.parse({ status: 'failed', kind: ['test', 'digest'] });
    expect(query.status).toEqual(['failed']);
    expect(query.kind).toEqual(['test', 'digest']);
    expect(query.page).toBe(1);
  });

  it('refuses an unknown status', () => {
    expect(emailListQuerySchema.safeParse({ status: 'bounced' }).success).toBe(false);
  });
});

describe('email jobs', () => {
  const send = {
    id,
    kind: 'test',
    to: [{ name: 'Rana', email: 'rana@example.com' }],
    cc: [],
    replyTo: null,
    subject: 'Test',
    message: null,
    data: { requestedBy: 'Rana' },
    attachments: [],
  };

  it('needs one to ten recipients', () => {
    expect(emailSendJobSchema.safeParse(send).success).toBe(true);
    expect(emailSendJobSchema.safeParse({ ...send, to: [] }).success).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      name: `C${i}`,
      email: `c${i}@example.com`,
    }));
    expect(emailSendJobSchema.safeParse({ ...send, to: eleven }).success).toBe(false);
  });

  it('reports sent with its time or failed with its error', () => {
    expect(
      emailResultJobSchema.safeParse({
        id,
        status: 'sent',
        attempts: 1,
        providerMessageId: '<a@b>',
        sentAt: '2026-10-04T05:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      emailResultJobSchema.safeParse({ id, status: 'failed', attempts: 4, error: 'EAUTH' }).success,
    ).toBe(true);
    expect(emailResultJobSchema.safeParse({ id, status: 'failed', attempts: 4 }).success).toBe(
      false,
    );
  });
});
