import { ForbiddenException, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type CreatePostTask,
  isPostContentEditable,
  type LinkableTaskList,
  type LinkableTaskQuery,
  type PostDetail,
  postTaskDueDate,
  postTaskTitle,
  type ReturnPostTask,
} from '@vertex-hub/contracts';
import { contentPosts, type Database, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { type LinkedTask, PostTaskHooks, PostTasks } from '../tasks/index.js';
import { ContentService } from './content.service.js';
import {
  actorOf,
  assertPostWritable,
  type PostAccess,
  postRights,
  readablePost,
} from './post-access.js';
import { PostNotices } from './post-notices.js';
import { PostReviews } from './post-reviews.js';

/** The longest brief a task holds (F06). */
const BRIEF_MAX = 5000;

/**
 * The tasks linked to a post (spec F08 rules 6–9 and 12, ADR 0021): linking and unlinking the
 * client's tasks, requesting a new one from a department and sending one back for changes. The
 * tasks themselves change through `tasks`' `PostTasks`; this service checks the post and audits
 * on it, and hears from `PostTaskHooks` when a linked task is approved, cancelled or archived.
 */
@Injectable()
export class PostLinksService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly content: ContentService,
    private readonly reviews: PostReviews,
    private readonly notices: PostNotices,
    private readonly tasks: PostTasks,
    private readonly taskHooks: PostTaskHooks,
  ) {}

  onModuleInit(): void {
    this.taskHooks.register({
      approved: async (tx, { postId, task, actor }) => {
        const post = await this.load(tx, postId);
        if (!post) return;
        await this.notices.send(tx, [
          this.notices.notice(post, 'post_task_ready', [post.responsibleId], actor?.id ?? null, {
            taskTitle: task.title,
          }),
        ]);
      },
      unlinked: async (tx, { postId, task, actor, reason }) => {
        await this.auditTask(tx, actor, 'post.task_unlinked', postId, task, { reason });
        const post = await this.load(tx, postId);
        if (!post) return;
        await this.notices.send(tx, [
          this.notices.notice(post, 'post_task_unlinked', [post.responsibleId], actor?.id ?? null, {
            taskTitle: task.title,
            reason,
          }),
        ]);
      },
    });
  }

  /** Rule 6: the tasks the link-task dialog offers, for edit scope. */
  async linkable(
    actor: CurrentUserInfo,
    id: string,
    query: LinkableTaskQuery,
  ): Promise<LinkableTaskList> {
    const post = await readablePost(this.db, this.clients, actor, id);
    if (!postRights(actor, post.client).edit) throw new ForbiddenException();
    return { items: await this.tasks.linkable(post, query) };
  }

  /** Rules 6 and 7: links a task of the client; an idea starts production. */
  async link(actor: CurrentUserInfo, id: string, taskId: string): Promise<PostDetail> {
    await this.db.transaction(async (tx) => {
      const post = await this.editablePost(tx, actor, id);
      const linked = (await this.tasks.linked([id], tx)).get(id) ?? [];
      if (linked.some((task) => task.id === taskId)) return;
      const task = await this.tasks.link(tx, post, taskId, actorOf(actor));
      await this.auditTask(tx, actorOf(actor), 'post.task_linked', id, task);
      await this.startProduction(tx, actor, post);
    });
    return this.content.detail(actor, id);
  }

  /** Rule 8: the task is free for another post, with its client approval back unless approved. */
  async unlink(actor: CurrentUserInfo, id: string, taskId: string): Promise<PostDetail> {
    await this.db.transaction(async (tx) => {
      await this.editablePost(tx, actor, id);
      const task = await this.tasks.unlink(tx, id, taskId, actorOf(actor));
      await this.auditTask(tx, actorOf(actor), 'post.task_unlinked', id, task);
    });
    return this.content.detail(actor, id);
  }

  /**
   * Rule 9: a request in a department's queue, titled and briefed from the post and due two work
   * days before it is published, linked to the post from the start.
   */
  async createTask(actor: CurrentUserInfo, id: string, input: CreatePostTask): Promise<PostDetail> {
    await this.db.transaction(async (tx) => {
      // The new task locks its client: taken before the post, as a healthcare flag change does.
      const { clientId } = await readablePost(tx, this.clients, actor, id);
      await this.clients.summary(clientId, tx, { forUpdate: true });
      const post = await this.editablePost(tx, actor, id);
      const brief = [post.notes, post.caption].filter(Boolean).join('\n\n').slice(0, BRIEF_MAX);
      const task = await this.tasks.create(
        tx,
        post,
        {
          department: input.department,
          title: input.title ?? postTaskTitle(post.type, post.title),
          brief: input.brief ?? (brief || null),
          dueDate: input.dueDate ?? postTaskDueDate(post.publishDate),
          cycleLineId: input.cycleLineId,
        },
        actor,
      );
      await this.auditTask(tx, actorOf(actor), 'post.task_linked', id, task, { created: true });
      await this.startProduction(tx, actor, post);
    });
    return this.content.detail(actor, id);
  }

  /**
   * Rule 12: while the post is in production, an approved linked task goes back for changes: a
   * client revision right after the client asked for changes on the post, an internal one
   * otherwise.
   */
  async returnTask(
    actor: CurrentUserInfo,
    id: string,
    taskId: string,
    input: ReturnPostTask,
  ): Promise<PostDetail> {
    await this.db.transaction(async (tx) => {
      const post = await readablePost(tx, this.clients, actor, id, { forUpdate: true });
      if (!postRights(actor, post.client).edit) throw new ForbiddenException();
      assertPostWritable(post);
      if (post.status !== 'in_production') {
        throw new CodedException(
          409,
          'INVALID_TRANSITION',
          'A linked task is sent back while its post is in production',
        );
      }
      const response = await this.reviews.returningResponse(tx, id);
      const task = await this.tasks.returnForChanges(
        tx,
        id,
        taskId,
        { note: input.note, response },
        actor,
      );
      await this.auditTask(tx, actorOf(actor), 'post.task_returned', id, task, {
        note: input.note,
        source: response ? 'client' : 'internal',
      });
    });
    return this.content.detail(actor, id);
  }

  /**
   * Locks a post the actor may change the linked tasks of: edit scope, not read-only, and in
   * `idea` or `in_production` (rule 3, `POST_LOCKED`).
   */
  private async editablePost(
    tx: Transaction,
    actor: CurrentUserInfo,
    id: string,
  ): Promise<PostAccess> {
    const post = await readablePost(tx, this.clients, actor, id, { forUpdate: true });
    if (!postRights(actor, post.client).edit) throw new ForbiddenException();
    assertPostWritable(post);
    if (!isPostContentEditable(post.status)) {
      throw new CodedException(
        409,
        'POST_LOCKED',
        `The linked tasks do not change on a ${post.status} post`,
      );
    }
    return post;
  }

  /** Rule 7: a linked or requested task moves an idea to production. */
  private async startProduction(
    tx: Transaction,
    actor: CurrentUserInfo,
    post: PostAccess,
  ): Promise<void> {
    if (post.status !== 'idea') return;
    await tx
      .update(contentPosts)
      .set({ status: 'in_production' })
      .where(eq(contentPosts.id, post.id));
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'post.status_changed',
      entityType: 'post',
      entityId: post.id,
      before: { status: 'idea' },
      after: { status: 'in_production', reason: 'task_linked' },
    });
  }

  /** The post as it is now, for a notice; null when it is gone with its client. */
  private async load(tx: Transaction, id: string): Promise<PostAccess | null> {
    const [row] = await tx.select().from(contentPosts).where(eq(contentPosts.id, id));
    const client = row ? await this.clients.summary(row.clientId, tx) : null;
    return row && client ? { ...row, client } : null;
  }

  private auditTask(
    tx: Transaction,
    actor: AuditActor | null,
    action: 'post.task_linked' | 'post.task_unlinked' | 'post.task_returned',
    postId: string,
    task: Pick<LinkedTask, 'id' | 'title'>,
    extra: Record<string, unknown> = {},
  ) {
    return recordAudit(tx, {
      actor,
      action,
      entityType: 'post',
      entityId: postId,
      after: { taskId: task.id, title: task.title, ...extra },
    });
  }
}
