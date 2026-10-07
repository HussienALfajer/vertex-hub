import { describe, expect, it } from 'vitest';
import {
  changeInvoiceDueDateSchema,
  clientStatementQuerySchema,
  createInvoiceSchema,
  createProjectExpenseSchema,
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
  retainerChargeListQuerySchema,
  updateInvoiceServicesSchema,
  updateInvoiceSettingsSchema,
  updateProjectExpenseSchema,
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

  it('is paid at issue with a total of 0, a credit taking the whole month (F05B C7)', () => {
    expect(status('sent', 0, '2026-10-01', 0)).toBe('paid');
    expect(status('draft', 0, null, 0)).toBe('draft');
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
    expect(parsed.lines[0]?.serviceId).toBeNull();
  });

  it('takes an optional service per line (F15 rule 21)', () => {
    const parsed = invoiceDraftSchema.parse(
      draft([{ description: 'Logo', quantity: 1, unitPriceMinor: 100, serviceId: id }]),
    );
    expect(parsed.lines[0]?.serviceId).toBe(id);
    expect(
      invoiceDraftSchema.safeParse(
        draft([{ description: 'Logo', quantity: 1, unitPriceMinor: 100, serviceId: 'x' }]),
      ).success,
    ).toBe(false);
  });

  it('bounds description, quantity and price', () => {
    for (const line of [
      { description: '', quantity: 1, unitPriceMinor: 0 },
      { description: 'x'.repeat(301), quantity: 1, unitPriceMinor: 0 },
      { description: 'x', quantity: 0, unitPriceMinor: 0 },
      { description: 'x', quantity: 1000, unitPriceMinor: 0 },
      { description: 'x', quantity: 1, unitPriceMinor: 1.5 },
    ]) {
      expect(invoiceDraftSchema.safeParse(draft([line])).success, JSON.stringify(line)).toBe(false);
    }
  });

  it('takes a negative price, which the API allows on a credit line only (F05B C7)', () => {
    const credit = { description: 'x', quantity: 1, unitPriceMinor: -8000 };
    expect(invoiceDraftSchema.safeParse(draft([credit])).success).toBe(true);
  });
});

describe('updateInvoiceServicesSchema (F15 rule 22)', () => {
  it('sets or clears services of one to 50 lines', () => {
    expect(
      updateInvoiceServicesSchema.parse({
        lines: [
          { lineId: id, serviceId: id },
          { lineId: id, serviceId: null },
        ],
      }).lines,
    ).toHaveLength(2);
    expect(updateInvoiceServicesSchema.safeParse({ lines: [] }).success).toBe(false);
    expect(
      updateInvoiceServicesSchema.safeParse({
        lines: Array.from({ length: 51 }, () => ({ lineId: id, serviceId: null })),
      }).success,
    ).toBe(false);
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

describe('retainerChargeListQuerySchema (spec F05B)', () => {
  it('filters by none, one or several statuses and kinds', () => {
    expect(retainerChargeListQuerySchema.parse({})).toMatchObject({ page: 1 });
    expect(retainerChargeListQuerySchema.parse({}).status).toBeUndefined();
    const parsed = retainerChargeListQuerySchema.parse({
      status: 'pending',
      kind: ['monthly', 'credit'],
    });
    expect(parsed.status).toEqual(['pending']);
    expect(parsed.kind).toEqual(['monthly', 'credit']);
    expect(retainerChargeListQuerySchema.safeParse({ kind: 'cycle' }).success).toBe(false);
  });
});

describe('invoice sources (spec F05B C1)', () => {
  it('bills retainer charges, not cycles', () => {
    const line = { description: 'x', quantity: 1, unitPriceMinor: 100 };
    const draft = {
      updatedAt: '2026-10-10T09:00:00.000Z',
      projectId: null,
      retainerId: null,
      paymentTermsDays: 7,
      notes: null,
      lines: [{ ...line, source: { type: 'retainer_charge', id } }],
    };
    expect(invoiceDraftSchema.safeParse(draft).success).toBe(true);
    const cycle = { ...draft, lines: [{ ...line, source: { type: 'retainer_cycle', id } }] };
    expect(invoiceDraftSchema.safeParse(cycle).success).toBe(false);
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

describe('project expense schemas (rule 26)', () => {
  const expense = { spentOn: '2026-10-01', description: 'Studio rent', amountMinor: 5_000 };

  it('defaults the currency, the rate and the note to null', () => {
    expect(createProjectExpenseSchema.parse(expense)).toEqual({
      ...expense,
      currency: null,
      sypPerUsd: null,
      note: null,
    });
  });

  it('refuses a zero amount, an empty or long description and a bad rate', () => {
    for (const change of [
      { amountMinor: 0 },
      { description: ' ' },
      { description: 'x'.repeat(201) },
      { sypPerUsd: '0' },
      { note: 'x'.repeat(501) },
    ]) {
      expect(createProjectExpenseSchema.safeParse({ ...expense, ...change }).success).toBe(false);
    }
  });

  it('takes a partial change', () => {
    expect(updateProjectExpenseSchema.parse({ amountMinor: 7_000 })).toEqual({
      amountMinor: 7_000,
    });
    expect(updateProjectExpenseSchema.safeParse({ currency: null }).success).toBe(false);
  });
});

describe('clientStatementQuerySchema (rule 28)', () => {
  it('needs a currency and takes an optional period', () => {
    expect(clientStatementQuerySchema.parse({ currency: 'SYP' })).toEqual({ currency: 'SYP' });
    expect(clientStatementQuerySchema.safeParse({ from: '2026-01-01' }).success).toBe(false);
    expect(
      clientStatementQuerySchema.safeParse({ currency: 'USD', to: '2026-13-01' }).success,
    ).toBe(false);
  });
});
