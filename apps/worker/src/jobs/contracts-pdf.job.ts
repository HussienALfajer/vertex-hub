import { resolve } from 'node:path';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  CONTRACTS_PDF_JOB,
  CONTRACTS_PDF_READY_JOB,
  type ContractPdfJob,
  type ContractPdfReadyJob,
  contractPdfJobSchema,
  contractPdfStorageKey,
} from '@vertex-hub/contracts';
import { ENV, type Env } from '../core/config/env.js';
import { readClientLogo } from '../pdf/client-logo.js';
import { storeOnce } from '../pdf/pdf-objects.js';
import { PdfRenderer } from '../pdf/pdf-renderer.js';
import { PgBossService } from './pg-boss.service.js';

/**
 * Renders retainer contract, draft preview and annex PDFs (F05C K4, K10) and hands the result to
 * the API (`contracts.pdf-ready`). As `invoices.pdf`: the job carries its frozen payload and the
 * output is named by its hash, so a retry or a second run renders nothing new.
 */
@Injectable()
export class ContractsPdfJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(ContractsPdfJob.name);
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
    await boss.createQueue(CONTRACTS_PDF_JOB.queue, { retryLimit: CONTRACTS_PDF_JOB.retryLimit });
    await boss.createQueue(CONTRACTS_PDF_READY_JOB.queue);
    await boss.work<ContractPdfJob>(
      CONTRACTS_PDF_JOB.queue,
      { includeMetadata: true },
      async ([job]) => {
        if (!job) return;
        try {
          await this.report(await this.render(job.data));
        } catch (error) {
          const last = job.retryCount >= CONTRACTS_PDF_JOB.retryLimit;
          this.logger.error(error, `Contract PDF render failed (attempt ${job.retryCount + 1})`);
          if (!last) throw error;
          // pg-boss gives up after this attempt: the API marks the PDF failed ("Render again").
          const { kind, id, hash } = contractPdfJobSchema.parse(job.data);
          await this.report({ kind, id, hash, file: null });
        }
      },
    );
    this.logger.log(`Working ${CONTRACTS_PDF_JOB.queue}`);
  }

  /** Writes the PDF once per payload hash; a rerun finds it and reports the same file. */
  async render(data: unknown): Promise<ContractPdfReadyJob> {
    const job = contractPdfJobSchema.parse(data);
    const file = await storeOnce(this.root, contractPdfStorageKey(job), () => this.pdf(job));
    return { kind: job.kind, id: job.id, hash: job.hash, file };
  }

  private async pdf(job: ContractPdfJob): Promise<Buffer> {
    switch (job.kind) {
      case 'contract':
      case 'contract_draft':
        return this.renderer.contract(
          job.snapshot,
          await readClientLogo(this.root, job.clientLogoKey, this.logger),
        );
      case 'annex':
        return this.renderer.annex(
          job.snapshot,
          await readClientLogo(this.root, job.clientLogoKey, this.logger),
        );
    }
  }

  private async report(result: ContractPdfReadyJob): Promise<void> {
    await this.pgBoss.boss.send(CONTRACTS_PDF_READY_JOB.queue, result);
  }
}
