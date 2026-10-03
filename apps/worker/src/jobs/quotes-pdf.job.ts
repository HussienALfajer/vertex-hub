import { resolve } from 'node:path';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  QUOTES_PDF_JOB,
  QUOTES_PDF_READY_JOB,
  type QuotePdfJob,
  type QuotePdfReadyJob,
  quotePdfJobSchema,
  quotePdfStorageKey,
} from '@vertex-hub/contracts';
import { ENV, type Env } from '../core/config/env.js';
import { storeOnce } from '../pdf/pdf-objects.js';
import { PdfRenderer } from '../pdf/pdf-renderer.js';
import { PgBossService } from './pg-boss.service.js';

/**
 * Renders quote PDFs (F04 rules 12 and 13) and hands the result to the API, which attaches it
 * to the quote (`quotes.pdf-ready`). The job carries its frozen payload; the output is named by
 * the payload's hash, so a retry or a second run renders nothing new (ADR 0008).
 */
@Injectable()
export class QuotesPdfJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(QuotesPdfJob.name);
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
    await boss.createQueue(QUOTES_PDF_JOB.queue, { retryLimit: QUOTES_PDF_JOB.retryLimit });
    await boss.createQueue(QUOTES_PDF_READY_JOB.queue);
    await boss.work<QuotePdfJob>(QUOTES_PDF_JOB.queue, { includeMetadata: true }, async ([job]) => {
      if (!job) return;
      try {
        await this.report(await this.render(job.data));
      } catch (error) {
        const last = job.retryCount >= QUOTES_PDF_JOB.retryLimit;
        this.logger.error(error, `Quote PDF render failed (attempt ${job.retryCount + 1})`);
        if (!last) throw error;
        // pg-boss gives up after this attempt: the API marks the PDF failed ("Render again").
        const { quoteId, draft, hash } = quotePdfJobSchema.parse(job.data);
        await this.report({ quoteId, draft, hash, file: null });
      }
    });
    this.logger.log(`Working ${QUOTES_PDF_JOB.queue}`);
  }

  /** Writes the PDF once per payload hash; a rerun finds it and reports the same file. */
  async render(data: unknown): Promise<QuotePdfReadyJob> {
    const job = quotePdfJobSchema.parse(data);
    const file = await storeOnce(this.root, quotePdfStorageKey(job), () =>
      this.renderer.quote(job.snapshot, { draft: job.draft }),
    );
    return { quoteId: job.quoteId, draft: job.draft, hash: job.hash, file };
  }

  private async report(result: QuotePdfReadyJob): Promise<void> {
    await this.pgBoss.boss.send(QUOTES_PDF_READY_JOB.queue, result);
  }
}
