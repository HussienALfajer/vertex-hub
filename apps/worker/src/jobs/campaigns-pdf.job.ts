import { resolve } from 'node:path';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  CAMPAIGNS_PDF_JOB,
  CAMPAIGNS_PDF_READY_JOB,
  type CampaignPdfJob,
  type CampaignPdfReadyJob,
  campaignPdfJobSchema,
  campaignPdfStorageKey,
} from '@vertex-hub/contracts';
import { ENV, type Env } from '../core/config/env.js';
import { storeOnce } from '../pdf/pdf-objects.js';
import { PdfRenderer } from '../pdf/pdf-renderer.js';
import { PgBossService } from './pg-boss.service.js';

/**
 * Renders ad budget deposit receipts (F12 rule 19) and hands the result to the API
 * (`campaigns.pdf-ready`). As `invoices.pdf`: the job carries its frozen payload and the output is
 * named by its hash, so a retry or a second run renders nothing new.
 */
@Injectable()
export class CampaignsPdfJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(CampaignsPdfJob.name);
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
    await boss.createQueue(CAMPAIGNS_PDF_JOB.queue, { retryLimit: CAMPAIGNS_PDF_JOB.retryLimit });
    await boss.createQueue(CAMPAIGNS_PDF_READY_JOB.queue);
    await boss.work<CampaignPdfJob>(
      CAMPAIGNS_PDF_JOB.queue,
      { includeMetadata: true },
      async ([job]) => {
        if (!job) return;
        try {
          await this.report(await this.render(job.data));
        } catch (error) {
          const last = job.retryCount >= CAMPAIGNS_PDF_JOB.retryLimit;
          this.logger.error(error, `Campaign PDF render failed (attempt ${job.retryCount + 1})`);
          if (!last) throw error;
          // pg-boss gives up after this attempt: the API marks the PDF failed ("Render again").
          const { kind, id, hash } = campaignPdfJobSchema.parse(job.data);
          await this.report({ kind, id, hash, file: null });
        }
      },
    );
    this.logger.log(`Working ${CAMPAIGNS_PDF_JOB.queue}`);
  }

  /** Writes the PDF once per payload hash; a rerun finds it and reports the same file. */
  async render(data: unknown): Promise<CampaignPdfReadyJob> {
    const job = campaignPdfJobSchema.parse(data);
    const file = await storeOnce(this.root, campaignPdfStorageKey(job), () =>
      this.renderer.adDepositReceipt(job.snapshot),
    );
    return { kind: job.kind, id: job.id, hash: job.hash, file };
  }

  private async report(result: CampaignPdfReadyJob): Promise<void> {
    await this.pgBoss.boss.send(CAMPAIGNS_PDF_READY_JOB.queue, result);
  }
}
