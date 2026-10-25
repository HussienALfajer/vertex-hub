import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  type CycleReport,
  type CycleReportSnapshot,
  cycleReportJobSchema,
  type QuotePdfRender,
  REPORTS_CYCLE_REPORT_JOB,
  REPORTS_PDF_JOB,
  type ReportPdfJob,
  type ReportPdfReadyJob,
  type UnqueuedPdfJob,
} from '@vertex-hub/contracts';
import { type Database, retainerCycleReports, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { JobQueue, payloadHash } from '../../core/jobs/index.js';
import { ApprovalReports } from '../approvals/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, personRef, UserDirectory } from '../auth/index.js';
import { ShootReports } from '../calendar/index.js';
import { CampaignReports } from '../campaigns/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { ContentReports } from '../content/index.js';
import { GeneratedFiles, ImagesService } from '../files/index.js';
import { NotificationCenter } from '../notifications/index.js';
import {
  type CycleClosed,
  CycleClosedHooks,
  EngagementReports,
  type ReportCycle,
} from '../projects/index.js';
import { QuoteDirectory } from '../quotes/index.js';
import { TaskReports } from '../tasks/index.js';
import { coversClient } from './report-access.js';

const PDF_MIME_TYPE = 'application/pdf';

type ReportRow = typeof retainerCycleReports.$inferSelect;

/** A cycle report's reader: whether the campaign sections are theirs to see (R2). */
interface Viewer {
  readsCampaigns: boolean;
}

/**
 * The retainer cycle report (spec F05C R1–R3): F15's client report sections over a cycle's
 * period, composed on read (ADR 0027), with the account manager's summary and a stored PDF. A
 * cycle that closes gets its row, a notification to the client's account manager and a render
 * (`reports.cycle-report`, then the worker's `reports.pdf`); the PDF stays current while the report
 * hashes the same, and is rendered again when asked for after a change.
 */
@Injectable()
export class CycleReportService implements OnModuleInit {
  private readonly logger = new Logger(CycleReportService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly users: UserDirectory,
    private readonly tasks: TaskReports,
    private readonly engagements: EngagementReports,
    private readonly approvals: ApprovalReports,
    private readonly content: ContentReports,
    private readonly shoots: ShootReports,
    private readonly campaigns: CampaignReports,
    private readonly quotes: QuoteDirectory,
    private readonly files: GeneratedFiles,
    private readonly notifications: NotificationCenter,
    private readonly closedHooks: CycleClosedHooks,
    private readonly jobs: JobQueue,
    private readonly images: ImagesService,
  ) {}

  onModuleInit(): void {
    this.closedHooks.register((tx, event) => this.closed(tx, event));
    this.jobs.work(REPORTS_CYCLE_REPORT_JOB.queue, async (data) => {
      const { retainerId, cycleId } = cycleReportJobSchema.parse(data);
      await this.prepare(retainerId, cycleId);
    });
  }

  /**
   * R1, in the closing transaction: the report's row with its render pending, one
   * `retainer_cycle_report_ready` to the client's account manager, and the nudge that renders the
   * PDF once the frozen counts are committed.
   */
  async closed(tx: Transaction, event: CycleClosed): Promise<void> {
    await tx
      .insert(retainerCycleReports)
      .values({ cycleId: event.cycleId, pdfStatus: 'pending' })
      .onConflictDoUpdate({
        target: retainerCycleReports.cycleId,
        set: { pdfStatus: 'pending' },
      });
    const client = await this.clients.summary(event.retainer.clientId, tx);
    if (client) {
      await this.notifications.notify(tx, {
        type: 'retainer_cycle_report_ready',
        recipients: [client.accountManagerId],
        actorId: event.actor?.id ?? null,
        subjectId: event.retainer.id,
        data: {
          retainer: event.retainer.name,
          client: client.name,
          cycleId: event.cycleId,
          cycle: event.number,
          periodStart: event.periodStart,
          periodEnd: event.periodEnd,
          deliveryRate: event.deliveryRate,
        },
      });
    }
    await this.jobs.sendInTransaction(tx, REPORTS_CYCLE_REPORT_JOB.queue, {
      retainerId: event.retainer.id,
      cycleId: event.cycleId,
    });
  }

  /**
   * R1: renders the closed cycle's report as its account manager sees it (with the campaign
   * sections, which `own_clients` covers), unless the stored PDF is already that report. Safe to
   * run twice.
   */
  async prepare(retainerId: string, cycleId: string): Promise<void> {
    const found = await this.engagements.cycleReport(retainerId, cycleId);
    if (!found || found.cycle.backdated) return;
    const client = await this.clients.summary(found.retainer.clientId);
    if (!client) return;
    await this.render(found, client, { readsCampaigns: true });
  }

  /** R2: the report of a cycle whose client the caller's `reports.read` covers; else 404. */
  async report(actor: CurrentUserInfo, retainerId: string, cycleId: string): Promise<CycleReport> {
    const { found, client } = await this.readable(actor, retainerId, cycleId);
    return this.compose(found, client, this.viewer(actor, client));
  }

  /**
   * R3: any reader saves the cycle's summary (last write wins); an empty text clears it. Audited
   * with the old and new text; the stored PDF is no longer the report, so the next download
   * renders it again.
   */
  async saveSummary(
    actor: CurrentUserInfo,
    retainerId: string,
    cycleId: string,
    summary: string,
  ): Promise<CycleReport> {
    const { found, client } = await this.readable(actor, retainerId, cycleId);
    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(retainerCycleReports)
        .where(eq(retainerCycleReports.cycleId, cycleId))
        .for('update');
      const before = existing?.summary ?? '';
      if (before === summary) return;
      await tx
        .insert(retainerCycleReports)
        .values({ cycleId, summary, updatedById: actor.id })
        .onConflictDoUpdate({
          target: retainerCycleReports.cycleId,
          set: { summary, updatedById: actor.id, updatedAt: new Date() },
        });
      await recordAudit(tx, {
        actor: { id: actor.id, name: actor.name },
        action: 'retainer_cycle_report.summary_changed',
        entityType: 'retainer_cycle_report',
        entityId: cycleId,
        before: { summary: before },
        after: { summary, number: found.cycle.number, retainerId },
      });
    });
    return this.compose(found, client, this.viewer(actor, client));
  }

  /** R3: a PDF of the report as the caller sees it now: the stored one, or a new render. */
  async requestPdf(
    actor: CurrentUserInfo,
    retainerId: string,
    cycleId: string,
  ): Promise<QuotePdfRender> {
    const { found, client } = await this.readable(actor, retainerId, cycleId);
    return this.render(found, client, this.viewer(actor, client));
  }

  /** R3: the stored PDF while it is the report as the caller sees it now; else 404. */
  async servePdf(
    actor: CurrentUserInfo,
    retainerId: string,
    cycleId: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const { found, client } = await this.readable(actor, retainerId, cycleId);
    const { snapshot, hash } = await this.payload(found, client, this.viewer(actor, client));
    const row = await this.row(cycleId);
    if (row?.pdfStatus !== 'ready' || row.hash !== hash || !row.storageKey) {
      throw new NotFoundException();
    }
    const name = `${snapshot.client.name} - ${snapshot.retainer.name} - cycle ${snapshot.cycle.number}.pdf`;
    await this.files.serve(row.storageKey, name, PDF_MIME_TYPE, request, response);
  }

  /**
   * `reports.pdf-ready` for a cycle report: records the render on its row, replacing the previous
   * object, or its failure; a render of a report that changed since is dropped. Safe to run twice.
   */
  async ready(result: ReportPdfReadyJob): Promise<void> {
    const key = result.file?.storageKey ?? null;
    const removed = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(retainerCycleReports)
        .where(eq(retainerCycleReports.cycleId, result.id))
        .for('update');
      if (!row || row.hash !== result.hash) return key;
      await tx
        .update(retainerCycleReports)
        .set(
          result.file
            ? {
                pdfStatus: 'ready',
                storageKey: result.file.storageKey,
                sizeBytes: result.file.sizeBytes,
                renderedAt: new Date(),
              }
            : { pdfStatus: 'failed' },
        )
        .where(eq(retainerCycleReports.cycleId, row.cycleId));
      return result.file && row.storageKey !== key ? row.storageKey : null;
    });
    if (removed) await this.removeObject(removed);
  }

  /** The cycle and its client when the caller's `reports.read` covers the client; else 404. */
  private async readable(actor: CurrentUserInfo, retainerId: string, cycleId: string) {
    const found = await this.engagements.cycleReport(retainerId, cycleId);
    // B4: backdated cycles have no report.
    if (!found || found.cycle.backdated) throw new NotFoundException();
    const client = await this.clients.summary(found.retainer.clientId);
    if (!client || !coversClient(actor, 'reports.read', client)) throw new NotFoundException();
    return { found, client };
  }

  private viewer(actor: CurrentUserInfo, client: ClientSummary): Viewer {
    return { readsCampaigns: coversClient(actor, 'campaigns.read', client) };
  }

  /** R2: the sections over the cycle's period. */
  private async compose(
    found: ReportCycle,
    client: ClientSummary,
    viewer: Viewer,
  ): Promise<CycleReport> {
    const { retainer, cycle } = found;
    const period = { from: cycle.periodStart, to: cycle.periodEnd };
    const [row, delivered, posts, shoots, approvals, campaigns, adBudget, plannedPosts, booked] =
      await Promise.all([
        this.row(cycle.id),
        this.tasks.deliveredForClient(client.id, period),
        this.content.published(client.id, period),
        this.shoots.completed(client.id, period),
        this.approvals.closedForClient(client.id, period),
        viewer.readsCampaigns ? this.campaigns.monthCampaigns(client.id, period) : null,
        viewer.readsCampaigns ? this.campaigns.walletMonth(client.id, period) : null,
        this.content.planned(client.id, found.next),
        this.shoots.booked(client.id, found.next),
      ]);
    const [titles, departments, authors] = await Promise.all([
      this.approvals.taskTitles(delivered.map((task) => task.id)),
      this.users.departmentNames(),
      this.users.summaries(row?.summary && row.updatedById ? [row.updatedById] : []),
    ]);
    const report: Omit<CycleReport, 'empty'> = {
      client: { id: client.id, name: client.name, imageId: client.imageId },
      retainer: { id: retainer.id, name: retainer.name },
      cycle: { id: cycle.id, number: cycle.number, status: cycle.status },
      period,
      preliminary: cycle.status === 'open',
      summary:
        row?.summary && row.updatedById
          ? {
              text: row.summary,
              updatedBy: personRef(authors, row.updatedById),
              updatedAt: row.updatedAt.toISOString(),
            }
          : null,
      lines: found.lines,
      deliveryRate: found.deliveryRate,
      deliveredWork: delivered.map((task) => ({
        taskId: task.id,
        title: titles.get(task.id) ?? task.title,
        department: task.department,
        departmentName: departments.get(task.department) ?? task.department,
        deliveredOn: task.deliveredOn,
      })),
      posts,
      shoots: shoots.map(({ id, date, title, location }) => ({ id, date, title, location })),
      approvals,
      campaigns,
      adBudget,
      nextPeriod: {
        period: found.next,
        posts: plannedPosts,
        shoots: booked.map(({ date, title }) => ({ date, title })),
      },
    };
    return { ...report, empty: isEmpty(report) };
  }

  /** The report with the company details, and its hash. */
  private async payload(found: ReportCycle, client: ClientSummary, viewer: Viewer) {
    const report = await this.compose(found, client, viewer);
    const snapshot: CycleReportSnapshot = {
      ...report,
      // F01C: names only, so the hash is the same as before images (the logo is not hashed).
      client: { id: report.client.id, name: report.client.name },
      summary: report.summary && {
        ...report.summary,
        updatedBy: { id: report.summary.updatedBy.id, name: report.summary.updatedBy.name },
      },
      companyDetails: await this.quotes.companyDetails(),
    };
    return { snapshot, hash: payloadHash({ kind: 'cycle_report', snapshot }) };
  }

  /**
   * The stored PDF when it is this report (`ready`), else a new render (`pending`): the row takes
   * the new hash, so a render of the old report coming back is dropped.
   */
  private async render(
    found: ReportCycle,
    client: ClientSummary,
    viewer: Viewer,
  ): Promise<QuotePdfRender> {
    const { snapshot, hash } = await this.payload(found, client, viewer);
    const cycleId = found.cycle.id;
    const job = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(retainerCycleReports)
        .where(eq(retainerCycleReports.cycleId, cycleId))
        .for('update');
      if (existing?.hash === hash && existing.pdfStatus === 'ready') return null;
      await tx
        .insert(retainerCycleReports)
        .values({ cycleId, pdfStatus: 'pending', hash })
        .onConflictDoUpdate({
          target: retainerCycleReports.cycleId,
          set: { pdfStatus: 'pending', hash },
        });
      return { kind: 'cycle_report' as const, id: cycleId, hash, snapshot };
    });
    if (!job) return { state: 'ready' };
    await this.queue(job);
    return { state: 'pending' };
  }

  private async row(cycleId: string): Promise<ReportRow | undefined> {
    const [row] = await this.db
      .select()
      .from(retainerCycleReports)
      .where(eq(retainerCycleReports.cycleId, cycleId));
    return row;
  }

  /** F01C rule 14: with the client's current logo. */
  private async queue(job: UnqueuedPdfJob<ReportPdfJob>): Promise<void> {
    const clientLogoKey = await this.images.clientLogoKey(job.snapshot.client.id);
    const queued: ReportPdfJob = { ...job, clientLogoKey };
    await this.jobs.send(REPORTS_PDF_JOB.queue, queued, {
      retryLimit: REPORTS_PDF_JOB.retryLimit,
    });
  }

  private async removeObject(key: string): Promise<void> {
    try {
      await this.files.remove(key);
    } catch (error) {
      this.logger.warn(`Could not delete ${key}: ${String(error)}`);
    }
  }
}

/** Every section is empty (the summary counts as a section, the cycle's lines do not). */
function isEmpty(report: Omit<CycleReport, 'empty'>): boolean {
  return (
    !report.summary &&
    report.deliveredWork.length === 0 &&
    report.posts.length === 0 &&
    report.shoots.length === 0 &&
    report.approvals.approved + report.approvals.changesRequested === 0 &&
    !report.campaigns?.rows.length &&
    !report.adBudget &&
    report.nextPeriod.posts.length === 0 &&
    report.nextPeriod.shoots.length === 0
  );
}
