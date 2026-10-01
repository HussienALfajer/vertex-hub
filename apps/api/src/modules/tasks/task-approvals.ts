import { Injectable } from '@nestjs/common';
import type { ClientDecision } from '@vertex-hub/contracts';
import { type Transaction, taskClientResponses } from '@vertex-hub/db';
import { recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { FileVersions } from '../files/index.js';
import { ClientReviewHooks } from './client-review-hooks.js';
import { actorOf, type TaskAccess } from './task-access.js';
import { TaskReviews } from './task-reviews.js';

/** A client's answer recorded by hand, as the workflow passes it after moving the task. */
export interface ManualResponse {
  /** The task as it was before the move. */
  task: TaskAccess;
  decision: ClientDecision;
  note: string | null;
  contactId: string;
  /** Requested changes only: the client revision the move wrote. */
  revisionId: string | null;
  recordedBy: CurrentUserInfo;
}

/**
 * Client responses on a task (spec F09 rules 13–16, ADR 0020): one record against the snapshot
 * answered, the final markers of an approval, and the pending approval item that follows.
 */
@Injectable()
export class TaskApprovals {
  constructor(
    private readonly reviews: TaskReviews,
    private readonly files: FileVersions,
    private readonly hooks: ClientReviewHooks,
  ) {}

  /**
   * Rule 16: records the response against the task's cleared review, in the transaction that
   * moved the task. An approval marks the snapshot's versions final (rule 13); a response on a
   * task that was with the client closes its pending item.
   */
  async recordManual(tx: Transaction, response: ManualResponse): Promise<void> {
    const { task, decision, note, contactId, recordedBy } = response;
    const pass = await this.reviews.clearedPass(tx, task);
    const [created] = await tx
      .insert(taskClientResponses)
      .values({
        taskId: task.id,
        decision,
        channel: 'manual',
        contactId,
        note,
        reviewId: pass.id,
        revisionId: response.revisionId,
        recordedById: recordedBy.id,
      })
      .returning({ id: taskClientResponses.id });
    if (!created) throw new Error('Client response insert returned no row');
    const versions = await this.files.versionRefs(pass.versionIds, tx);
    await recordAudit(tx, {
      actor: actorOf(recordedBy),
      action: 'task.client_response_recorded',
      entityType: 'task',
      entityId: task.id,
      after: {
        decision,
        channel: 'manual',
        contactId,
        ...(note && { note }),
        versions: pass.versionIds.flatMap((id) => {
          const version = versions.get(id);
          return version ? [{ name: version.name, number: version.number }] : [];
        }),
      },
    });
    if (decision === 'approved') {
      await this.files.markSnapshotFinal(tx, task.id, pass.versionIds, actorOf(recordedBy));
    }
    if (task.status === 'awaiting_client') {
      await this.hooks.left(tx, {
        taskId: task.id,
        actor: actorOf(recordedBy),
        response: { id: created.id, decision },
      });
    }
  }
}
