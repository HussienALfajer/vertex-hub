import { Injectable } from '@nestjs/common';
import type { PostTaskUnlinkReason, TaskStatus } from '@vertex-hub/contracts';
import { type Transaction, tasks } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { type AuditActor, recordAudit } from '../audit/index.js';

/** Something that happened to a task linked to a post, told in the transaction that did it. */
export interface PostTaskEvent {
  postId: string;
  task: { id: string; title: string };
  actor: AuditActor | null;
}

/** What the module that owns posts hears about their linked tasks (spec F08, "Data"). */
export interface PostTaskListener {
  /** The task's department approved it: its final files are now media of the post. */
  approved(tx: Transaction, event: PostTaskEvent): Promise<void>;
  /** Rule 8: the task was cancelled or archived, which unlinked it. */
  unlinked(tx: Transaction, event: PostTaskEvent & { reason: PostTaskUnlinkReason }): Promise<void>;
}

/**
 * Lets the `content` module follow the tasks linked to its posts without `tasks` importing it
 * (spec F08, "Data"; ADR 0021). Until a listener registers, nobody hears.
 */
@Injectable()
export class PostTaskHooks {
  private listener: PostTaskListener | undefined;

  register(listener: PostTaskListener): void {
    this.listener = listener;
  }

  async approved(tx: Transaction, event: PostTaskEvent): Promise<void> {
    await this.listener?.approved(tx, event);
  }

  async unlinked(
    tx: Transaction,
    event: PostTaskEvent & { reason: PostTaskUnlinkReason },
  ): Promise<void> {
    await this.listener?.unlinked(tx, event);
  }
}

/** What unlinking needs of a task: where it was linked and how far its work got. */
export interface LinkedTaskState {
  id: string;
  postId: string | null;
  status: TaskStatus;
}

/**
 * Rule 8: clears the link of a task the caller locked and gives a task not yet approved its
 * client approval back. Audited on the task; the caller tells the post.
 */
export async function clearPostLink(
  tx: Transaction,
  task: LinkedTaskState,
  actor: AuditActor | null,
): Promise<void> {
  const restores = task.status !== 'approved' && task.status !== 'delivered';
  await tx
    .update(tasks)
    .set({ postId: null, postLinkedAt: null, ...(restores && { needsClientApproval: true }) })
    .where(eq(tasks.id, task.id));
  await recordAudit(tx, {
    actor,
    action: 'task.updated',
    entityType: 'task',
    entityId: task.id,
    before: { postId: task.postId, ...(restores && { needsClientApproval: false }) },
    after: { postId: null, ...(restores && { needsClientApproval: true }) },
  });
}

/**
 * Rule 8: a linked task that was cancelled or archived leaves its post, which is told. `task` is
 * as it was before the change; nothing happens for a task without a post.
 */
export async function unlinkRemovedTask(
  tx: Transaction,
  hooks: PostTaskHooks,
  task: LinkedTaskState & { title: string },
  reason: PostTaskUnlinkReason,
  actor: AuditActor | null,
): Promise<void> {
  if (!task.postId) return;
  await clearPostLink(tx, task, actor);
  await hooks.unlinked(tx, {
    postId: task.postId,
    task: { id: task.id, title: task.title },
    actor,
    reason,
  });
}
