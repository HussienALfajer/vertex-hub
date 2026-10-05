import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  addMonths,
  businessDate,
  type ClientMonthlyReport,
  type ClientReportSnapshot,
  type EmailHistory,
  type EmailSummary,
  isFutureMonth,
  isPreliminaryMonth,
  monthPeriod,
  type QuotePdfRender,
  REPORTS_PDF_JOB,
  REPORTS_PDF_READY_JOB,
  type ReportEmail,
  type ReportPdfJob,
  type ReportPdfReadyJob,
  reportPdfReadyJobSchema,
} from '@vertex-hub/contracts';
import { clientReportNotes, clientReportPdfs, type Database, newId } from '@vertex-hub/db';
import { and, eq, lt } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { JobQueue, payloadHash } from '../../core/jobs/index.js';
import { ApprovalReports } from '../approvals/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ShootReports } from '../calendar/index.js';
import { CampaignReports } from '../campaigns/index.js';
import { ClientDirectory, ClientEmails, type ClientSummary } from '../clients/index.js';
import { ContentReports } from '../content/index.js';
import { FilePurges, GeneratedFiles } from '../files/index.js';
import { EngagementReports } from '../projects/index.js';
import { QuoteDirectory } from '../quotes/index.js';
import { TaskReports } from '../tasks/index.js';
import { coversClient } from './report-access.js';

const PDF_MIME_TYPE = 'application/pdf';

/** Rule 20: a report PDF can be downloaded for this long after it was asked for. */
const PDF_HOURS = 24;

const pdfCutoff = (now: Date) => new Date(now.getTime() - PDF_HOURS * 3600 * 1000);

/**
 * The monthly client report (spec F15, rules 17–20): its sections composed on read from the
 * report services of other modules (ADR 0027), the account manager's summary, and its PDF,
 * rendered by the worker (`reports.pdf`) and kept 24 hours like F13 statements.
 */
@Injectable()
export class ClientReportService implements OnModuleInit {
  private readonly logger = new Logger(ClientReportService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly clientEmails: ClientEmails,
    private readonly users: UserDirectory,
    private readonly tasks: TaskReports,
    private readonly engagements: EngagementReports,
    private readonly approvals: ApprovalReports,
    private readonly content: ContentReports,
    private readonly shoots: ShootReports,
    private readonly campaigns: CampaignReports,
    private readonly quotes: QuoteDirectory,
    private readonly files: GeneratedFiles,
    private readonly purges: FilePurges,
    private readonly jobs: JobQueue,
  ) {}

  onModuleInit(): void {
    this.jobs.work(REPORTS_PDF_READY_JOB.queue, (data) =>
      this.ready(reportPdfReadyJobSchema.parse(data)),
    );
    this.purges.register('client report PDFs', (now) => this.purge(now));
  }

  /** Rules 17 and 18: the report of a client the caller reads, for a month up to the current one. */
  async report(
    actor: CurrentUserInfo,
    clientId: string,
    month: string,
  ): Promise<ClientMonthlyReport> {
    const client = await this.readableClient(actor, clientId);
    const today = businessDate();
    if (isFutureMonth(month, today)) {
      throw new CodedException(400, 'INVALID_MONTH', 'The month has not started yet');
    }
    const period = monthPeriod(month);
    const next = monthPeriod(addMonths(period.from, 1).slice(0, 7));
    const readsCampaigns = coversClient(actor, 'campaigns.read', client);
    const [
      note,
      retainers,
      projects,
      delivered,
      posts,
      shoots,
      approvals,
      campaigns,
      adBudget,
      plannedPosts,
      bookedShoots,
      departments,
    ] = await Promise.all([
      this.note(clientId, period.from),
      this.engagements.clientRetainers(clientId, period),
      this.engagements.clientProjects(clientId, period),
      this.tasks.deliveredForClient(clientId, period),
      this.content.published(clientId, period),
      this.shoots.completed(clientId, period),
      this.approvals.closedForClient(clientId, period),
      readsCampaigns ? this.campaigns.monthCampaigns(clientId, period) : null,
      readsCampaigns ? this.campaigns.walletMonth(clientId, period) : null,
      this.content.planned(clientId, next),
      this.shoots.booked(clientId, next),
      this.users.departmentNames(),
    ]);
    const titles = await this.approvals.taskTitles(delivered.map((task) => task.id));
    const author = note
      ? (await this.users.summaries([note.updatedById])).get(note.updatedById)
      : null;
    const report: Omit<ClientMonthlyReport, 'empty'> = {
      client: { id: client.id, name: client.name },
      month,
      period,
      preliminary: isPreliminaryMonth(month, today),
      summary: note
        ? {
            text: note.summary,
            updatedBy: { id: note.updatedById, name: author?.name ?? '' },
            updatedAt: note.updatedAt.toISOString(),
          }
        : null,
      retainers,
      projects,
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
      nextMonth: {
        posts: plannedPosts,
        shoots: bookedShoots.map(({ date, title }) => ({ date, title })),
      },
    };
    return { ...report, empty: isEmpty(report) };
  }

  /**
   * Rule 19: any reader of the client's report saves the month's summary (last write wins), for
   * any month up to the current one; an empty text clears it. Audited with the old and new text.
   */
  async saveSummary(
    actor: CurrentUserInfo,
    clientId: string,
    month: string,
    summary: string,
  ): Promise<ClientMonthlyReport> {
    await this.readableClient(actor, clientId);
    if (isFutureMonth(month, businessDate())) {
      throw new CodedException(400, 'INVALID_MONTH', 'The month has not started yet');
    }
    const first = monthPeriod(month).from;
    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(clientReportNotes)
        .where(and(eq(clientReportNotes.clientId, clientId), eq(clientReportNotes.month, first)))
        .for('update');
      const before = existing?.summary ?? '';
      if (before === summary) return;
      // An empty text is the cleared summary: the row stays (spec F15, "Data").
      await tx
        .insert(clientReportNotes)
        .values({ clientId, month: first, summary, updatedById: actor.id })
        .onConflictDoUpdate({
          target: [clientReportNotes.clientId, clientReportNotes.month],
          set: { summary, updatedById: actor.id, updatedAt: new Date() },
        });
      await recordAudit(tx, {
        actor: { id: actor.id, name: actor.name },
        action: 'client_report.summary_changed',
        entityType: 'client_report',
        entityId: clientId,
        before: { month, summary: before },
        after: { month, summary },
      });
    });
    return this.report(actor, clientId, month);
  }

  /**
   * Rule 20: a PDF of the report as it is now. A render of the same report asked for within 24
   * hours is reused, and its 24 hours start again.
   */
  async requestPdf(
    actor: CurrentUserInfo,
    clientId: string,
    month: string,
  ): Promise<QuotePdfRender> {
    const { snapshot, hash } = await this.payload(actor, clientId, month);
    const now = new Date();
    const job = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(clientReportPdfs)
        .where(eq(clientReportPdfs.hash, hash))
        .for('update');
      if (existing?.status === 'ready') {
        await tx
          .update(clientReportPdfs)
          .set({ requestedAt: now })
          .where(eq(clientReportPdfs.id, existing.id));
        return null;
      }
      const [row] = await tx
        .insert(clientReportPdfs)
        .values({
          clientId,
          month: snapshot.period.from,
          hash,
          status: 'pending',
          requestedAt: now,
        })
        .onConflictDoUpdate({
          target: clientReportPdfs.hash,
          set: { status: 'pending', requestedAt: now },
        })
        .returning();
      if (!row) throw new Error('The report render was not recorded');
      return { kind: 'client_report' as const, id: row.id, hash, snapshot };
    });
    if (!job) return { state: 'ready' };
    await this.queue(job);
    return { state: 'pending' };
  }

  /**
   * F14 email rule 21: the report as it is now, from its ready render (`PDF_NOT_READY`
   * otherwise), copied so the email keeps it after the render is deleted. Audited on the client.
   */
  async sendEmail(
    actor: CurrentUserInfo,
    clientId: string,
    input: ReportEmail,
  ): Promise<EmailSummary> {
    const { snapshot, hash } = await this.payload(actor, clientId, input.month);
    const [row] = await this.db
      .select()
      .from(clientReportPdfs)
      .where(eq(clientReportPdfs.hash, hash));
    const notReady = () => new CodedException(409, 'PDF_NOT_READY', 'The PDF is not ready yet');
    if (row?.status !== 'ready' || !row.storageKey || row.requestedAt < pdfCutoff(new Date())) {
      throw notReady();
    }
    const id = newId();
    const emailId = await this.files.withEmailCopy(row.storageKey, id, notReady, (copy) =>
      this.db.transaction(async (tx) => {
        const queued = await this.clientEmails.queue(tx, actor, {
          id,
          kind: 'client_report',
          clientId,
          recipients: input,
          subject: input.subject,
          message: input.message,
          data: { month: input.month },
          attachments: [
            {
              fileName: `${snapshot.client.name} - Report ${snapshot.month}.pdf`,
              storageKey: copy.storageKey,
              sizeBytes: copy.sizeBytes,
              sha256: copy.sha256,
            },
          ],
          record: { type: 'client', id: clientId },
        });
        await recordAudit(tx, {
          actor: { id: actor.id, name: actor.name },
          action: 'client.emailed',
          entityType: 'client',
          entityId: clientId,
          after: { month: input.month, email: queued.audit },
        });
        return queued.id;
      }),
    );
    return this.clientEmails.summary(emailId);
  }

  /** Screens 5: the month's emailed reports, newest first. */
  async emails(actor: CurrentUserInfo, clientId: string, month: string): Promise<EmailHistory> {
    await this.readableClient(actor, clientId);
    return this.clientEmails.history({ clientId, kinds: ['client_report'], month });
  }

  /** Rule 20: the PDF of the report as it is now, while it is downloadable; else 404. */
  async servePdf(
    actor: CurrentUserInfo,
    clientId: string,
    month: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const { snapshot, hash } = await this.payload(actor, clientId, month);
    const [row] = await this.db
      .select()
      .from(clientReportPdfs)
      .where(eq(clientReportPdfs.hash, hash));
    if (row?.status !== 'ready' || !row.storageKey || row.requestedAt < pdfCutoff(new Date())) {
      throw new NotFoundException();
    }
    const name = `${snapshot.client.name} - Report ${snapshot.month}.pdf`;
    await this.files.serve(row.storageKey, name, PDF_MIME_TYPE, request, response);
  }

  /** `reports.pdf-ready`: records the render on its row, or its failure. Safe to run twice. */
  async ready(result: ReportPdfReadyJob): Promise<void> {
    const key = result.file?.storageKey ?? null;
    const stale = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(clientReportPdfs)
        .where(eq(clientReportPdfs.id, result.id))
        .for('update');
      if (!row || row.hash !== result.hash) return true;
      await tx
        .update(clientReportPdfs)
        .set(
          result.file
            ? {
                status: 'ready',
                storageKey: result.file.storageKey,
                sizeBytes: result.file.sizeBytes,
              }
            : { status: 'failed' },
        )
        .where(eq(clientReportPdfs.id, row.id));
      return false;
    });
    if (stale && key) await this.removeObject(key);
  }

  /** Rule 20: renders older than 24 hours go, with their objects. */
  async purge(now: Date): Promise<number> {
    const stale = await this.db
      .delete(clientReportPdfs)
      .where(lt(clientReportPdfs.requestedAt, pdfCutoff(now)))
      .returning({ key: clientReportPdfs.storageKey });
    for (const { key } of stale) if (key) await this.removeObject(key);
    return stale.length;
  }

  /** The client, when the caller's `reports.read` covers it (`all` or `own_clients`); else 404. */
  private async readableClient(actor: CurrentUserInfo, clientId: string): Promise<ClientSummary> {
    const client = await this.clients.summary(clientId);
    if (!client || !coversClient(actor, 'reports.read', client)) throw new NotFoundException();
    return client;
  }

  private async note(clientId: string, month: string) {
    const [row] = await this.db
      .select()
      .from(clientReportNotes)
      .where(and(eq(clientReportNotes.clientId, clientId), eq(clientReportNotes.month, month)));
    return row?.summary ? row : null;
  }

  /** The report (its access and month checked there) with the company details. */
  private async payload(actor: CurrentUserInfo, clientId: string, month: string) {
    const report = await this.report(actor, clientId, month);
    const snapshot: ClientReportSnapshot = {
      ...report,
      companyDetails: await this.quotes.companyDetails(),
    };
    return { snapshot, hash: payloadHash({ kind: 'client_report', snapshot }) };
  }

  private async queue(job: ReportPdfJob): Promise<void> {
    await this.jobs.send(REPORTS_PDF_JOB.queue, job, { retryLimit: REPORTS_PDF_JOB.retryLimit });
  }

  private async removeObject(key: string): Promise<void> {
    try {
      await this.files.remove(key);
    } catch (error) {
      this.logger.warn(`Could not delete ${key}: ${String(error)}`);
    }
  }
}

/** Rule 18: every section is empty (the summary counts as a section). */
function isEmpty(report: Omit<ClientMonthlyReport, 'empty'>): boolean {
  return (
    !report.summary &&
    report.retainers.length === 0 &&
    report.projects.length === 0 &&
    report.deliveredWork.length === 0 &&
    report.posts.length === 0 &&
    report.shoots.length === 0 &&
    report.approvals.approved + report.approvals.changesRequested === 0 &&
    !report.campaigns?.rows.length &&
    !report.adBudget &&
    report.nextMonth.posts.length === 0 &&
    report.nextMonth.shoots.length === 0
  );
}
