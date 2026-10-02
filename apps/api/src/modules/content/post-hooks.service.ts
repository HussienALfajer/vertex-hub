import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { isPostContentEditable, OPEN_POST_STATUSES, type TaskCounts } from '@vertex-hub/contracts';
import { contentPosts, type Database, type Transaction } from '@vertex-hub/db';
import { and, asc, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { type CurrentUserInfo, ResponsibilityRegistry } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { type FileOwner, FileOwnerRegistry } from '../files/index.js';
import { WorkProgress } from '../projects/index.js';
import { holdsAll, isReadOnly, postRights, readablePost } from './post-access.js';

type Executor = Database | Transaction;

/**
 * What posts feed into other modules (spec F08, "Data" and "Changes to earlier features"): the
 * `post` owner policy of `files`, the posts counted directly on a retainer cycle line for
 * `projects` (rule 16), and open posts a user is responsible for, for `auth` (rule 28).
 */
@Injectable()
export class PostHooksService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly files: FileOwnerRegistry,
    private readonly progress: WorkProgress,
    private readonly responsibilities: ResponsibilityRegistry,
  ) {}

  onModuleInit(): void {
    this.files.register('post', {
      find: (executor, actor, id, options) => this.fileOwner(executor, actor, id, options),
      // Post files are in neither the client library nor the documents list (F10 rule 13).
      ownersOfClient: async () => [],
    });
    this.progress.registerCycleLines((ids, executor) => this.lineCounts(ids, executor));
    this.responsibilities.register({
      find: async (tx, userId) => {
        const open = await tx
          .select({ id: contentPosts.id, name: contentPosts.title })
          .from(contentPosts)
          .where(
            and(
              eq(contentPosts.responsibleId, userId),
              inArray(contentPosts.status, [...OPEN_POST_STATUSES]),
              isNull(contentPosts.archivedAt),
            ),
          )
          .orderBy(asc(contentPosts.publishDate), asc(contentPosts.title));
        return open.map((post) => ({ type: 'responsible_for_open_posts' as const, ...post }));
      },
    });
  }

  /**
   * Post files follow the post's read rules; edit scope adds, versions and removes them while
   * the content is unlocked (rule 3).
   */
  private async fileOwner(
    executor: Executor,
    actor: CurrentUserInfo,
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<FileOwner> {
    const post = await readablePost(executor, this.clients, actor, id, options);
    const { edit } = postRights(actor, post.client);
    return {
      type: 'post',
      id: post.id,
      clientId: post.clientId,
      clientName: post.client.name,
      label: post.title,
      archivedCode: isReadOnly(post) ? 'POST_ARCHIVED' : null,
      task: null,
      post: { locked: !isPostContentEditable(post.status) },
      rights: {
        addDeliverable: edit,
        addReference: false,
        manageTask: edit,
        manageDocuments: false,
        confidentialReader: false,
        scopeAll: holdsAll(actor, 'content.review'),
      },
    };
  }

  /**
   * Rule 16: `total` is non-archived, non-cancelled posts on the line; `delivered` published;
   * `ready` approved or scheduled (P2A rule 7).
   */
  private async lineCounts(
    ids: string[],
    executor: Executor = this.db,
  ): Promise<Map<string, TaskCounts>> {
    const rows = await executor
      .select({
        id: sql<string>`${contentPosts.cycleLineId}`,
        total: count(),
        delivered:
          sql<number>`count(*) filter (where ${contentPosts.status} = 'published')`.mapWith(Number),
        ready:
          sql<number>`count(*) filter (where ${contentPosts.status} in ('approved', 'scheduled'))`.mapWith(
            Number,
          ),
      })
      .from(contentPosts)
      .where(
        and(
          inArray(contentPosts.cycleLineId, ids),
          isNull(contentPosts.archivedAt),
          ne(contentPosts.status, 'cancelled'),
        ),
      )
      .groupBy(contentPosts.cycleLineId);
    return new Map(
      rows.map((row) => [
        row.id,
        {
          total: row.total,
          delivered: row.delivered,
          open: row.total - row.delivered,
          ready: row.ready,
        },
      ]),
    );
  }
}
