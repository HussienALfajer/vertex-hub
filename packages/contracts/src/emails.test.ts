import { describe, expect, it } from 'vitest';
import { EMAIL_KINDS, emailAudienceOf } from './email-basics.js';
import {
  clientEmailSchema,
  EMAIL_DATA_SCHEMAS,
  EMAIL_SECRET_FIELDS,
  emailListQuerySchema,
  isEmailBatchWindow,
  quoteEmailSchema,
} from './emails.js';
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

  it('reads a job without sealed links as having none', () => {
    expect(emailSendJobSchema.parse(send).sealed).toBeNull();
  });

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

describe('notification email window (rule 7)', () => {
  // Damascus is UTC+3: 05:10 UTC is 08:10 there. 3 October 2026 is a Saturday, 9 October a Friday.
  it('opens at 08:10 and closes at 20:00 on work days', () => {
    expect(isEmailBatchWindow(new Date('2026-10-03T05:09:59Z'))).toBe(false);
    expect(isEmailBatchWindow(new Date('2026-10-03T05:10:00Z'))).toBe(true);
    expect(isEmailBatchWindow(new Date('2026-10-03T16:59:00Z'))).toBe(true);
    expect(isEmailBatchWindow(new Date('2026-10-03T17:00:00Z'))).toBe(false);
    expect(isEmailBatchWindow(new Date('2026-10-08T12:00:00Z'))).toBe(true);
  });

  it('stays closed all Friday', () => {
    expect(isEmailBatchWindow(new Date('2026-10-09T09:00:00Z'))).toBe(false);
  });
});

describe('staff email data', () => {
  it('keeps the token links of account emails out of the outbox row', () => {
    expect(EMAIL_SECRET_FIELDS.account_activation).toEqual(['link']);
    expect(EMAIL_SECRET_FIELDS.password_reset).toEqual(['link']);
    expect(EMAIL_SECRET_FIELDS.client_approval_link).toEqual(['link']);
    expect(EMAIL_SECRET_FIELDS.digest).toBeUndefined();
  });

  it('caps a batch at 20 notifications and counts the rest', () => {
    const schema = EMAIL_DATA_SCHEMAS.notification_batch;
    expect(
      schema.safeParse({ notifications: { items: [], more: 3 }, departments: {} }).success,
    ).toBe(true);
    const items = Array.from({ length: 21 }, () => ({}));
    expect(schema.safeParse({ notifications: { items, more: 0 }, departments: {} }).success).toBe(
      false,
    );
  });

  it('names who made a security change, or no one when it was the user', () => {
    const notice = { name: 'رنا', change: 'roles_changed', at: '2026-10-05T07:00:00.000Z' };
    expect(EMAIL_DATA_SCHEMAS.security_notice.safeParse({ ...notice, by: null }).success).toBe(
      true,
    );
    expect(
      EMAIL_DATA_SCHEMAS.security_notice.safeParse({ ...notice, change: 'email_changed', by: null })
        .success,
    ).toBe(false);
  });
});

describe('client emails', () => {
  const email = { contactIds: [id], subject: 'عرض السعر', message: 'مرحبًا' };

  it('copies the account manager by default and not the sender', () => {
    const parsed = clientEmailSchema.parse(email);
    expect(parsed.ccAccountManager).toBe(true);
    expect(parsed.ccMe).toBe(false);
  });

  it('needs one to ten different contacts, a subject and a message', () => {
    expect(clientEmailSchema.safeParse({ ...email, contactIds: [] }).success).toBe(false);
    expect(clientEmailSchema.safeParse({ ...email, contactIds: [id, id] }).success).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => id.replace(/1$/, i.toString(16)));
    expect(clientEmailSchema.safeParse({ ...email, contactIds: eleven }).success).toBe(false);
    expect(clientEmailSchema.safeParse({ ...email, subject: ' ' }).success).toBe(false);
    expect(clientEmailSchema.safeParse({ ...email, message: 'x'.repeat(4001) }).success).toBe(
      false,
    );
  });

  it('tells a quote from its reminder', () => {
    expect(quoteEmailSchema.safeParse({ ...email, kind: 'reminder' }).success).toBe(true);
    expect(quoteEmailSchema.safeParse({ ...email, kind: 'invoice' }).success).toBe(false);
  });

  it('carries the sender signature and the document facts', () => {
    const signature = { name: 'Rana', title: null, phone: null, email: 'rana@example.com' };
    const quote = {
      client: 'Acme',
      signature,
      quote: {
        number: 'Q-2026-0001',
        title: 'Social media',
        currency: 'USD',
        oneOffMinor: 150000,
        monthlyMinor: null,
        validUntil: '2026-10-30',
      },
    };
    expect(EMAIL_DATA_SCHEMAS.client_quote.safeParse(quote).success).toBe(true);
    expect(
      EMAIL_DATA_SCHEMAS.client_quote.safeParse({
        ...quote,
        signature: { ...signature, email: '' },
      }).success,
    ).toBe(false);
  });
});
