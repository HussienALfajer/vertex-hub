import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  addMonths,
  approvalRequestDetailSchema,
  businessDate,
  type ClientMonthlyReport,
  clientMonthlyReportSchema,
  emailHistorySchema,
  emailSummarySchema,
  monthPeriod,
  quotePdfRenderSchema,
  REPORTS_PDF_JOB,
  type ReportPdfJob,
  reportMonths,
  reportPdfJobSchema,
  reportPdfStorageKey,
} from '@vertex-hub/contracts';
import {
  adCampaigns,
  adCampaignUpdates,
  adWalletEntries,
  approvalItems,
  approvalRequests,
  auditEntries,
  clientReportNotes,
  clientReportPdfs,
  contentPosts,
  createDatabase,
  emailMessages,
  projectMilestones,
  projects,
  retainerCycleLines,
  retainerCycles,
  shoots,
  tasks,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JobQueue } from '../src/core/jobs/index.js';
import { FilePurges } from '../src/modules/files/index.js';
import { ClientReportService } from '../src/modules/reports/client-report.service.js';
import { seedApprovalCast } from './approval-cast.js';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

/** Every endpoint answers well within this on seeded data (edge case 14). */
const TIME_BUDGET_MS = 2000;

describe('monthly client report (F15 rules 17–20)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedApprovalCast>>;
  let finance: { id: string; cookie: string };
  let filesRoot: string;
  let service: ClientReportService;
  const queued: ReportPdfJob[] = [];
  const today = businessDate();
  /** Last month, whole: the report under test. */
  const month = reportMonths(today).lastMonth.from.slice(0, 7);
  const period = monthPeriod(month);
  const thisMonth = today.slice(0, 7);
  const nextMonth = addMonths(`${thisMonth}-01`, 1).slice(0, 7);
  const at = (date: string, time = '10:00:00') => new Date(`${date}T${time}Z`);
  let clientId: string;
  let report: ClientMonthlyReport;

  const path = (id = clientId) => `/api/clients/${id}/monthly-report`;

  async function reportOf(cookie: string, wanted = month, id = clientId) {
    const started = performance.now();
    const response = await client.get(`${path(id)}?month=${wanted}`, cookie);
    expect(performance.now() - started).toBeLessThan(TIME_BUDGET_MS);
    if (response.status !== 200) throw new Error(`${response.status} ${await response.text()}`);
    return clientMonthlyReportSchema.parse(await response.json());
  }

  const saveSummary = (cookie: string, summary: string, wanted = month, id = clientId) =>
    client.request('PUT', `${path(id)}/summary`, { cookie, body: { month: wanted, summary } });

  /** What the worker does for a queued render: writes the bytes, then reports them. */
  async function work(job: ReportPdfJob) {
    const bytes = Buffer.from(`%PDF-1.7 ${job.hash}`);
    const storageKey = reportPdfStorageKey(job);
    const file = join(filesRoot, storageKey);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await service.ready({
      kind: job.kind,
      id: job.id,
      hash: job.hash,
      file: {
        storageKey,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    });
    return file;
  }

  /** A client's approval item answered through the link, closed at `closedAt`. */
  async function answered(
    decision: 'approved' | 'changes_requested',
    closedAt: Date,
    hours: number,
  ) {
    const task = await cast.readyTask(clientId);
    const issued = await cast.requestOk(clientId, [task.id]);
    const detail = approvalRequestDetailSchema.parse(
      await (await client.get(`/api/approvals/requests/${issued.id}`, cast.am.cookie)).json(),
    );
    const item = detail.items[0];
    const response = await client.request(
      'POST',
      `/api/public/approvals/${cast.tokenOf(issued)}/items/${item?.id}/response`,
      { body: decision === 'approved' ? { decision } : { decision, note: 'غيّروا اللون' } },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    await db
      .update(approvalItems)
      .set({ closedAt, title: `للعميل ${task.title}` })
      .where(eq(approvalItems.id, item?.id ?? ''));
    await db
      .update(approvalRequests)
      .set({ createdAt: new Date(closedAt.getTime() - hours * 3_600_000) })
      .where(eq(approvalRequests.id, issued.id));
    return task;
  }

  beforeAll(async () => {
    filesRoot = await mkdtemp(join(tmpdir(), 'vertex-client-report-'));
    process.env.FILES_ROOT = filesRoot;
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    service = app.get(ClientReportService);
    vi.spyOn(app.get(JobQueue), 'send').mockImplementation(async (queue, data, options) => {
      if (queue !== REPORTS_PDF_JOB.queue) return;
      expect(options).toEqual({ retryLimit: REPORTS_PDF_JOB.retryLimit });
      queued.push(reportPdfJobSchema.parse(data));
    });
    cast = await seedApprovalCast(db, client);
    finance = await client.signInWithTwoFactor(db, { roles: ['finance'] });
    cast.trackUser(finance.id);
    clientId = (await cast.createClient()).id;

    // Section 2: last month's cycle, closed with frozen counts.
    const retainer = await cast.createRetainer(clientId);
    const cycleId = retainer.currentCycle?.id ?? '';
    await db
      .update(retainerCycles)
      .set({
        month: period.from,
        periodStart: period.from,
        periodEnd: period.to,
        status: 'closed',
        closedAt: at(period.to, '21:00:00'),
      })
      .where(eq(retainerCycles.id, cycleId));
    const lines = await db
      .select()
      .from(retainerCycleLines)
      .where(eq(retainerCycleLines.cycleId, cycleId));
    for (const line of lines) {
      await db
        .update(retainerCycleLines)
        .set({ deliveredAtClose: 1 })
        .where(eq(retainerCycleLines.id, line.id));
    }

    // Section 3: a project open during the month with a milestone done in it.
    const project = await cast.createProject(clientId);
    await db.update(projects).set({ startDate: period.from }).where(eq(projects.id, project.id));
    await db.insert(projectMilestones).values({
      projectId: project.id,
      name: 'التسليم الأول',
      position: 1,
      status: 'done',
      doneAt: at(period.from),
      doneById: cast.gm.id,
    });

    // Sections 4 and 7: two items answered in the month (10 and 30 hours), one task delivered.
    const approvedTask = await answered('approved', at(addDays(period.from, 2)), 10);
    await answered('changes_requested', at(addDays(period.from, 3)), 30);
    await cast.moveOk(approvedTask.id, cast.designer.cookie, { status: 'delivered' });
    await db
      .update(tasks)
      .set({ deliveredAt: at(addDays(period.from, 4)) })
      .where(eq(tasks.id, approvedTask.id));

    // Sections 5 and 10: a published post, one planned next month and a cancelled one.
    await db.insert(contentPosts).values([
      {
        clientId,
        title: 'منشور منشور',
        type: 'post',
        platforms: ['instagram'],
        publishDate: addDays(period.from, 5),
        status: 'published',
        needsClientApproval: false,
        responsibleId: cast.writer.id,
        publishedAt: at(addDays(period.from, 5)),
        publishedById: cast.writer.id,
        publishedLinks: [{ platform: 'instagram', url: 'https://instagram.com/p/report' }],
        createdById: cast.writer.id,
      },
      {
        clientId,
        title: 'منشور قادم',
        type: 'reel',
        platforms: ['tiktok'],
        publishDate: `${thisMonth}-15`,
        responsibleId: cast.writer.id,
        createdById: cast.writer.id,
      },
      {
        clientId,
        title: 'منشور ملغى',
        type: 'post',
        platforms: ['tiktok'],
        publishDate: `${thisMonth}-16`,
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: 'أُلغي',
        responsibleId: cast.writer.id,
        createdById: cast.writer.id,
      },
    ]);

    // Sections 6 and 10: a shoot completed in the month, one booked next month.
    const shootTask = await cast.createTask(cast.gm.cookie, {
      department: 'photography',
      clientId,
      needsClientApproval: false,
    });
    const nextTask = await cast.createTask(cast.gm.cookie, {
      department: 'photography',
      clientId,
      needsClientApproval: false,
    });
    await db.insert(shoots).values([
      {
        title: 'تصوير المنتجات',
        type: 'product',
        clientId,
        taskId: shootTask.id,
        startsAt: at(addDays(period.from, 6), '07:00:00'),
        endsAt: at(addDays(period.from, 6), '10:00:00'),
        location: 'الاستوديو',
        status: 'completed',
        completedAt: at(addDays(period.from, 6), '11:00:00'),
        completedById: cast.gm.id,
        createdById: cast.gm.id,
      },
      {
        title: 'تصوير قادم',
        type: 'product',
        clientId,
        taskId: nextTask.id,
        startsAt: at(`${thisMonth}-20`, '07:00:00'),
        endsAt: at(`${thisMonth}-20`, '09:00:00'),
        location: 'المكتب',
        createdById: cast.gm.id,
      },
    ]);

    // Sections 8 and 9: a wallet campaign with spend in the month, and the wallet's entries.
    const [campaign] = await db
      .insert(adCampaigns)
      .values({
        clientId,
        name: 'حملة الشهر',
        platform: 'meta',
        objective: 'messages',
        budgetMinor: 100_000,
        startsOn: period.from,
        ownerId: cast.gm.id,
        status: 'active',
        createdById: cast.gm.id,
      })
      .returning();
    await db.insert(adCampaignUpdates).values([
      {
        campaignId: campaign?.id ?? '',
        periodStart: period.from,
        periodEnd: addDays(period.from, 9),
        spendMinor: 10_000,
        reach: 5000,
        clicks: 300,
        results: 40,
        enteredById: cast.gm.id,
      },
      {
        campaignId: campaign?.id ?? '',
        periodStart: addDays(period.from, 10),
        periodEnd: addDays(period.from, 12),
        spendMinor: 99_000,
        reach: 1,
        clicks: 1,
        results: 1,
        enteredById: cast.gm.id,
        archivedAt: new Date(),
      },
    ]);
    const entry = (fields: Partial<typeof adWalletEntries.$inferInsert>) => ({
      clientId,
      kind: 'deposit' as const,
      year: 2001,
      number: Math.floor(Math.random() * 1_000_000),
      amountMinor: 1,
      currency: 'USD' as const,
      sypPerUsd: '13000',
      usdMinor: 1,
      method: 'cash' as const,
      recordedById: finance.id,
      occurredOn: period.from,
      ...fields,
    });
    await db.insert(adWalletEntries).values([
      entry({ occurredOn: addDays(period.from, -3), amountMinor: 20_000, usdMinor: 20_000 }),
      entry({ amountMinor: 50_000, usdMinor: 50_000 }),
      entry({
        kind: 'refund',
        year: null,
        number: null,
        amountMinor: 5000,
        usdMinor: 5000,
      }),
      entry({
        amountMinor: 7000,
        usdMinor: 7000,
        voidedAt: new Date(),
        voidReason: 'خطأ',
        voidedById: finance.id,
      }),
    ]);

    report = await reportOf(cast.am.cookie);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await cast?.cleanup();
    await connection.close();
    delete process.env.FILES_ROOT;
    if (filesRoot) await rm(filesRoot, { recursive: true, force: true });
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await client.get(`${path(id)}?month=${month}`)).status).toBe(401);
    expect((await client.get(`${path(id)}/export?month=${month}`)).status).toBe(401);
    expect((await saveSummary('', 'x', month, id)).status).toBe(401);
    expect((await client.post(`${path(id)}/pdf?month=${month}`, undefined, {})).status).toBe(401);
    expect((await client.get(`${path(id)}/pdf?month=${month}`)).status).toBe(401);
  });

  it("opens to readers of the client's reports only (rule 23)", async () => {
    for (const cookie of [cast.gm.cookie, cast.operations.cookie, cast.am.cookie]) {
      expect((await client.get(`${path()}?month=${month}`, cookie)).status).toBe(200);
    }
    // Without `reports.read`.
    for (const cookie of [finance.cookie, cast.employee.cookie]) {
      expect((await client.get(`${path()}?month=${month}`, cookie)).status).toBe(403);
    }
    // `reports.read` that does not cover the client: another manager, a department scope.
    for (const cookie of [cast.otherAm.cookie, cast.designManager.cookie]) {
      expect((await client.get(`${path()}?month=${month}`, cookie)).status).toBe(404);
      expect((await saveSummary(cookie, 'نص')).status).toBe(404);
      expect((await client.post(`${path()}/pdf?month=${month}`, cookie, {})).status).toBe(404);
    }
    expect((await client.get(`${path(randomUUID())}?month=${month}`, cast.gm.cookie)).status).toBe(
      404,
    );
  });

  it('refuses months after the current one and marks the current one preliminary (rule 17)', async () => {
    await expectError(
      await client.get(`${path()}?month=${nextMonth}`, cast.am.cookie),
      400,
      'INVALID_MONTH',
    );
    await expectError(await saveSummary(cast.am.cookie, 'نص', nextMonth), 400, 'INVALID_MONTH');
    expect(report.preliminary).toBe(false);
    expect((await reportOf(cast.am.cookie, thisMonth)).preliminary).toBe(true);
  });

  it('shows the sections of the month (rule 18)', () => {
    expect(report.period).toEqual(period);
    expect(report.empty).toBe(false);
    expect(report.retainers).toHaveLength(1);
    expect(report.retainers[0]).toMatchObject({ status: 'closed' });
    expect(report.retainers[0]?.lines.every((line) => line.delivered === 1)).toBe(true);
    expect(report.projects).toHaveLength(1);
    expect(report.projects[0]?.milestonesDone).toEqual([
      { name: 'التسليم الأول', doneOn: period.from },
    ]);
    expect(report.deliveredWork).toHaveLength(1);
    expect(report.deliveredWork[0]?.title.startsWith('للعميل ')).toBe(true);
    expect(report.deliveredWork[0]?.deliveredOn).toBe(addDays(period.from, 4));
    expect(report.posts).toEqual([
      expect.objectContaining({
        title: 'منشور منشور',
        publishedOn: addDays(period.from, 5),
        links: [{ platform: 'instagram', url: 'https://instagram.com/p/report' }],
      }),
    ]);
    expect(report.shoots).toEqual([
      expect.objectContaining({ title: 'تصوير المنتجات', date: addDays(period.from, 6) }),
    ]);
    expect(report.approvals).toEqual({
      approved: 1,
      changesRequested: 1,
      averageResponseHours: 20,
    });
    expect(report.campaigns?.rows).toEqual([
      expect.objectContaining({ name: 'حملة الشهر', spendMinor: 10_000, results: 40 }),
    ]);
    expect(report.campaigns?.totals).toMatchObject({ spendMinor: 10_000, costPerResultMinor: 250 });
    expect(report.adBudget).toEqual({
      openingMinor: 20_000,
      depositsMinor: 50_000,
      refundsMinor: 5000,
      spendMinor: 10_000,
      closingMinor: 55_000,
    });
  });

  it('lists next month: planned posts that are not cancelled and booked shoots', async () => {
    // Last month's "next month" is this month.
    expect(report.nextMonth).toEqual({
      posts: [{ date: `${thisMonth}-15`, title: 'منشور قادم' }],
      shoots: [{ date: `${thisMonth}-20`, title: 'تصوير قادم' }],
    });
  });

  it('says there was no activity in an empty month (edge cases 12 and 15)', async () => {
    const empty = await reportOf(cast.am.cookie, '2001-01');
    expect(empty).toMatchObject({
      empty: true,
      summary: null,
      retainers: [],
      posts: [],
      campaigns: { rows: [] },
      adBudget: null,
      approvals: { approved: 0, changesRequested: 0, averageResponseHours: null },
    });
  });

  it('saves, replaces and clears the summary, each change audited (rule 19)', async () => {
    const saved = await saveSummary(cast.am.cookie, '  شهر جيد  ');
    expect(saved.status).toBe(200);
    expect(clientMonthlyReportSchema.parse(await saved.json()).summary).toMatchObject({
      text: 'شهر جيد',
      updatedBy: { id: cast.am.id },
    });
    expect((await saveSummary(cast.gm.cookie, 'شهر ممتاز')).status).toBe(200);
    expect((await reportOf(cast.operations.cookie)).summary?.text).toBe('شهر ممتاز');
    expect((await saveSummary(cast.am.cookie, '')).status).toBe(200);
    expect((await reportOf(cast.am.cookie)).summary).toBeNull();
    const [row] = await db
      .select()
      .from(clientReportNotes)
      .where(
        and(eq(clientReportNotes.clientId, clientId), eq(clientReportNotes.month, period.from)),
      );
    expect(row?.summary).toBe('');
    const entries = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.entityId, clientId),
          eq(auditEntries.action, 'client_report.summary_changed'),
        ),
      )
      .orderBy(auditEntries.occurredAt);
    expect(entries.map((entry) => [entry.before, entry.after])).toEqual([
      [
        { month, summary: '' },
        { month, summary: 'شهر جيد' },
      ],
      [
        { month, summary: 'شهر جيد' },
        { month, summary: 'شهر ممتاز' },
      ],
      [
        { month, summary: 'شهر ممتاز' },
        { month, summary: '' },
      ],
    ]);
    // Saving the same text again changes nothing.
    expect((await saveSummary(cast.am.cookie, '')).status).toBe(200);
    expect(
      await db
        .select()
        .from(auditEntries)
        .where(
          and(
            eq(auditEntries.entityId, clientId),
            eq(auditEntries.action, 'client_report.summary_changed'),
          ),
        ),
    ).toHaveLength(3);
  });

  it('exports the report to Excel, a sheet per section (rule 24)', async () => {
    const response = await client.get(`${path()}/export?month=${month}`, cast.am.cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain(`-${month}.xlsx`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'ملخص الشهر',
      'العقود الشهرية',
      'المشاريع',
      'الأعمال المسلّمة',
      'المنشورات المنشورة',
      'جلسات التصوير',
      'الموافقات',
      'الحملات الإعلانية',
      'الميزانية الإعلانية (دولار)',
      'الشهر القادم',
    ]);
    expect(workbook.worksheets.every((sheet) => sheet.views[0]?.rightToLeft)).toBe(true);
    const budget = workbook.getWorksheet('الميزانية الإعلانية (دولار)');
    expect(budget?.getRow(6).getCell(2).value).toBe(550);
  });

  describe('the PDF (rule 20)', () => {
    let file: string;

    it('is queued once per payload and served for 24 hours', async () => {
      const ask = () => client.post(`${path()}/pdf?month=${month}`, cast.am.cookie, {});
      const first = await ask();
      expect(first.status).toBe(200);
      expect(quotePdfRenderSchema.parse(await first.json())).toEqual({ state: 'pending' });
      expect(queued).toHaveLength(1);
      const job = queued[0] as ReportPdfJob;
      expect(job.snapshot).toMatchObject({ client: { id: clientId }, month });
      expect((await client.get(`${path()}/pdf?month=${month}`, cast.am.cookie)).status).toBe(404);
      file = await work(job);
      const served = await client.get(`${path()}/pdf?month=${month}`, cast.gm.cookie);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toBe('application/pdf');
      expect(quotePdfRenderSchema.parse(await (await ask()).json())).toEqual({ state: 'ready' });
      expect(queued).toHaveLength(1);
      // A new summary changes the payload: rendered anew.
      expect((await saveSummary(cast.am.cookie, 'ملخص للـ PDF')).status).toBe(200);
      expect((await client.get(`${path()}/pdf?month=${month}`, cast.am.cookie)).status).toBe(404);
      expect(quotePdfRenderSchema.parse(await (await ask()).json())).toEqual({ state: 'pending' });
      expect(queued).toHaveLength(2);
    });

    it('drops a result nobody waits for and records a failure', async () => {
      const job = queued[1] as ReportPdfJob;
      await service.ready({ kind: job.kind, id: job.id, hash: 'f'.repeat(64), file: null });
      const [row] = await db.select().from(clientReportPdfs).where(eq(clientReportPdfs.id, job.id));
      expect(row?.status).toBe('pending');
      await service.ready({ kind: job.kind, id: job.id, hash: job.hash, file: null });
      const [failed] = await db
        .select()
        .from(clientReportPdfs)
        .where(eq(clientReportPdfs.id, job.id));
      expect(failed?.status).toBe('failed');
    });

    it('is emailed with a copy that outlives the render (F14 email rule 21)', async () => {
      const contact = await cast.createContact(clientId);
      const email = (cookie: string) =>
        client.post(`${path()}/email`, cookie, {
          month,
          contactIds: [contact.id],
          subject: 'التقرير الشهري',
          message: 'مرحبًا،\n\nتجدون التقرير في المرفق.',
        });
      expect((await email('')).status).toBe(401);
      expect((await email(finance.cookie)).status).toBe(403);
      expect((await email(cast.otherAm.cookie)).status).toBe(404);
      await expectError(await email(cast.am.cookie), 409, 'PDF_NOT_READY');
      const asked = await client.post(`${path()}/pdf?month=${month}`, cast.am.cookie, {});
      expect(quotePdfRenderSchema.parse(await asked.json())).toEqual({ state: 'pending' });
      await work(queued.at(-1) as ReportPdfJob);
      const response = await email(cast.am.cookie);
      expect(response.status, await response.clone().text()).toBe(202);
      const summary = emailSummarySchema.parse(await response.json());
      expect(summary.kind).toBe('client_report');
      const [row] = await db.select().from(emailMessages).where(eq(emailMessages.id, summary.id));
      expect(row).toMatchObject({ recordType: 'client', recordId: clientId, data: { month } });
      const [attachment] = (row?.attachments ?? []) as { storageKey: string }[];
      expect(attachment?.storageKey).toBe(`objects/emails/${summary.id}`);
      await stat(join(filesRoot, attachment?.storageKey ?? ''));
      const history = async (wanted: string) =>
        emailHistorySchema.parse(
          await (await client.get(`${path()}/emails?month=${wanted}`, cast.gm.cookie)).json(),
        ).items;
      expect((await history(month)).map((item) => item.id)).toEqual([summary.id]);
      expect(await history(thisMonth)).toEqual([]);
      expect(
        (await client.get(`${path()}/emails?month=${month}`, cast.otherAm.cookie)).status,
      ).toBe(404);
      expect((await client.get(`${path()}/emails?month=${month}`)).status).toBe(401);
      expect((await client.get(`${path()}/emails?month=${month}`, finance.cookie)).status).toBe(
        403,
      );
    });

    it('is purged with its object after 24 hours', async () => {
      await db
        .update(clientReportPdfs)
        .set({ requestedAt: new Date(Date.now() - 25 * 3600 * 1000) })
        .where(eq(clientReportPdfs.clientId, clientId));
      const purged = await app.get(FilePurges).run();
      expect(purged.get('client report PDFs')).toBeGreaterThanOrEqual(2);
      expect(
        await db.select().from(clientReportPdfs).where(eq(clientReportPdfs.clientId, clientId)),
      ).toHaveLength(0);
      await expect(stat(file)).rejects.toThrow();
    });
  });
});
