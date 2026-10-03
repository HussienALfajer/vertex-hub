import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type InvoicePdfJob,
  type InvoiceSnapshot,
  invoicePdfStorageKey,
  type ReceiptSnapshot,
  type StatementSnapshot,
} from '@vertex-hub/contracts';
import { chromium } from 'playwright';
import { extractText, getDocumentProxy } from 'unpdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnv } from '../src/core/config/env.js';
import { InvoicesPdfJob } from '../src/jobs/invoices-pdf.job.js';
import type { PgBossService } from '../src/jobs/pg-boss.service.js';
import { invoiceHtml, receiptHtml, statementHtml } from '../src/pdf/invoice-templates.js';
import { loadAssets, PdfRenderer } from '../src/pdf/pdf-renderer.js';

const id = '0190a3c2-0000-7000-8000-0000000000bb';
const clientId = '0190a3c2-0000-7000-8000-0000000000cc';
const invoiceId = '0190a3c2-0000-7000-8000-0000000000dd';
const paymentId = '0190a3c2-0000-7000-8000-0000000000ee';

const company = 'فيرتكس ميديا\nدمشق - المزة';

const invoice: InvoiceSnapshot = {
  displayNumber: 'INV-2026-0042',
  companyDetails: company,
  billingName: 'شركة الياسمين للمطاعم',
  billingAddress: 'دمشق، شارع بغداد',
  currency: 'USD',
  issuedOn: '2026-10-03',
  dueOn: '2026-10-10',
  lines: [
    {
      description: 'الدفعة الأولى: هوية بصرية',
      quantity: 1,
      unitPriceMinor: 40_000,
      totalMinor: 40_000,
    },
    { description: 'تصاميم إضافية', quantity: 3, unitPriceMinor: 2_500, totalMinor: 7_500 },
  ],
  totalMinor: 47_500,
  notes: 'شكراً لتعاملكم معنا.',
  paymentDetails: 'تحويل إلى الحساب رقم 123456',
  footer: 'تستحق الفاتورة خلال سبعة أيام.',
};

const receipt: ReceiptSnapshot = {
  displayNumber: 'RC-2026-0007',
  companyDetails: company,
  billingName: invoice.billingName,
  billingAddress: invoice.billingAddress,
  paidOn: '2026-10-05',
  amountMinor: 300_000_000,
  currency: 'SYP',
  method: 'bank_transfer',
  reference: 'TR-889',
  invoiceNumber: 'INV-2026-0042',
  invoiceCurrency: 'USD',
  appliedMinor: 20_000,
  balanceAfterMinor: 27_500,
  footer: '',
};

const statement: StatementSnapshot = {
  companyDetails: company,
  client: { id: clientId, name: 'الياسمين' },
  billingName: invoice.billingName,
  billingAddress: invoice.billingAddress,
  currency: 'USD',
  from: '2026-01-01',
  to: '2026-10-31',
  openingMinor: 0,
  rows: [
    {
      kind: 'invoice',
      id: invoiceId,
      date: '2026-10-03',
      number: 'INV-2026-0042',
      invoiceId,
      invoiceNumber: 'INV-2026-0042',
      debitMinor: 47_500,
      creditMinor: 0,
      balanceMinor: 47_500,
      original: null,
    },
    {
      kind: 'payment',
      id: paymentId,
      date: '2026-10-05',
      number: 'RC-2026-0007',
      invoiceId,
      invoiceNumber: 'INV-2026-0042',
      debitMinor: 0,
      creditMinor: 20_000,
      balanceMinor: 27_500,
      original: { amountMinor: 300_000_000, currency: 'SYP' },
    },
  ],
  closingMinor: 27_500,
  invoicedMinor: 47_500,
  paidMinor: 20_000,
  outstandingMinor: 27_500,
};

/** The extracted text: Arabic comes back in visual order with split words, so only counted. */
async function pdfText(path: string): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.normalize('NFKC');
}

const arabicLetters = (text: string) => text.match(/[؀-ۿ]/g)?.length ?? 0;

describe('invoices.pdf', () => {
  let root: string;
  let job: InvoicesPdfJob;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'vertex-invoice-pdf-'));
    const env = parseEnv({ ...process.env, FILES_ROOT: root });
    job = new InvoicesPdfJob({} as PgBossService, new PdfRenderer(), env);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function render(payload: InvoicePdfJob): Promise<string> {
    const result = await job.render(payload);
    expect(result).toMatchObject({ kind: payload.kind, id: payload.id, hash: payload.hash });
    expect(result.file?.storageKey).toBe(invoicePdfStorageKey(payload));
    const path = join(root, result.file?.storageKey ?? '');
    expect((await stat(path)).size).toBe(result.file?.sizeBytes);
    return pdfText(path);
  }

  it('renders an issued invoice in Arabic with its number and amounts', async () => {
    const text = await render({ kind: 'invoice', id, hash: 'a'.repeat(64), snapshot: invoice });
    expect(text).toContain('INV-2026-0042');
    expect(text).toContain('2026-10-10');
    expect(text).toContain('475.00');
    expect(text).toContain('75.00');
    expect(arabicLetters(text)).toBeGreaterThan(150);
  });

  it('renders a draft preview without a number', async () => {
    const text = await render({
      kind: 'invoice_draft',
      id,
      hash: 'b'.repeat(64),
      snapshot: { ...invoice, displayNumber: null },
    });
    expect(text).not.toContain('INV-');
    expect(text).toContain('475.00');
  });

  it('renders a receipt with the amount, the applied amount and the balance after it', async () => {
    const text = await render({ kind: 'receipt', id, hash: 'c'.repeat(64), snapshot: receipt });
    expect(text).toContain('RC-2026-0007');
    expect(text).toContain('INV-2026-0042');
    expect(text).toContain('3,000,000.00');
    expect(text).toContain('200.00');
    expect(text).toContain('275.00');
    expect(text).toContain('TR-889');
    expect(arabicLetters(text)).toBeGreaterThan(80);
  });

  it('renders a statement with its rows and totals', async () => {
    const text = await render({
      kind: 'statement',
      id,
      hash: 'd'.repeat(64),
      snapshot: statement,
    });
    expect(text).toContain('INV-2026-0042');
    expect(text).toContain('RC-2026-0007');
    expect(text).toContain('2026-01-01');
    expect(text).toContain('275.00');
    expect(arabicLetters(text)).toBeGreaterThan(80);
  });

  it('is safe to run twice: the second run reuses the file', async () => {
    const payload: InvoicePdfJob = {
      kind: 'receipt',
      id,
      hash: 'e'.repeat(64),
      snapshot: receipt,
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
      job.render({ kind: 'statement', id, hash: 'f'.repeat(64), snapshot: receipt }),
    ).rejects.toThrow();
  });

  it('lays out the first page of each document in print media (the RTL screenshots)', async () => {
    const assets = await loadAssets();
    const pages = {
      'invoice-pdf-page': invoiceHtml(invoice, assets),
      'receipt-pdf-page': receiptHtml(receipt, assets),
      'statement-pdf-page': statementHtml(statement, assets),
    };
    const browser = await chromium.launch();
    try {
      for (const [name, html] of Object.entries(pages)) {
        // An A4 page at 96 dpi; headless Chromium has no PDF viewer, so the print layout is shot.
        const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
        await page.emulateMedia({ media: 'print' });
        await page.setContent(html, { waitUntil: 'load' });
        await page.evaluate('document.fonts.ready.then(() => true)');
        const path = join(dirname(fileURLToPath(import.meta.url)), `../test-results/${name}.png`);
        await page.screenshot({ path });
        expect((await stat(path)).size).toBeGreaterThan(10_000);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });
});
