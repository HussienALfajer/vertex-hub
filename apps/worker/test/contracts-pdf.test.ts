import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AnnexSnapshot,
  type ContractPdfJob,
  type ContractSnapshot,
  contractPdfStorageKey,
  type UnqueuedPdfJob,
} from '@vertex-hub/contracts';
import { chromium } from 'playwright';
import { extractText, getDocumentProxy } from 'unpdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnv } from '../src/core/config/env.js';
import { ContractsPdfJob } from '../src/jobs/contracts-pdf.job.js';
import type { PgBossService } from '../src/jobs/pg-boss.service.js';
import { annexHtml, contractHtml } from '../src/pdf/contract-templates.js';
import { loadAssets, PdfRenderer } from '../src/pdf/pdf-renderer.js';
import { expectLogo, expectMissingLogoLogged, expectNoLogo, LOGO } from './client-logo-cases.js';

const id = '0190a3c2-0000-7000-8000-0000000000c5';

const LONG =
  'تلتزم الوكالة بتنفيذ الخدمات بمهنية وجودة وفق أفضل الممارسات وفي المواعيد المتفق عليها، وتعيين مدير حساب مسؤول عن التواصل مع العميل ومتابعة العمل.';

const contract: ContractSnapshot = {
  displayNumber: 'VM-CCS-2026-007',
  contractDate: '2026-10-14',
  agency: {
    legalName: 'شركة فيرتكس ميديا',
    tradeName: 'فيرتكس ميديا',
    companyType: 'شركة محدودة المسؤولية',
    registrationNumber: 'CR-5521',
    address: 'دمشق - المزة',
    phone: '+963 11 000 1234',
    email: 'hello@vertexmedia.example',
    website: 'vertexmedia.example',
    representativeName: 'محمد الفجر',
    representativeTitle: 'المدير العام',
  },
  client: {
    signatoryName: 'سامر الأحمد',
    fatherName: 'محمد',
    tradeName: 'مطعم الياسمين',
    nationalId: '01020304050',
    registrationNumber: '',
    phone: '+963944000111',
    email: '',
    address: 'دمشق، أبو رمانة',
    title: 'المدير التنفيذي',
  },
  slogan: 'نبدأ بفكرة، ونبني كياناً، ونصنع أثراً.',
  articles: [
    { number: 1, title: 'موضوع العقد', body: LONG },
    { number: 2, title: 'نطاق الخدمات', body: 'تشمل الخدمات ما يلي.\n{services}' },
    { number: 3, title: 'مدة العقد ودورات الخدمة', body: 'يسري هذا العقد للمدة المبينة.\n{term}' },
    { number: 4, title: 'الأتعاب وطريقة الدفع', body: 'تُسدَّد خلال 7 أيام.\n{fees}' },
    ...Array.from({ length: 12 }, (_, index) => ({
      number: index + 5,
      title: `مادة ${index + 5}`,
      body: `${LONG}\n${LONG}`,
    })),
  ],
  services: {
    quote: {
      displayNumber: 'Q-2026-0012 v2',
      lines: [
        {
          name: 'باقة السوشيال',
          quantity: 1,
          items: [
            { name: 'تصاميم', quantity: 12 },
            { name: 'ريلز', quantity: 4 },
          ],
        },
      ],
    },
    deliverables: [
      { kind: 'design', label: null, quantity: 12, revisionLimit: 2 },
      { kind: 'reel', label: null, quantity: 4, revisionLimit: null },
    ],
  },
  term: {
    kind: 'term',
    retainerName: 'إدارة الحسابات',
    startDate: '2026-10-20',
    cycleDay: 20,
    cycles: 3,
    endDate: '2027-01-19',
    endAction: 'renew',
  },
  fees: {
    currency: 'USD',
    agreedTotalMinor: 120_000,
    schedule: [
      { cycle: 2, periodStart: '2026-10-20', periodEnd: '2026-11-19', amountMinor: 40_000 },
      { cycle: 3, periodStart: '2026-11-20', periodEnd: '2026-12-19', amountMinor: 40_000 },
      { cycle: 4, periodStart: '2026-12-20', periodEnd: '2027-01-19', amountMinor: 40_000 },
    ],
    feeMinor: null,
  },
};

const annex: AnnexSnapshot = {
  annexNumber: 1,
  contractNumber: 'VM-CCS-2026-007',
  annexDate: '2026-11-25',
  agency: {
    legalName: contract.agency.legalName,
    tradeName: contract.agency.tradeName,
    representativeName: contract.agency.representativeName,
    representativeTitle: contract.agency.representativeTitle,
    website: contract.agency.website,
    address: contract.agency.address,
    phone: contract.agency.phone,
  },
  client: { signatoryName: 'سامر الأحمد', tradeName: 'مطعم الياسمين', title: 'المدير التنفيذي' },
  amendment: {
    number: 2,
    kind: 'change',
    scope: 'onward',
    effectiveCycle: 3,
    periodStart: '2026-11-20',
    periodEnd: '2026-12-19',
    lines: [{ kind: 'reel', label: null, quantityDelta: 2, revisionLimit: null }],
    currency: 'USD',
    amountDeltaMinor: -5_000,
    schedule: null,
    reason: 'تخفيض متفق عليه',
  },
};

const results = join(dirname(fileURLToPath(import.meta.url)), '../test-results');

/** The extracted text: Arabic comes back in visual order with split words, so only counted. */
async function pdfText(path: string): Promise<{ text: string; pages: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)));
  const { text } = await extractText(pdf, { mergePages: true });
  return { text: text.normalize('NFKC'), pages: pdf.numPages };
}

const arabicLetters = (text: string) => text.match(/[؀-ۿ]/g)?.length ?? 0;

async function screenshot(html: string, name: string) {
  const browser = await chromium.launch();
  try {
    // An A4 page at 96 dpi; headless Chromium has no PDF viewer, so the print layout is shot.
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
    await page.emulateMedia({ media: 'print' });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate('document.fonts.ready.then(() => true)');
    const path = join(results, `${name}.png`);
    await page.screenshot({ path, fullPage: true });
    expect((await stat(path)).size).toBeGreaterThan(10_000);
  } finally {
    await browser.close();
  }
}

describe('contracts.pdf (F05C K6, K10)', () => {
  let root: string;
  let job: ContractsPdfJob;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'vertex-contract-pdf-'));
    const env = parseEnv({ ...process.env, FILES_ROOT: root });
    job = new ContractsPdfJob({} as PgBossService, new PdfRenderer(), env);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function render(payload: UnqueuedPdfJob<ContractPdfJob>) {
    const result = await job.render(payload);
    expect(result).toMatchObject({ kind: payload.kind, id: payload.id, hash: payload.hash });
    expect(result.file?.storageKey).toBe(contractPdfStorageKey(payload));
    const path = join(root, result.file?.storageKey ?? '');
    expect((await stat(path)).size).toBe(result.file?.sizeBytes);
    return { path, ...(await pdfText(path)) };
  }

  it('prints the parties, the articles with their blocks and the footer on every page', async () => {
    const { text, pages } = await render({
      kind: 'contract',
      id,
      hash: 'a'.repeat(64),
      snapshot: contract,
    });
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain('VM-CCS-2026-007');
    expect(text).toContain('CR-5521');
    expect(text).toContain('01020304050');
    expect(text).toContain('Q-2026-0012 v2');
    expect(text).toContain('1,200.00');
    expect(text).toContain('400.00');
    // The footer and the page badge print on every page (page-margin boxes).
    expect(text.split('vertexmedia.example').length - 1).toBeGreaterThanOrEqual(pages);
    expect(arabicLetters(text)).toBeGreaterThan(1500);
  });

  it('prints an open-ended draft with empty fields and a watermark', async () => {
    const { text } = await render({
      kind: 'contract_draft',
      id,
      hash: 'b'.repeat(64),
      snapshot: {
        ...contract,
        displayNumber: null,
        agency: { ...contract.agency, website: '', companyType: '' },
        services: { quote: null, deliverables: [] },
        term: {
          ...contract.term,
          kind: 'open_ended',
          cycles: null,
          endDate: null,
          endAction: null,
        },
        fees: { currency: 'USD', agreedTotalMinor: null, schedule: [], feeMinor: 50_000 },
        articles: contract.articles.slice(0, 4),
      },
    });
    expect(text).not.toContain('VM-CCS');
    expect(text).toContain('500.00');
    expect(arabicLetters(text)).toBeGreaterThan(300);
  });

  it('prints an annex with its amendment', async () => {
    const { text } = await render({ kind: 'annex', id, hash: 'c'.repeat(64), snapshot: annex });
    expect(text).toContain('VM-CCS-2026-007');
    expect(text).toContain('50.00');
    expect(arabicLetters(text)).toBeGreaterThan(200);
  });

  it('is safe to run twice: the second run reuses the file', async () => {
    const payload: UnqueuedPdfJob<ContractPdfJob> = {
      kind: 'contract',
      id,
      hash: 'd'.repeat(64),
      snapshot: contract,
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
      job.render({ kind: 'statement', id, hash: 'e'.repeat(64), snapshot: contract }),
    ).rejects.toThrow();
  });

  it('lays out the contract and the annex in print media (the RTL screenshots)', async () => {
    const assets = await loadAssets();
    await screenshot(contractHtml(contract, assets), 'contract-pdf-page');
    await screenshot(annexHtml(annex, assets), 'contract-annex-pdf-page');
  });

  it("prints the client's logo beside the client's name, and the name alone without (F01C)", async () => {
    const assets = await loadAssets();
    const withLogo = { ...assets, clientLogo: LOGO };
    expectLogo(contractHtml(contract, withLogo));
    expectLogo(annexHtml(annex, withLogo));
    expectNoLogo(contractHtml(contract, assets));
    expectNoLogo(annexHtml(annex, assets));
  });

  it('renders without a logo file that is gone, and logs it (F01C)', async () => {
    await expectMissingLogoLogged((clientLogoKey) =>
      job.render({ kind: 'annex', id, hash: '9'.repeat(64), snapshot: annex, clientLogoKey }),
    );
  });
});
