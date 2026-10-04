import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ClientReportSnapshot,
  type ReportPdfJob,
  reportPdfStorageKey,
} from '@vertex-hub/contracts';
import { chromium } from 'playwright';
import { extractText, getDocumentProxy } from 'unpdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnv } from '../src/core/config/env.js';
import type { PgBossService } from '../src/jobs/pg-boss.service.js';
import { ReportsPdfJob } from '../src/jobs/reports-pdf.job.js';
import { loadAssets, PdfRenderer } from '../src/pdf/pdf-renderer.js';
import { clientReportHtml } from '../src/pdf/report-templates.js';

const id = '0190a3c2-0000-7000-8000-0000000000cd';
const uuid = (n: number) => `0190a3c2-0000-7000-8000-${String(n).padStart(12, '0')}`;

const report: ClientReportSnapshot = {
  companyDetails: 'فيرتكس ميديا\nدمشق - المزة',
  client: { id: uuid(1), name: 'مطعم الياسمين' },
  month: '2026-09',
  period: { from: '2026-09-01', to: '2026-09-30' },
  preliminary: false,
  summary: {
    text: 'شهر جيد: ارتفع التفاعل على المنشورات.',
    updatedBy: { id: uuid(2), name: 'سارة' },
    updatedAt: '2026-10-01T09:00:00.000Z',
  },
  retainers: [
    {
      retainer: { id: uuid(3), name: 'باقة السوشيال' },
      status: 'closed',
      lines: [
        { kind: 'post', label: null, committed: 12, delivered: 10, percent: 83 },
        { kind: 'reel', label: null, committed: 4, delivered: 4, percent: 100 },
      ],
      completion: 87,
    },
  ],
  projects: [
    {
      project: { id: uuid(4), name: 'هوية بصرية' },
      status: 'active',
      deliveredTasks: 3,
      totalTasks: 7,
      milestonesDone: [{ name: 'الشعار', doneOn: '2026-09-15' }],
    },
  ],
  deliveredWork: [
    {
      taskId: uuid(5),
      title: 'تصميم منشور العرض',
      department: 'design',
      departmentName: 'التصميم',
      deliveredOn: '2026-09-10',
    },
  ],
  posts: [
    {
      id: uuid(6),
      publishedOn: '2026-09-12',
      platforms: ['instagram', 'facebook'],
      title: 'عرض الخريف',
      links: [{ platform: 'instagram', url: 'https://instagram.com/p/autumn-offer' }],
    },
  ],
  shoots: [{ id: uuid(7), date: '2026-09-20', title: 'تصوير الأطباق', location: 'المزة' }],
  approvals: { approved: 5, changesRequested: 1, averageResponseHours: 30.5 },
  campaigns: {
    rows: [
      {
        id: uuid(8),
        platform: 'meta',
        name: 'حملة الخريف',
        objective: 'engagement',
        spendMinor: 25_000,
        reach: 41_000,
        clicks: 900,
        results: 120,
        costPerResultMinor: 208,
      },
    ],
    totals: {
      spendMinor: 25_000,
      reach: 41_000,
      clicks: 900,
      results: 120,
      costPerResultMinor: 208,
    },
  },
  adBudget: {
    openingMinor: 10_000,
    depositsMinor: 50_000,
    refundsMinor: 0,
    spendMinor: 25_000,
    closingMinor: 35_000,
  },
  nextMonth: {
    posts: [{ date: '2026-10-03', title: 'منشور الافتتاح' }],
    shoots: [{ date: '2026-10-08', title: 'تصوير القائمة الجديدة' }],
  },
  empty: false,
};

/** The extracted text: Arabic comes back in visual order with split words, so only counted. */
async function pdfText(path: string): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.normalize('NFKC');
}

const arabicLetters = (text: string) => text.match(/[؀-ۿ]/g)?.length ?? 0;

describe('reports.pdf', () => {
  let root: string;
  let job: ReportsPdfJob;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'vertex-report-pdf-'));
    const env = parseEnv({ ...process.env, FILES_ROOT: root });
    job = new ReportsPdfJob({} as PgBossService, new PdfRenderer(), env);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function render(payload: ReportPdfJob): Promise<string> {
    const result = await job.render(payload);
    expect(result).toMatchObject({ kind: payload.kind, id: payload.id, hash: payload.hash });
    expect(result.file?.storageKey).toBe(reportPdfStorageKey(payload));
    const path = join(root, result.file?.storageKey ?? '');
    expect((await stat(path)).size).toBe(result.file?.sizeBytes);
    return pdfText(path);
  }

  it('renders every section in Arabic with its numbers', async () => {
    const text = await render({
      kind: 'client_report',
      id,
      hash: 'a'.repeat(64),
      snapshot: report,
    });
    expect(text).toContain('2026-09-10');
    expect(text).toContain('2026-09-12');
    expect(text).toContain('87%');
    expect(text).toContain('250.00');
    expect(text).toContain('41');
    expect(text).toContain('350.00');
    expect(text).toContain('https://instagram.com/p/autumn-offer');
    expect(text).toContain('2026-10-08');
    expect(arabicLetters(text)).toBeGreaterThan(300);
  });

  it('renders a month without activity', async () => {
    const text = await render({
      kind: 'client_report',
      id,
      hash: 'b'.repeat(64),
      snapshot: {
        ...report,
        preliminary: true,
        summary: null,
        retainers: [],
        projects: [],
        deliveredWork: [],
        posts: [],
        shoots: [],
        approvals: { approved: 0, changesRequested: 0, averageResponseHours: null },
        campaigns: null,
        adBudget: null,
        nextMonth: { posts: [], shoots: [] },
        empty: true,
      },
    });
    expect(text).not.toContain('2026-09-10');
    expect(arabicLetters(text)).toBeGreaterThan(20);
  });

  it('is safe to run twice: the second run reuses the file', async () => {
    const payload: ReportPdfJob = {
      kind: 'client_report',
      id,
      hash: 'c'.repeat(64),
      snapshot: report,
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
      job.render({ kind: 'statement', id, hash: 'd'.repeat(64), snapshot: report }),
    ).rejects.toThrow();
  });

  it('lays out the report in print media (the RTL screenshot)', async () => {
    const html = clientReportHtml(report, await loadAssets());
    const browser = await chromium.launch();
    try {
      // An A4 page at 96 dpi; headless Chromium has no PDF viewer, so the print layout is shot.
      const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
      await page.emulateMedia({ media: 'print' });
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate('document.fonts.ready.then(() => true)');
      const path = join(
        dirname(fileURLToPath(import.meta.url)),
        '../test-results/client-report-pdf-page.png',
      );
      await page.screenshot({ path, fullPage: true });
      expect((await stat(path)).size).toBeGreaterThan(10_000);
    } finally {
      await browser.close();
    }
  });
});
