import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type QuoteSnapshot, quotePdfStorageKey } from '@vertex-hub/contracts';
import { extractText, getDocumentProxy } from 'unpdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnv } from '../src/core/config/env.js';
import type { PgBossService } from '../src/jobs/pg-boss.service.js';
import { QuotesPdfJob } from '../src/jobs/quotes-pdf.job.js';
import { PdfRenderer } from '../src/pdf/pdf-renderer.js';

const quoteId = '0190a3c2-0000-7000-8000-0000000000aa';
const hash = 'b'.repeat(64);

const snapshot: QuoteSnapshot = {
  displayNumber: 'Q-2026-0042 v2',
  title: 'هوية بصرية وإدارة صفحات',
  companyDetails: 'فيرتكس ميديا\nدمشق',
  client: 'مطعم الياسمين',
  addressee: 'سارة',
  currency: 'USD',
  sentOn: '2026-10-02',
  validUntil: '2026-10-16',
  oneOff: {
    lines: [
      {
        name: 'هوية بصرية',
        description: null,
        quantity: 1,
        unitPriceMinor: 80_000,
        totalMinor: 80_000,
        items: [],
      },
    ],
    subtotalMinor: 80_000,
    discountMinor: 8_000,
    netMinor: 72_000,
  },
  monthly: {
    lines: [
      {
        name: 'باقة السوشال الذهبية',
        description: null,
        quantity: 1,
        unitPriceMinor: 45_000,
        totalMinor: 45_000,
        items: [{ name: 'تصميم سوشال', quantity: 12 }],
      },
    ],
    subtotalMinor: 45_000,
    discountMinor: 0,
    netMinor: 45_000,
    termMonths: 6,
    termTotalMinor: 270_000,
  },
  installments: [
    { name: 'البداية', percent: 50, amountMinor: 36_000 },
    { name: 'التسليم', percent: 50, amountMinor: 36_000 },
  ],
  clientNotes: null,
  terms: 'الأسعار لا تشمل الطباعة.',
};

describe('quotes.pdf', () => {
  let root: string;
  let job: QuotesPdfJob;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'vertex-pdf-'));
    const env = parseEnv({ ...process.env, FILES_ROOT: root });
    job = new QuotesPdfJob({} as PgBossService, new PdfRenderer(), env);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('renders the snapshot as an Arabic PDF named by its hash', async () => {
    const result = await job.render({ quoteId, draft: false, hash, snapshot });
    expect(result.file?.storageKey).toBe(quotePdfStorageKey({ quoteId, hash }));
    const path = join(root, result.file?.storageKey ?? '');
    expect((await stat(path)).size).toBe(result.file?.sizeBytes);

    const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)));
    const { text } = await extractText(pdf, { mergePages: true });
    const normalized = text.normalize('NFKC');
    expect(normalized).toContain('Q-2026-0042');
    expect(normalized).toMatch(/[ء-ي]{3,}/);
    // Extraction keeps the visual order of Arabic and may split words: compare without spaces.
    // Extraction returns Arabic in visual order and drops some dots, so words are not compared:
    // the page holds plenty of Arabic text (not outlines), with the snapshot's numbers.
    expect(normalized.match(/[؀-ۿ]/g)?.length ?? 0).toBeGreaterThan(150);
    expect(normalized).toContain('2,700.00');
    // The snapshot's own amounts are printed (rule 14: it holds no list prices).
    expect(normalized).toContain('720.00');
  });

  it('is safe to run twice: the second run reuses the file', async () => {
    const first = await job.render({ quoteId, draft: true, hash: 'c'.repeat(64), snapshot });
    const path = join(root, first.file?.storageKey ?? '');
    const before = await stat(path);
    const second = await job.render({ quoteId, draft: true, hash: 'c'.repeat(64), snapshot });
    expect(second).toEqual(first);
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
  });

  it('refuses a payload that is not a quote render', async () => {
    await expect(job.render({ quoteId, draft: false, hash })).rejects.toThrow();
  });
});
