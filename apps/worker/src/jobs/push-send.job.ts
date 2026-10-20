import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  PUSH_LIMITS,
  PUSH_RESULT_JOB,
  PUSH_SEND_JOB,
  type PushResultJob,
  pushSendJobSchema,
} from '@vertex-hub/contracts';
import { PushSender } from '../push/push-sender.js';
import { PgBossService } from './pg-boss.service.js';

/**
 * Sends the pushes the API queued (spec F16 rule A8, ADR 0036), one device per job, and hands the
 * outcome to the API (`push.result`): `sent`; `gone` at once when the push service refused the
 * subscription for good; `failed` after the last of three retries with backoff (rule A13). The
 * job carries the whole message, so the worker reads no table.
 */
@Injectable()
export class PushSendJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(PushSendJob.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly sender: PushSender,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { boss } = this.pgBoss;
    const { queue, retryLimit, retryDelay, retryBackoff } = PUSH_SEND_JOB;
    await boss.createQueue(queue, { retryLimit, retryDelay, retryBackoff });
    await boss.createQueue(PUSH_RESULT_JOB.queue);
    await boss.work(queue, { includeMetadata: true }, async ([job]) => {
      if (!job) return;
      await this.handle(job.data, job.retryCount);
    });
    this.logger.log(`Working ${queue}`);
  }

  /** One attempt; throws to let pg-boss retry, except after the last attempt. */
  async handle(data: unknown, retryCount: number): Promise<PushResultJob> {
    const job = pushSendJobSchema.parse(data);
    const deliveryId = job.payload.deliveryId;
    const attempts = retryCount + 1;
    let result: PushResultJob;
    try {
      const outcome = await this.sender.send(job);
      result =
        outcome.status === 'sent'
          ? { deliveryId, status: 'sent', attempts, sentAt: new Date().toISOString() }
          : { deliveryId, status: 'gone', attempts, error: outcome.error };
    } catch (error) {
      // Never the endpoint: it identifies the device.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Push ${deliveryId} failed (attempt ${attempts}): ${message}`);
      if (retryCount < PUSH_SEND_JOB.retryLimit) throw error;
      result = {
        deliveryId,
        status: 'failed',
        attempts,
        error: message.slice(0, PUSH_LIMITS.error),
      };
    }
    await this.pgBoss.boss.send(PUSH_RESULT_JOB.queue, result);
    return result;
  }
}
