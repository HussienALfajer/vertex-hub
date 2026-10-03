import { describe, expect, it } from 'vitest';
import {
  invoicePdfJobSchema,
  invoicePdfReadyJobSchema,
  invoicePdfStorageKey,
  quotePdfReadyJobSchema,
  quotePdfStorageKey,
} from './jobs.js';

const quoteId = '0190a3c2-0000-7000-8000-000000000001';
const hash = 'a'.repeat(64);

describe('quote PDF jobs', () => {
  it('names the output by quote and payload hash, so a rerun finds it', () => {
    expect(quotePdfStorageKey({ quoteId, hash })).toBe(`objects/quotes/${quoteId}/${hash}.pdf`);
  });

  it('reports a stored file or a failure', () => {
    const file = { storageKey: quotePdfStorageKey({ quoteId, hash }), sizeBytes: 10, sha256: hash };
    expect(quotePdfReadyJobSchema.safeParse({ quoteId, draft: false, hash, file }).success).toBe(
      true,
    );
    expect(
      quotePdfReadyJobSchema.safeParse({ quoteId, draft: true, hash, file: null }).success,
    ).toBe(true);
    expect(
      quotePdfReadyJobSchema.safeParse({ quoteId, draft: false, hash: 'x', file: null }).success,
    ).toBe(false);
  });
});

describe('invoice PDF jobs', () => {
  const id = '0190a3c2-0000-7000-8000-000000000002';

  it('names the output by kind folder, record and payload hash', () => {
    expect(invoicePdfStorageKey({ kind: 'invoice', id, hash })).toBe(
      `objects/invoices/${id}/${hash}.pdf`,
    );
    expect(invoicePdfStorageKey({ kind: 'invoice_draft', id, hash })).toBe(
      `objects/invoices/${id}/${hash}.pdf`,
    );
    expect(invoicePdfStorageKey({ kind: 'receipt', id, hash })).toBe(
      `objects/receipts/${id}/${hash}.pdf`,
    );
    expect(invoicePdfStorageKey({ kind: 'statement', id, hash })).toBe(
      `objects/statements/${id}/${hash}.pdf`,
    );
  });

  it('checks the payload against its kind', () => {
    const snapshot = {
      displayNumber: null,
      companyDetails: '',
      billingName: 'Client',
      billingAddress: null,
      currency: 'USD',
      issuedOn: '2026-10-03',
      dueOn: '2026-10-10',
      lines: [],
      totalMinor: 0,
      notes: null,
      paymentDetails: '',
      footer: '',
    };
    expect(
      invoicePdfJobSchema.safeParse({ kind: 'invoice_draft', id, hash, snapshot }).success,
    ).toBe(true);
    // An issued invoice prints its number; a preview never does.
    expect(invoicePdfJobSchema.safeParse({ kind: 'invoice', id, hash, snapshot }).success).toBe(
      false,
    );
    expect(invoicePdfJobSchema.safeParse({ kind: 'receipt', id, hash, snapshot }).success).toBe(
      false,
    );
  });

  it('reports a stored file or a failure', () => {
    expect(
      invoicePdfReadyJobSchema.safeParse({ kind: 'statement', id, hash, file: null }).success,
    ).toBe(true);
    expect(
      invoicePdfReadyJobSchema.safeParse({ kind: 'other', id, hash, file: null }).success,
    ).toBe(false);
  });
});
