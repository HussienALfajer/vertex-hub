import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AdDepositReceiptSnapshot,
  type CampaignPdfJob,
  campaignPdfStorageKey,
} from '@vertex-hub/contracts';
import { chromium } from 'playwright';
import { extractText, getDocumentProxy } from 'unpdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnv } from '../src/core/config/env.js';
import { CampaignsPdfJob } from '../src/jobs/campaigns-pdf.job.js';
import type { PgBossService } from '../src/jobs/pg-boss.service.js';
import { adDepositReceiptHtml } from '../src/pdf/campaign-templates.js';
import { loadAssets, PdfRenderer } from '../src/pdf/pdf-renderer.js';

const id = '0190a3c2-0000-7000-8000-0000000000ab';

const deposit: AdDepositReceiptSnapshot = {
  displayNumber: 'AD-2026-0003',
  companyDetails: 'فيرتكس ميديا\nدمشق - المزة',
  billingName: 'شركة الياسمين للمطاعم',
  receivedOn: '2026-10-04',
  amountMinor: 590_000_000,
  currency: 'SYP',
  conversion: { sypPerUsd: '11800.0000', usdMinor: 50_000 },
  method: 'bank_transfer',
  reference: 'TR-512',
  balanceAfterMinor: 72_500,
};

/** The extracted text: Arabic comes back in visual order with split words, so only counted. */
async function pdfText(path: string): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.normalize('NFKC');
}

const arabicLetters = (text: string) => text.match(/[؀-ۿ]/g)?.length ?? 0;

describe('campaigns.pdf', () => {
  let root: string;
  let job: CampaignsPdfJob;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'vertex-campaign-pdf-'));
    const env = parseEnv({ ...process.env, FILES_ROOT: root });
    job = new CampaignsPdfJob({} as PgBossService, new PdfRenderer(), env);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function render(payload: CampaignPdfJob): Promise<string> {
    const result = await job.render(payload);
    expect(result).toMatchObject({ kind: payload.kind, id: payload.id, hash: payload.hash });
    expect(result.file?.storageKey).toBe(campaignPdfStorageKey(payload));
    const path = join(root, result.file?.storageKey ?? '');
    expect((await stat(path)).size).toBe(result.file?.sizeBytes);
    return pdfText(path);
  }

  it('renders an SYP deposit in Arabic with its number, rate, USD amount and balance', async () => {
    const text = await render({
      kind: 'ad_deposit_receipt',
      id,
      hash: 'a'.repeat(64),
      snapshot: deposit,
    });
    expect(text).toContain('AD-2026-0003');
    expect(text).toContain('2026-10-04');
    expect(text).toContain('5,900,000.00');
    expect(text).toContain('11800.0000');
    expect(text).toContain('500.00');
    expect(text).toContain('725.00');
    expect(text).toContain('TR-512');
    expect(arabicLetters(text)).toBeGreaterThan(120);
  });

  it('renders a USD deposit without a rate, and a negative balance after it', async () => {
    const text = await render({
      kind: 'ad_deposit_receipt',
      id,
      hash: 'b'.repeat(64),
      snapshot: {
        ...deposit,
        amountMinor: 20_000,
        currency: 'USD',
        conversion: null,
        reference: null,
        balanceAfterMinor: -4_250,
      },
    });
    expect(text).toContain('200.00');
    expect(text).toContain('42.50');
    expect(text).not.toContain('11800');
    expect(text).not.toContain('TR-512');
  });

  it('is safe to run twice: the second run reuses the file', async () => {
    const payload: CampaignPdfJob = {
      kind: 'ad_deposit_receipt',
      id,
      hash: 'c'.repeat(64),
      snapshot: deposit,
    };
    const first = await job.render(payload);
    const path = join(root, first.file?.storageKey ?? '');
    const before = await stat(path);
    const second = await job.render(payload);
    expect(second).toEqual(first);
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
  });

  it('refuses a payload of another kind', async () => {
    await expect(
      job.render({ kind: 'receipt', id, hash: 'd'.repeat(64), snapshot: deposit }),
    ).rejects.toThrow();
  });

  it('lays out the receipt in print media (the RTL screenshot)', async () => {
    const html = adDepositReceiptHtml(deposit, await loadAssets());
    const browser = await chromium.launch();
    try {
      // An A4 page at 96 dpi; headless Chromium has no PDF viewer, so the print layout is shot.
      const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
      await page.emulateMedia({ media: 'print' });
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate('document.fonts.ready.then(() => true)');
      const path = join(
        dirname(fileURLToPath(import.meta.url)),
        '../test-results/ad-deposit-receipt-pdf-page.png',
      );
      await page.screenshot({ path });
      expect((await stat(path)).size).toBeGreaterThan(10_000);
    } finally {
      await browser.close();
    }
  });
});
