import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  EMAIL_LIMITS,
  EMAIL_RESULT_JOB,
  EMAIL_SEND_JOB,
  type EmailResultJob,
  emailSendJobSchema,
} from '@vertex-hub/contracts';
import { EmailSender } from '../email/email-sender.js';
import { PgBossService } from './pg-boss.service.js';

/**
 * Sends the emails of the outbox (F14 email, ADR 0028) and hands the outcome to the API
 * (`email.result`): `sent`, or `failed` after the last of three retries with backoff. The job
 * carries the whole email, so the worker reads no table; the API changes only a `queued` row.
 */
@Injectable()
export class EmailSendJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailSendJob.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly sender: EmailSender,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.pgBoss;
    const { queue, retryLimit, retryDelay, retryBackoff } = EMAIL_SEND_JOB;
    await boss.createQueue(queue, { retryLimit, retryDelay, retryBackoff });
    await boss.createQueue(EMAIL_RESULT_JOB.queue);
    await boss.work(queue, { includeMetadata: true }, async ([job]) => {
      if (!job) return;
      await this.handle(job.data, job.retryCount);
    });
    this.logger.log(`Working ${queue}`);
  }

  /** One attempt; throws to let pg-boss retry, except after the last attempt. */
  async handle(data: unknown, retryCount: number): Promise<EmailResultJob> {
    const job = emailSendJobSchema.parse(data);
    const attempts = retryCount + 1;
    let result: EmailResultJob;
    try {
      const { messageId } = await this.sender.send(job);
      result = {
        id: job.id,
        status: 'sent',
        attempts,
        providerMessageId: messageId,
        sentAt: new Date().toISOString(),
      };
    } catch (error) {
      // Never the error itself: SMTP refusals name recipient addresses. The message reaches
      // `email_messages.last_error` through `email.result`, behind `audit.read`.
      const { code, responseCode } = (error ?? {}) as { code?: unknown; responseCode?: unknown };
      this.logger.error(
        `Email ${job.id} failed (attempt ${attempts}): ${String(code ?? 'error')} ${String(responseCode ?? '')}`.trim(),
      );
      if (retryCount < EMAIL_SEND_JOB.retryLimit) throw error;
      const message = error instanceof Error ? error.message : String(error);
      result = {
        id: job.id,
        status: 'failed',
        attempts,
        error: message.slice(0, EMAIL_LIMITS.error),
      };
    }
    await this.pgBoss.boss.send(EMAIL_RESULT_JOB.queue, result);
    return result;
  }
}
