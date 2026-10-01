import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { APPROVAL_LIMITS, APPROVALS_REMINDERS_JOB } from '@vertex-hub/contracts';
import { approvalItems, approvalRequests, type Database } from '@vertex-hub/db';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { JobQueue, runEach } from '../../core/jobs/index.js';
import { ClientDirectory } from '../clients/index.js';
import { TaskApprovals } from '../tasks/index.js';
import { type RequestRow, stateSql } from './approval-items.js';
import { ApprovalNotices } from './approval-notices.js';

/**
 * The `approvals.reminders` job (spec F09 rules 24 and 25, A04), which `apps/worker` schedules
 * every hour and this process works (ADR 0008): the "no response" notice 48 hours after a link
 * is issued, and the "link expired" notice. Each goes out once per issued link: setting
 * `reminded_at` or `expiry_notified_at` is the guard, and a reissue clears both.
 */
@Injectable()
export class ApprovalReminders implements OnModuleInit {
  private readonly logger = new Logger(ApprovalReminders.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly tasks: TaskApprovals,
    private readonly notices: ApprovalNotices,
    private readonly jobs: JobQueue,
  ) {}

  onModuleInit(): void {
    this.jobs.work(APPROVALS_REMINDERS_JOB.queue, async () => {
      const result = await this.run();
      this.logger.log(
        `Approval reminders: ${result.reminded} unanswered, ${result.expired} expired`,
      );
    });
  }

  async run(now: Date = new Date()): Promise<{ reminded: number; expired: number }> {
    const live = this.clients.isLive(approvalRequests.clientId);
    const issuedBefore = new Date(now.getTime() - APPROVAL_LIMITS.reminderHours * 60 * 60 * 1000);
    const [unanswered, expired] = await Promise.all([
      this.db
        .select()
        .from(approvalRequests)
        .where(
          and(
            stateSql('open', now),
            isNull(approvalRequests.remindedAt),
            lte(approvalRequests.linkIssuedAt, issuedBefore),
            live,
          ),
        )
        .orderBy(approvalRequests.id),
      // Not completed, so it still has pending items.
      this.db
        .select()
        .from(approvalRequests)
        .where(and(stateSql('expired', now), isNull(approvalRequests.expiryNotifiedAt), live))
        .orderBy(approvalRequests.id),
    ]);
    const result = { reminded: 0, expired: 0 };
    await runEach(
      [
        ...unanswered.map((request) => ({ request, kind: 'reminded' as const })),
        ...expired.map((request) => ({ request, kind: 'expired' as const })),
      ],
      this.logger,
      ({ request, kind }) => `Approval request ${request.id} (${kind})`,
      async ({ request, kind }) => {
        if (kind === 'reminded' && (await this.answeredByLink(request))) return;
        if (await this.notify(request, kind, now)) result[kind] += 1;
      },
    );
    return result;
  }

  /** Rule 24: the client decided an item through this link since it was issued. */
  private async answeredByLink(request: RequestRow): Promise<boolean> {
    const decided = await this.db
      .select({ responseId: approvalItems.responseId })
      .from(approvalItems)
      .where(
        and(
          eq(approvalItems.requestId, request.id),
          inArray(approvalItems.status, ['approved', 'changes_requested']),
          gte(approvalItems.closedAt, request.linkIssuedAt),
        ),
      );
    const responses = await this.tasks.responses(
      decided.flatMap((item) => (item.responseId ? [item.responseId] : [])),
    );
    return [...responses.values()].some((response) => response.channel === 'link');
  }

  /** Marks the notice sent and sends it, unless the request changed since it was read. */
  private notify(request: RequestRow, kind: 'reminded' | 'expired', now: Date): Promise<boolean> {
    const column =
      kind === 'reminded' ? approvalRequests.remindedAt : approvalRequests.expiryNotifiedAt;
    return this.db.transaction(async (tx) => {
      const [marked] = await tx
        .update(approvalRequests)
        .set(kind === 'reminded' ? { remindedAt: now } : { expiryNotifiedAt: now })
        .where(
          and(
            eq(approvalRequests.id, request.id),
            eq(approvalRequests.tokenHash, request.tokenHash),
            isNull(column),
            isNull(approvalRequests.revokedAt),
            isNull(approvalRequests.completedAt),
          ),
        )
        .returning({ id: approvalRequests.id });
      if (!marked) return false;
      await this.notices.send(tx, request, {
        type: kind === 'reminded' ? 'approval_no_response' : 'approval_expired',
      });
      return true;
    });
  }
}
