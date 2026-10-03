import { describe, expect, it } from 'vitest';
import {
  changeInvoiceDueDateSchema,
  createInvoiceSchema,
  type InvoiceDraftInput,
  type InvoiceStatus,
  invoiceDisplayNumber,
  invoiceDraftSchema,
  invoiceListQuerySchema,
  invoiceStatus,
  issueInvoiceSchema,
  rateIsStale,
  receiptDisplayNumber,
  recordPaymentSchema,
  updateInvoiceSettingsSchema,
  voidPaymentSchema,
} from './invoices.js';

const id = '0192f000-0000-7000-8000-000000000001';

describe('invoiceStatus (rule 21)', () => {
  const today = '2026-10-10';
  const status = (
    current: InvoiceStatus,
    paidMinor: number,
    dueOn: string | null,
    totalMinor = 1000,
  ) => invoiceStatus({ status: current, totalMinor, paidMinor, dueOn, today });

  it('keeps drafts and void invoices as they are', () => {
    expect(status('draft', 0, null)).toBe('draft');
    expect(status('void', 1000, '2026-01-01')).toBe('void');
  });

  it('is paid when the paid amount reaches the total, even past due', () => {
    for (const current of ['sent', 'partially_paid', 'overdue', 'paid'] as const) {
      expect(status(current, 1000, '2026-10-01')).toBe('paid');
      expect(status(current, 1000, '2026-10-20')).toBe('paid');
    }
  });

  it('is overdue past the due date with a balance, paid in part or not', () => {
    for (const current of ['sent', 'partially_paid', 'overdue', 'paid'] as const) {
      expect(status(current, 0, '2026-10-09')).toBe('overdue');
      expect(status(current, 400, '2026-10-09')).toBe('overdue');
    }
  });

  it('is not overdue on the due date itself', () => {
    expect(status('sent', 0, today)).toBe('sent');
    expect(status('overdue', 400, today)).toBe('partially_paid');
  });

  it('is partially paid or sent before the due date', () => {
    for (const current of ['sent', 'partially_paid', 'overdue', 'paid'] as const) {
      expect(status(current, 400, '2026-10-20')).toBe('partially_paid');
      expect(status(current, 0, '2026-10-20')).toBe('sent');
    }
  });
});

describe('invoiceDisplayNumber', () => {
  it('pads the number to four digits', () => {
    expect(invoiceDisplayNumber({ year: 2026, number: 12 })).toBe('INV-2026-0012');
    expect(invoiceDisplayNumber({ year: 2027, number: 12345 })).toBe('INV-2027-12345');
  });
});

describe('rateIsStale (rule 10)', () => {
  const now = new Date('2026-10-10T12:00:00Z');

  it('warns only after 7 days, and never before a rate is set', () => {
    expect(rateIsStale(null, now)).toBe(false);
    expect(rateIsStale(new Date('2026-10-03T12:00:00Z'), now)).toBe(false);
    expect(rateIsStale(new Date('2026-10-03T11:59:59Z'), now)).toBe(true);
  });
});

describe('updateInvoiceSettingsSchema', () => {
  it('bounds terms and texts and refuses clearing the rate', () => {
    expect(updateInvoiceSettingsSchema.safeParse({ paymentTermsDays: 0 }).success).toBe(true);
    expect(updateInvoiceSettingsSchema.safeParse({ paymentTermsDays: 91 }).success).toBe(false);
    expect(
      updateInvoiceSettingsSchema.safeParse({ paymentDetails: 'x'.repeat(2001) }).success,
    ).toBe(false);
    expect(updateInvoiceSettingsSchema.safeParse({ sypPerUsd: null }).success).toBe(false);
    expect(updateInvoiceSettingsSchema.safeParse({ sypPerUsd: '118.50' }).success).toBe(true);
  });
});

describe('createInvoiceSchema', () => {
  it('fills the defaults', () => {
    expect(createInvoiceSchema.parse({ clientId: id, currency: 'USD' })).toEqual({
      clientId: id,
      currency: 'USD',
      projectId: null,
      retainerId: null,
      sources: [],
    });
  });

  it('refuses a project and a retainer together', () => {
    expect(
      createInvoiceSchema.safeParse({
        clientId: id,
        currency: 'SYP',
        projectId: id,
        retainerId: id,
      }).success,
    ).toBe(false);
  });
});

describe('invoiceDraftSchema', () => {
  const draft = (lines: InvoiceDraftInput['lines']): InvoiceDraftInput => ({
    updatedAt: '2026-10-10T09:00:00.000Z',
    projectId: null,
    retainerId: null,
    paymentTermsDays: 7,
    notes: '  ',
    lines,
  });

  it('accepts free and sourced lines and stores blank notes as null', () => {
    const parsed = invoiceDraftSchema.parse(
      draft([
        { description: 'Extra design', quantity: 2, unitPriceMinor: 5000 },
        {
          description: 'Milestone',
          quantity: 1,
          unitPriceMinor: 0,
          source: { type: 'milestone', id },
        },
      ]),
    );
    expect(parsed.notes).toBeNull();
    expect(parsed.lines[0]?.source).toBeNull();
  });

  it('bounds description, quantity and price', () => {
    for (const line of [
      { description: '', quantity: 1, unitPriceMinor: 0 },
      { description: 'x'.repeat(301), quantity: 1, unitPriceMinor: 0 },
      { description: 'x', quantity: 0, unitPriceMinor: 0 },
      { description: 'x', quantity: 1000, unitPriceMinor: 0 },
      { description: 'x', quantity: 1, unitPriceMinor: -1 },
      { description: 'x', quantity: 1, unitPriceMinor: 1.5 },
    ]) {
      expect(invoiceDraftSchema.safeParse(draft([line])).success, JSON.stringify(line)).toBe(false);
    }
  });
});

describe('issueInvoiceSchema', () => {
  it('defaults the due date and the rate to the server', () => {
    expect(issueInvoiceSchema.parse({ updatedAt: '2026-10-10T09:00:00.000Z' })).toEqual({
      updatedAt: '2026-10-10T09:00:00.000Z',
      dueOn: null,
      sypPerUsd: null,
    });
    expect(
      issueInvoiceSchema.safeParse({ updatedAt: '2026-10-10T09:00:00.000Z', sypPerUsd: '0' })
        .success,
    ).toBe(false);
  });
});

describe('changeInvoiceDueDateSchema', () => {
  it('needs a reason of at most 500 characters', () => {
    expect(changeInvoiceDueDateSchema.safeParse({ dueOn: '2026-10-20', reason: ' ' }).success).toBe(
      false,
    );
    expect(
      changeInvoiceDueDateSchema.safeParse({ dueOn: '2026-10-20', reason: 'x'.repeat(501) })
        .success,
    ).toBe(false);
  });
});

describe('invoiceListQuerySchema', () => {
  it('lists drafts and open invoices by default', () => {
    expect(invoiceListQuerySchema.parse({}).status).toEqual([
      'draft',
      'sent',
      'partially_paid',
      'overdue',
    ]);
    expect(invoiceListQuerySchema.parse({ status: 'void' }).status).toEqual(['void']);
  });
});

describe('receiptDisplayNumber', () => {
  it('pads the number to four digits', () => {
    expect(receiptDisplayNumber({ year: 2026, number: 7 })).toBe('RC-2026-0007');
    expect(receiptDisplayNumber({ year: 2026, number: 12345 })).toBe('RC-2026-12345');
  });
});

describe('recordPaymentSchema', () => {
  const payment = { paidOn: '2026-10-10', amountMinor: 5_000, currency: 'USD', method: 'cash' };

  it('defaults the rate to the server and blank texts to null', () => {
    expect(recordPaymentSchema.parse({ ...payment, reference: ' ', note: '' })).toEqual({
      ...payment,
      sypPerUsd: null,
      reference: null,
      note: null,
      proofUploadId: null,
    });
  });

  it('needs a positive amount, a known method and a valid rate', () => {
    for (const change of [
      { amountMinor: 0 },
      { amountMinor: 1.5 },
      { method: 'cheque' },
      { sypPerUsd: '0' },
      { currency: 'EUR' },
      { paidOn: '2026-13-01' },
    ]) {
      expect(
        recordPaymentSchema.safeParse({ ...payment, ...change }).success,
        JSON.stringify(change),
      ).toBe(false);
    }
  });

  it('limits the reference to 200 and the note to 500 characters', () => {
    expect(recordPaymentSchema.safeParse({ ...payment, reference: 'x'.repeat(201) }).success).toBe(
      false,
    );
    expect(recordPaymentSchema.safeParse({ ...payment, note: 'x'.repeat(501) }).success).toBe(
      false,
    );
  });
});

describe('voidPaymentSchema', () => {
  it('needs a reason', () => {
    expect(voidPaymentSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(voidPaymentSchema.parse({ reason: ' Recorded twice ' })).toEqual({
      reason: 'Recorded twice',
    });
  });
});
