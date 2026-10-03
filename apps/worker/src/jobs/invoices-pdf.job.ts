import { resolve } from 'node:path';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  INVOICES_PDF_JOB,
  INVOICES_PDF_READY_JOB,
  type InvoicePdfJob,
  type InvoicePdfReadyJob,
  invoicePdfJobSchema,
  invoicePdfStorageKey,
} from '@vertex-hub/contracts';
import { ENV, type Env } from '../core/config/env.js';
import { storeOnce } from '../pdf/pdf-objects.js';
import { PdfRenderer } from '../pdf/pdf-renderer.js';
import { PgBossService } from './pg-boss.service.js';

/**
 * Renders invoice, draft preview, receipt and statement PDFs (F13 rules 15, 20 and 29) and hands
 * the result to the API (`invoices.pdf-ready`). As `quotes.pdf`: the job carries its frozen
 * payload and the output is named by its hash, so a retry or a second run renders nothing new.
 */
@Injectable()
export class InvoicesPdfJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(InvoicesPdfJob.name);
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
    await boss.createQueue(INVOICES_PDF_JOB.queue, { retryLimit: INVOICES_PDF_JOB.retryLimit });
    await boss.createQueue(INVOICES_PDF_READY_JOB.queue);
    await boss.work<InvoicePdfJob>(
      INVOICES_PDF_JOB.queue,
      { includeMetadata: true },
      async ([job]) => {
        if (!job) return;
        try {
          await this.report(await this.render(job.data));
        } catch (error) {
          const last = job.retryCount >= INVOICES_PDF_JOB.retryLimit;
          this.logger.error(error, `Invoice PDF render failed (attempt ${job.retryCount + 1})`);
          if (!last) throw error;
          // pg-boss gives up after this attempt: the API marks the PDF failed ("Render again").
          const { kind, id, hash } = invoicePdfJobSchema.parse(job.data);
          await this.report({ kind, id, hash, file: null });
        }
      },
    );
    this.logger.log(`Working ${INVOICES_PDF_JOB.queue}`);
  }

  /** Writes the PDF once per payload hash; a rerun finds it and reports the same file. */
  async render(data: unknown): Promise<InvoicePdfReadyJob> {
    const job = invoicePdfJobSchema.parse(data);
    const file = await storeOnce(this.root, invoicePdfStorageKey(job), () => this.pdf(job));
    return { kind: job.kind, id: job.id, hash: job.hash, file };
  }

  private pdf(job: InvoicePdfJob): Promise<Buffer> {
    switch (job.kind) {
      case 'invoice':
      case 'invoice_draft':
        return this.renderer.invoice(job.snapshot);
      case 'receipt':
        return this.renderer.receipt(job.snapshot);
      case 'statement':
        return this.renderer.statement(job.snapshot);
    }
  }

  private async report(result: InvoicePdfReadyJob): Promise<void> {
    await this.pgBoss.boss.send(INVOICES_PDF_READY_JOB.queue, result);
  }
}
