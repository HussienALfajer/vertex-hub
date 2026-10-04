import { resolve } from 'node:path';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  REPORTS_PDF_JOB,
  REPORTS_PDF_READY_JOB,
  type ReportPdfJob,
  type ReportPdfReadyJob,
  reportPdfJobSchema,
  reportPdfStorageKey,
} from '@vertex-hub/contracts';
import { ENV, type Env } from '../core/config/env.js';
import { storeOnce } from '../pdf/pdf-objects.js';
import { PdfRenderer } from '../pdf/pdf-renderer.js';
import { PgBossService } from './pg-boss.service.js';

/**
 * Renders monthly client reports (F15 rule 20) and hands the result to the API
 * (`reports.pdf-ready`). As `invoices.pdf`: the job carries its payload and the output is named by
 * its hash, so a retry or a second run renders nothing new.
 */
@Injectable()
export class ReportsPdfJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReportsPdfJob.name);
  private readonly root: string;

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly renderer: PdfRenderer,
    @Inject(ENV) env: Env,
  ) {
    this.root = resolve(env.FILES_ROOT);
  }

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.pgBoss;
    await boss.createQueue(REPORTS_PDF_JOB.queue, { retryLimit: REPORTS_PDF_JOB.retryLimit });
    await boss.createQueue(REPORTS_PDF_READY_JOB.queue);
    await boss.work<ReportPdfJob>(
      REPORTS_PDF_JOB.queue,
      { includeMetadata: true },
      async ([job]) => {
        if (!job) return;
        try {
          await this.report(await this.render(job.data));
        } catch (error) {
          const last = job.retryCount >= REPORTS_PDF_JOB.retryLimit;
          this.logger.error(
            error,
            `Client report PDF render failed (attempt ${job.retryCount + 1})`,
          );
          if (!last) throw error;
          // pg-boss gives up after this attempt: the API marks the render failed.
          const { kind, id, hash } = reportPdfJobSchema.parse(job.data);
          await this.report({ kind, id, hash, file: null });
        }
      },
    );
    this.logger.log(`Working ${REPORTS_PDF_JOB.queue}`);
  }

  /** Writes the PDF once per payload hash; a rerun finds it and reports the same file. */
  async render(data: unknown): Promise<ReportPdfReadyJob> {
    const job = reportPdfJobSchema.parse(data);
    const file = await storeOnce(this.root, reportPdfStorageKey(job), () =>
      this.renderer.clientReport(job.snapshot),
    );
    return { kind: job.kind, id: job.id, hash: job.hash, file };
  }

  private async report(result: ReportPdfReadyJob): Promise<void> {
    await this.pgBoss.boss.send(REPORTS_PDF_READY_JOB.queue, result);
  }
}
