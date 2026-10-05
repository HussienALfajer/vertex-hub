import { CLIENT_EMAIL_KINDS, EMAIL_DATA_SCHEMAS } from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import { type ClientEmailData, clientEmailContent, clientEmailDraft } from './client-emails.js';

const signature = {
  name: 'رنا',
  title: 'مديرة حسابات',
  phone: '+963900000000',
  email: 'rana@vertexmedia.pro',
};
const base = { client: 'مطعم الشام', signature };
const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' as const });
const invoice = {
  number: 'INV-2026-0012',
  issuedOn: '2026-09-01',
  dueOn: '2026-09-15',
  total: usd(150_000),
  balance: usd(50_000),
};
const quote = {
  number: 'Q-2026-0004',
  title: 'إدارة حسابات التواصل',
  currency: 'USD' as const,
  oneOffMinor: 120_000,
  monthlyMinor: 30_000,
  validUntil: '2026-10-20',
};
const approval = {
  ...base,
  contact: 'سامي',
  items: ['تصميم منيو', 'ريلز الافتتاح'],
  expiresAt: '2026-10-12T09:00:00.000Z',
};

const CLIENT_SAMPLES = {
  client_quote: { kind: 'client_quote', data: { ...base, quote } },
  client_quote_reminder: { kind: 'client_quote_reminder', data: { ...base, quote } },
  client_approval_link: {
    kind: 'client_approval_link',
    data: { ...approval, link: 'https://hub.vertexmedia.pro/a/token' },
  },
  client_approval_reminder: { kind: 'client_approval_reminder', data: approval },
  client_invoice: { kind: 'client_invoice', data: { ...base, invoice } },
  client_invoice_reminder: {
    kind: 'client_invoice_reminder',
    data: { ...base, invoice, daysOverdue: 20 },
  },
  client_receipt: {
    kind: 'client_receipt',
    data: {
      ...base,
      invoiceId: '0192a5a0-0000-7000-8000-000000000001',
      receipt: {
        number: 'RC-2026-0003',
        invoiceNumber: 'INV-2026-0012',
        paidOn: '2026-09-20',
        amount: usd(100_000),
      },
    },
  },
  client_statement: {
    kind: 'client_statement',
    data: {
      ...base,
      statement: {
        currency: 'USD',
        from: '2026-01-01',
        to: '2026-10-05',
        outstandingMinor: 50_000,
      },
    },
  },
  client_report: { kind: 'client_report', data: { ...base, month: '2026-09' } },
  client_ad_receipt: {
    kind: 'client_ad_receipt',
    data: {
      ...base,
      receipt: { number: 'AD-2026-0002', occurredOn: '2026-10-01', amount: usd(30_000) },
    },
  },
  client_ad_budget_low: {
    kind: 'client_ad_budget_low',
    data: { ...base, balanceMinor: 4_500, thresholdMinor: 10_000 },
  },
} satisfies { [Kind in ClientEmailData['kind']]: Extract<ClientEmailData, { kind: Kind }> };

describe('client email drafts (rule 17)', () => {
  it.each(CLIENT_EMAIL_KINDS)('fills every placeholder of %s', (kind) => {
    const email = CLIENT_SAMPLES[kind];
    expect(EMAIL_DATA_SCHEMAS[kind].safeParse(email.data).success).toBe(true);
    const { subject, message } = clientEmailDraft(email);
    expect(subject.length).toBeGreaterThan(5);
    expect(subject.length).toBeLessThanOrEqual(200);
    expect(`${subject} ${message}`).not.toMatch(/\{\{|\}\}|undefined|null/);
  });

  it('fills the document number, the amount and the dates', () => {
    const { subject, message } = clientEmailDraft(CLIENT_SAMPLES.client_invoice_reminder);
    expect(subject).toBe('تذكير: الفاتورة INV-2026-0012 متأخرة السداد');
    expect(message).toContain('500.00');
    expect(message).toContain('15 أيلول 2026');
  });

  it('leaves the message of approval emails to the request (rule 19)', () => {
    expect(clientEmailDraft(CLIENT_SAMPLES.client_approval_link).message).toBe('');
  });
});

describe('client email content', () => {
  it.each(CLIENT_EMAIL_KINDS)('lays out %s with its facts and the signature', (kind) => {
    const content = clientEmailContent(CLIENT_SAMPLES[kind], 'مرحبًا،\n\nنص الرسالة');
    expect(content.facts?.length).toBeGreaterThan(0);
    expect(content.signature).toEqual([
      'رنا',
      'مديرة حسابات',
      '+963900000000',
      'rana@vertexmedia.pro',
    ]);
    expect(JSON.stringify(content)).not.toMatch(/\{\{|undefined/);
  });

  it('keeps the message as its paragraphs, without blank lines', () => {
    const content = clientEmailContent(CLIENT_SAMPLES.client_quote, 'مرحبًا،\n\n\nالسطر الثاني\n');
    expect(content.paragraphs).toEqual(['مرحبًا،', 'السطر الثاني']);
  });

  it('gives the approval link a button and lists the items; the reminder has no link', () => {
    const link = clientEmailContent(CLIENT_SAMPLES.client_approval_link, null);
    expect(link.action?.url).toBe('https://hub.vertexmedia.pro/a/token');
    expect(link.sections?.[0]?.items.map((item) => item.text)).toEqual([
      'تصميم منيو',
      'ريلز الافتتاح',
    ]);
    const reminder = clientEmailContent(CLIENT_SAMPLES.client_approval_reminder, null);
    expect(reminder.action).toBeUndefined();
    expect(reminder.paragraphs[0]).toBe('مرحبًا سامي،');
  });
});
