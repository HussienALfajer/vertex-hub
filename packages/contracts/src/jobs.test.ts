import { describe, expect, it } from 'vitest';
import { quotePdfReadyJobSchema, quotePdfStorageKey } from './jobs.js';

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
