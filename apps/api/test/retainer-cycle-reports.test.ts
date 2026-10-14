import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  addMonths,
  businessDate,
  clientMonthlyReportSchema,
  cyclePeriod,
  cycleReportJobSchema,
  cycleReportSchema,
  quotePdfRenderSchema,
  REPORTS_CYCLE_REPORT_JOB,
  REPORTS_PDF_JOB,
  type ReportPdfJob,
  reportPdfJobSchema,
  reportPdfStorageKey,
  retainerDetailSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  createDatabase,
  notifications,
  retainerCycleReports,
  retainerCycles,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, asc, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JobQueue } from '../src/core/jobs/index.js';
import { RetainerCyclesService } from '../src/modules/projects/index.js';
import { CycleReportService } from '../src/modules/reports/cycle-report.service.js';
import { seedClientCast } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

describe('retainer cycle reports (F05C R1–R3)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { id: string; cookie: string };
  let filesRoot: string;
  let service: CycleReportService;
  let job: RetainerCyclesService;
  const rendered: ReportPdfJob[] = [];
  const nudged: { retainerId: string; cycleId: string }[] = [];
  const today = businessDate();
  /** F05C Y1: the second cycle of a retainer started today. */
  const nextCycle = addMonths(today, 1);

  const path = (retainerId: string, cycleId: string) =>
    `/api/retainers/${retainerId}/cycles/${cycleId}/report`;

  async function reportOf(cookie: string, retainerId: string, cycleId: string) {
    const response = await client.get(path(retainerId, cycleId), cookie);
    if (response.status !== 200) throw new Error(`${response.status} ${await response.text()}`);
    return cycleReportSchema.parse(await response.json());
  }

  const requestPdf = async (cookie: string, retainerId: string, cycleId: string) => {
    const response = await client.post(`${path(retainerId, cycleId)}/pdf`, cookie);
    expect(response.status).toBe(200);
    return quotePdfRenderSchema.parse(await response.json()).state;
  };

  /** What the worker does for a queued render: writes the bytes, then reports them. */
  async function work(render: ReportPdfJob) {
    const bytes = Buffer.from(`%PDF-1.7 ${render.hash}`);
    const storageKey = reportPdfStorageKey(render);
    const file = join(filesRoot, storageKey);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await service.ready({
      kind: render.kind,
      id: render.id,
      hash: render.hash,
      file: {
        storageKey,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    });
    return bytes;
  }

  const notificationsOf = (cycleId: string) =>
    db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.type, 'retainer_cycle_report_ready'),
          eq(notifications.recipientId, cast.am.id),
        ),
      )
      .then((rows) => rows.filter((row) => (row.data as { cycleId?: string }).cycleId === cycleId));

  /** A retainer started today, its first cycle with 3 designs delivered, closed by the job. */
  async function closedCycle() {
    const { id: clientId } = await cast.createClient();
    const retainer = await cast.createRetainer(clientId);
    const cycle = retainer.currentCycle;
    const design = cycle?.lines.find((line) => line.kind === 'design');
    if (!cycle || !design) throw new Error('The retainer has no open cycle');
    const adjusted = await client.post(
      `/api/retainers/${retainer.id}/cycles/${cycle.id}/lines/${design.id}/adjustments`,
      cast.am.cookie,
      { delta: 3, reason: 'Delivered outside the task board' },
    );
    expect(adjusted.status).toBe(201);
    await job.runDaily(nextCycle);
    return { clientId, retainer, cycleId: cycle.id };
  }

  beforeAll(async () => {
    filesRoot = await mkdtemp(join(tmpdir(), 'vertex-cycle-report-'));
    process.env.FILES_ROOT = filesRoot;
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    service = app.get(CycleReportService);
    job = app.get(RetainerCyclesService);
    const jobs = app.get(JobQueue);
    vi.spyOn(jobs, 'send').mockImplementation(async (queue, data, options) => {
      if (queue !== REPORTS_PDF_JOB.queue) return;
      expect(options).toEqual({ retryLimit: REPORTS_PDF_JOB.retryLimit });
      rendered.push(reportPdfJobSchema.parse(data));
    });
    vi.spyOn(jobs, 'sendInTransaction').mockImplementation(async (_tx, queue, data) => {
      if (queue === REPORTS_CYCLE_REPORT_JOB.queue) nudged.push(cycleReportJobSchema.parse(data));
    });
    cast = await seedClientCast(db, client);
    finance = await client.signInWithTwoFactor(db, { roles: ['finance'] });
    cast.trackUser(finance.id);
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
    if (filesRoot) await rm(filesRoot, { recursive: true, force: true });
  });

  it('requires a session', async () => {
    const [id, cycleId] = [randomUUID(), randomUUID()];
    expect((await client.get(path(id, cycleId))).status).toBe(401);
    expect((await client.get(`${path(id, cycleId)}/export`)).status).toBe(401);
    expect(
      (await client.request('PUT', `${path(id, cycleId)}/summary`, { body: { summary: 'x' } }))
        .status,
    ).toBe(401);
    expect((await client.post(`${path(id, cycleId)}/pdf`)).status).toBe(401);
    expect((await client.get(`${path(id, cycleId)}/pdf`)).status).toBe(401);
  });

  describe('a closed cycle (R1)', () => {
    let retainerId: string;
    let cycleId: string;

    beforeAll(async () => {
      ({ cycleId } = await closedCycle().then((closed) => {
        retainerId = closed.retainer.id;
        return closed;
      }));
    });

    it('records the report, tells the account manager once and queues its render', async () => {
      const [row] = await db
        .select()
        .from(retainerCycleReports)
        .where(eq(retainerCycleReports.cycleId, cycleId));
      expect(row).toMatchObject({ summary: '', pdfStatus: 'pending', hash: null });
      expect(nudged).toContainEqual({ retainerId, cycleId });

      const [notice, ...more] = await notificationsOf(cycleId);
      expect(more).toEqual([]);
      const period = cyclePeriod(today, 1);
      expect(notice).toMatchObject({ subjectType: 'retainer', subjectId: retainerId });
      expect(notice?.data).toMatchObject({
        cycle: 1,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        // 3 of 12 designs and 0 of 4 reels.
        deliveryRate: 18,
      });

      // The job again (J2): the cycle is closed, nothing more is sent.
      await job.runDaily(nextCycle);
      expect(await notificationsOf(cycleId)).toHaveLength(1);
    });

    it('renders the closed report once, then serves it while it is current', async () => {
      const before = rendered.length;
      await service.prepare(retainerId, cycleId);
      const [render] = rendered.slice(before);
      expect(render).toMatchObject({ kind: 'cycle_report', id: cycleId });
      // The account manager's view: campaign sections included (null without data).
      expect(render?.snapshot).toMatchObject({ cycle: { number: 1 }, preliminary: false });
      const bytes = await work(render as ReportPdfJob);

      // Prepared again: the stored PDF is that report.
      await service.prepare(retainerId, cycleId);
      expect(rendered).toHaveLength(before + 1);
      expect(await requestPdf(cast.am.cookie, retainerId, cycleId)).toBe('ready');
      const download = await client.get(`${path(retainerId, cycleId)}/pdf`, cast.am.cookie);
      expect(download.status).toBe(200);
      expect(download.headers.get('content-type')).toContain('application/pdf');
      expect(download.headers.get('content-disposition')).toContain('cycle%201.pdf');
      expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
    });

    it('shows the cycle with its frozen counts and the next period (R2)', async () => {
      const report = await reportOf(cast.am.cookie, retainerId, cycleId);
      const period = cyclePeriod(today, 1);
      const next = cyclePeriod(today, 2);
      expect(report).toMatchObject({
        retainer: { id: retainerId },
        cycle: { id: cycleId, number: 1, status: 'closed' },
        period: { from: period.periodStart, to: period.periodEnd },
        preliminary: false,
        summary: null,
        deliveryRate: 18,
        nextPeriod: { period: { from: next.periodStart, to: next.periodEnd } },
      });
      expect(report.lines.map((line) => [line.kind, line.committed, line.delivered])).toEqual([
        ['design', 12, 3],
        ['reel', 4, 0],
      ]);
      expect(report).not.toHaveProperty('projects');
      // Rule 18.8: the General Manager and the account manager read campaigns.
      expect(report.campaigns).toEqual({ rows: [], totals: expect.any(Object) });
    });

    it('lets readers save the summary, audited, and renders the changed report again (R3)', async () => {
      const response = await client.request('PUT', `${path(retainerId, cycleId)}/summary`, {
        cookie: cast.am.cookie,
        body: { summary: '  دورة جيدة  ' },
      });
      expect(response.status).toBe(200);
      const saved = cycleReportSchema.parse(await response.json());
      expect(saved.summary).toMatchObject({ text: 'دورة جيدة', updatedBy: { id: cast.am.id } });
      const audit = await db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.entityId, cycleId))
        .orderBy(asc(auditEntries.occurredAt));
      expect(audit.at(-1)).toMatchObject({
        action: 'retainer_cycle_report.summary_changed',
        entityType: 'retainer_cycle_report',
        actorId: cast.am.id,
        before: { summary: '' },
        after: { summary: 'دورة جيدة', number: 1, retainerId },
      });

      // The stored PDF is no longer the report.
      expect((await client.get(`${path(retainerId, cycleId)}/pdf`, cast.am.cookie)).status).toBe(
        404,
      );
      const before = rendered.length;
      expect(await requestPdf(cast.gm.cookie, retainerId, cycleId)).toBe('pending');
      const [render] = rendered.slice(before);
      expect(render?.snapshot.summary?.text).toBe('دورة جيدة');

      // A render of an older report coming back late is dropped.
      await service.ready({ kind: 'cycle_report', id: cycleId, hash: 'a'.repeat(64), file: null });
      const [row] = await db
        .select()
        .from(retainerCycleReports)
        .where(eq(retainerCycleReports.cycleId, cycleId));
      expect(row).toMatchObject({ pdfStatus: 'pending', hash: render?.hash });

      await work(render as ReportPdfJob);
      expect(await requestPdf(cast.gm.cookie, retainerId, cycleId)).toBe('ready');
      expect((await client.get(`${path(retainerId, cycleId)}/pdf`, cast.gm.cookie)).status).toBe(
        200,
      );

      // Saving the same text changes nothing; an empty text clears it.
      const unchanged = await client.request('PUT', `${path(retainerId, cycleId)}/summary`, {
        cookie: cast.gm.cookie,
        body: { summary: 'دورة جيدة' },
      });
      expect(cycleReportSchema.parse(await unchanged.json()).summary?.updatedBy.id).toBe(
        cast.am.id,
      );
      const cleared = await client.request('PUT', `${path(retainerId, cycleId)}/summary`, {
        cookie: cast.gm.cookie,
        body: { summary: '' },
      });
      expect(cycleReportSchema.parse(await cleared.json()).summary).toBeNull();
      expect(
        (
          await client.request('PUT', `${path(retainerId, cycleId)}/summary`, {
            cookie: cast.gm.cookie,
            body: { summary: 'x'.repeat(4001) },
          })
        ).status,
      ).toBe(400);
    });

    it('exports the report to Excel', async () => {
      const response = await client.get(`${path(retainerId, cycleId)}/export`, cast.am.cookie);
      expect(response.status).toBe(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as never);
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['ملخص الدورة', 'بنود العقد']);
      const lines = workbook.getWorksheet('بنود العقد');
      expect(lines?.getRow(4).values).toEqual([
        undefined,
        'نسبة التسليم',
        undefined,
        undefined,
        18,
      ]);
    });

    it('is read only by readers whose reports scope covers the client', async () => {
      // No `reports.read`: the guard refuses every endpoint.
      const base = path(retainerId, cycleId);
      for (const cookie of [cast.employee.cookie, finance.cookie]) {
        expect((await client.get(base, cookie)).status).toBe(403);
        expect((await client.get(`${base}/export`, cookie)).status).toBe(403);
        expect(
          (await client.request('PUT', `${base}/summary`, { cookie, body: { summary: 'x' } }))
            .status,
        ).toBe(403);
        expect((await client.post(`${base}/pdf`, cookie)).status).toBe(403);
        expect((await client.get(`${base}/pdf`, cookie)).status).toBe(403);
      }
      // Another manager's client, an unknown cycle, a cycle of another retainer: 404.
      for (const [cookie, id, cycle] of [
        [cast.otherAm.cookie, retainerId, cycleId],
        [cast.gm.cookie, retainerId, randomUUID()],
        [cast.gm.cookie, randomUUID(), cycleId],
      ] as const) {
        expect((await client.get(path(id, cycle), cookie)).status).toBe(404);
        expect((await client.get(`${path(id, cycle)}/export`, cookie)).status).toBe(404);
        expect(
          (
            await client.request('PUT', `${path(id, cycle)}/summary`, {
              cookie,
              body: { summary: 'x' },
            })
          ).status,
        ).toBe(404);
        expect((await client.post(`${path(id, cycle)}/pdf`, cookie)).status).toBe(404);
        expect((await client.get(`${path(id, cycle)}/pdf`, cookie)).status).toBe(404);
      }
      // The operations manager reads every client.
      expect((await client.get(path(retainerId, cycleId), cast.operations.cookie)).status).toBe(
        200,
      );
    });
  });

  it('marks the open cycle preliminary, and lets its summary be saved before it closes', async () => {
    const { id: clientId } = await cast.createClient();
    const retainer = await cast.createRetainer(clientId);
    const cycleId = retainer.currentCycle?.id ?? '';
    const open = await reportOf(cast.am.cookie, retainer.id, cycleId);
    expect(open).toMatchObject({ preliminary: true, cycle: { status: 'open' }, empty: true });
    const saved = await client.request('PUT', `${path(retainer.id, cycleId)}/summary`, {
      cookie: cast.am.cookie,
      body: { summary: 'ملاحظات أثناء الدورة' },
    });
    expect(saved.status).toBe(200);

    await job.runDaily(nextCycle);
    const closed = await reportOf(cast.am.cookie, retainer.id, cycleId);
    expect(closed).toMatchObject({ preliminary: false, summary: { text: 'ملاحظات أثناء الدورة' } });
    expect(await notificationsOf(cycleId)).toHaveLength(1);
  });

  it('reports a cycle that closed when the retainer ended, to the end day (Y4, edge cases 5 and 15)', async () => {
    const { id: clientId } = await cast.createClient();
    const retainer = await cast.createRetainer(clientId);
    const cycleId = retainer.currentCycle?.id ?? '';
    const ended = await client.post(`/api/retainers/${retainer.id}/status`, cast.gm.cookie, {
      status: 'ended',
    });
    expect(ended.status).toBe(200);
    expect(retainerDetailSchema.parse(await ended.json()).status).toBe('ended');
    const [notice] = await notificationsOf(cycleId);
    expect(notice?.actorId).toBe(cast.gm.id);
    expect(nudged).toContainEqual({ retainerId: retainer.id, cycleId });
    const report = await reportOf(cast.am.cookie, retainer.id, cycleId);
    expect(report).toMatchObject({ period: { from: today, to: today }, preliminary: false });
  });

  it('catches up a missed run: the next run closes and reports the cycle (edge case 3)', async () => {
    const { id: clientId } = await cast.createClient();
    const retainer = await cast.createRetainer(clientId);
    const cycleId = retainer.currentCycle?.id ?? '';
    await job.runDaily(addDays(nextCycle, 3));
    const [cycle] = await db.select().from(retainerCycles).where(eq(retainerCycles.id, cycleId));
    expect(cycle?.status).toBe('closed');
    expect(await notificationsOf(cycleId)).toHaveLength(1);
  });

  it('gives backdated cycles no report (B4)', async () => {
    const { id: clientId } = await cast.createClient();
    const start = addMonths(today, -1);
    const response = await client.post('/api/retainers', cast.gm.cookie, {
      clientId,
      name: `عقد ${cast.run} ${randomUUID().slice(0, 6)}`,
      departments: ['design'],
      startDate: start,
      deliverables: [{ kind: 'design', monthlyQuantity: 12 }],
      catchUp: [{ cycle: 1 }],
    });
    expect(response.status).toBe(201);
    const retainer = retainerDetailSchema.parse(await response.json());
    const [past] = await db
      .select()
      .from(retainerCycles)
      .where(and(eq(retainerCycles.retainerId, retainer.id), eq(retainerCycles.number, 1)));
    if (!past) throw new Error('No backdated cycle');
    expect(past.backdated).toBe(true);
    expect((await client.get(path(retainer.id, past.id), cast.gm.cookie)).status).toBe(404);
    // The monthly report marks it, so the page offers no report link (R4).
    const monthly = await client.get(
      `/api/clients/${clientId}/monthly-report?month=${start.slice(0, 7)}`,
      cast.gm.cookie,
    );
    const rows = clientMonthlyReportSchema.parse(await monthly.json()).retainers;
    expect(rows.find((row) => row.cycleId === past.id)).toMatchObject({ backdated: true });
    expect(await notificationsOf(past.id)).toEqual([]);
    expect(
      await db.select().from(retainerCycleReports).where(eq(retainerCycleReports.cycleId, past.id)),
    ).toEqual([]);
  });
});
