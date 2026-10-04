import { describe, expect, it } from 'vitest';
import {
  campaignPdfJobSchema,
  campaignPdfReadyJobSchema,
  campaignPdfStorageKey,
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

describe('campaign PDF jobs', () => {
  const id = '0190a3c2-0000-7000-8000-000000000003';
  const snapshot = {
    displayNumber: 'AD-2026-0001',
    companyDetails: '',
    billingName: 'Client',
    receivedOn: '2026-10-04',
    amountMinor: 5_900_000_000,
    currency: 'SYP',
    conversion: { sypPerUsd: '11800.0000', usdMinor: 50_000 },
    method: 'bank_transfer',
    reference: null,
    balanceAfterMinor: -1_000,
  };

  it('names the output by entry and payload hash', () => {
    expect(campaignPdfStorageKey({ id, hash })).toBe(`objects/ad-receipts/${id}/${hash}.pdf`);
  });

  it('takes a deposit receipt, with a negative balance after it', () => {
    const job = { kind: 'ad_deposit_receipt', id, hash, snapshot };
    expect(campaignPdfJobSchema.safeParse(job).success).toBe(true);
    expect(campaignPdfJobSchema.safeParse({ ...job, kind: 'receipt' }).success).toBe(false);
    expect(
      campaignPdfJobSchema.safeParse({ ...job, snapshot: { ...snapshot, conversion: {} } }).success,
    ).toBe(false);
  });

  it('reports a stored file or a failure', () => {
    const ready = { kind: 'ad_deposit_receipt', id, hash, file: null };
    expect(campaignPdfReadyJobSchema.safeParse(ready).success).toBe(true);
    expect(campaignPdfReadyJobSchema.safeParse({ ...ready, hash: 'x' }).success).toBe(false);
  });
});
