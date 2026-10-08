import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  businessDate,
  type CalendarDate,
  type ContentCalendar,
  type ContentCalendarQuery,
  type CreatePost,
  type DuplicatePost,
  isPostContentEditable,
  isPostOpen,
  isPostOverdue,
  type MyContentSummary,
  POST_CONTENT_FIELDS,
  POST_STATUSES,
  type Post,
  type PostDetail,
  type PostListQuery,
  type PostPage,
  type PostStatus,
  type PublishedLink,
  permissionScopes,
  type UpdatePost,
} from '@vertex-hub/contracts';
import {
  contentPosts,
  type Database,
  postClientResponses,
  postReviews,
  type Transaction,
} from '@vertex-hub/db';
import {
  and,
  asc,
  count,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, lockAccessChanges, UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { countedTwice, PostTasks } from '../tasks/index.js';
import {
  actorOf,
  assertPostWritable,
  coversClient,
  holdsAll,
  type PostAccess,
  type PostRow,
  postPermissions,
  postRights,
  readablePost,
} from './post-access.js';
import { PostMedia } from './post-media.js';
import { PostNotices, toTimeOfDay } from './post-notices.js';
import { PostReviewHooks } from './post-review-hooks.js';
import { PostReviews } from './post-reviews.js';

type Executor = Database | Transaction;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** The statuses a publish date still matters for: reminders and the overdue mark. */
const TO_PUBLISH: PostStatus[] = ['approved', 'scheduled'];

const countWhere = (condition: SQL) =>
  sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

/** The pass that cleared the post for the client is a medical one (rule 20). */
const clearedByMedicalSql = sql<boolean>`exists (
  select 1 from ${postReviews} as p
  where p.id = "content_posts"."cleared_review_id" and p.stage = 'medical')`;

/**
 * SQL over a row of `content_posts`: the latest review or client response sent the post back
 * (My posts, "Returned to me"); a post reopened after an approval is not one.
 */
const returnedSql = sql`${contentPosts.status} = 'in_production' and coalesce((
  select event.returned from (
    select ${postReviews.outcome} = 'returned' as returned, ${postReviews.createdAt} as at
      from ${postReviews} where ${postReviews.postId} = ${contentPosts.id}
    union all
    select ${postClientResponses.decision} = 'changes_requested', ${postClientResponses.createdAt}
      from ${postClientResponses} where ${postClientResponses.postId} = ${contentPosts.id}
  ) event order by event.at desc limit 1), false)`;

/** The fields of a post an audit entry names; the caption and hashtags as lengths only. */
function auditFields(fields: Record<string, unknown>): Record<string, unknown> {
  const { caption, hashtags, ...rest } = fields;
  return {
    ...rest,
    ...('caption' in fields && { captionLength: (caption as string | null)?.length ?? 0 }),
    ...('hashtags' in fields && { hashtagsLength: (hashtags as string | null)?.length ?? 0 }),
  };
}

/** Posts of the content calendar (spec F08): calendar, lists, detail, create, edit, archive. */
@Injectable()
export class ContentService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly media: PostMedia,
    private readonly tasks: PostTasks,
    private readonly reviews: PostReviews,
    private readonly notices: PostNotices,
    private readonly reviewHooks: PostReviewHooks,
  ) {}

  async calendar(actor: CurrentUserInfo, query: ContentCalendarQuery): Promise<ContentCalendar> {
    const now = new Date();
    const { status, ...others } = query;
    const range = [
      this.visibleSql(),
      gte(contentPosts.publishDate, query.from),
      lte(contentPosts.publishDate, query.to),
      ...this.filters(actor, others),
    ];
    const [rows, counted] = await Promise.all([
      this.db
        .select()
        .from(contentPosts)
        .where(and(...range, status && inArray(contentPosts.status, status)))
        .orderBy(...this.publishOrder()),
      this.db
        .select({ status: contentPosts.status, value: count() })
        .from(contentPosts)
        .where(and(...range))
        .groupBy(contentPosts.status),
    ]);
    const counts = Object.fromEntries(POST_STATUSES.map((s) => [s, 0])) as Record<
      PostStatus,
      number
    >;
    for (const row of counted) counts[row.status] = row.value;
    return { from: query.from, to: query.to, posts: await this.present(rows, now), counts };
  }

  async list(actor: CurrentUserInfo, query: PostListQuery): Promise<PostPage> {
    if (query.archived && !holdsAll(actor, 'content.review')) throw new ForbiddenException();
    const now = new Date();
    const filters: (SQL | undefined)[] = [
      query.archived ? isNotNull(contentPosts.archivedAt) : this.visibleSql(),
      ...this.filters(actor, query),
      query.status && inArray(contentPosts.status, query.status),
      query.from ? gte(contentPosts.publishDate, query.from) : undefined,
      query.to ? lte(contentPosts.publishDate, query.to) : undefined,
      query.q ? ilike(contentPosts.title, `%${escapeLike(query.q)}%`) : undefined,
      query.view ? this.viewSql(actor, query.view, businessDate(now)) : undefined,
    ];
    const where = and(...filters);
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(contentPosts)
        .where(where)
        .orderBy(...this.publishOrder())
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(contentPosts).where(where),
    ]);
    return {
      items: await this.present(rows, now),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Counts for the sections of My posts. */
  async summary(actor: CurrentUserInfo): Promise<MyContentSummary> {
    const today = businessDate();
    const toReview = this.reviewScopeSql(actor);
    const [row] = await this.db
      .select({
        publishToday: countWhere(this.viewSql(actor, 'publish_today', today)),
        overdue: countWhere(this.viewSql(actor, 'overdue', today)),
        returned: countWhere(this.viewSql(actor, 'returned', today)),
        toReview: toReview ? countWhere(this.viewSql(actor, 'to_review', today)) : sql<null>`null`,
      })
      .from(contentPosts)
      .where(this.visibleSql());
    return row ?? { publishToday: 0, overdue: 0, returned: 0, toReview: toReview ? 0 : null };
  }

  async detail(actor: CurrentUserInfo, id: string): Promise<PostDetail> {
    const post = await readablePost(this.db, this.clients, actor, id);
    const now = new Date();
    const [[item], content, review, clearedStage, responsibleAccess, cycleLine, pending] =
      await Promise.all([
        this.present([post], now),
        this.reviews.content(this.db, post),
        this.reviews.detail(post),
        this.reviews.clearedStage(this.db, post),
        this.users.access(post.responsibleId),
        this.cycleLineOf(post),
        this.reviewHooks.pending([id], this.db),
      ]);
    if (!item) throw new Error(`Post ${id} was not presented`);
    const [people, taskLines] = await Promise.all([
      this.users.summaries([
        post.createdById,
        ...(post.publishedById ? [post.publishedById] : []),
        ...content.tasks.flatMap((task) => (task.assigneeId ? [task.assigneeId] : [])),
      ]),
      this.engagements.cycleLines(
        content.tasks.flatMap((task) => (task.cycleLineId ? [task.cycleLineId] : [])),
      ),
    ]);
    const person = (userId: string) => ({ id: userId, name: people.get(userId)?.name ?? '' });
    const pendingApproval = pending.get(id) ?? null;
    return {
      ...item,
      client: { id: post.client.id, name: post.client.name, healthcare: post.client.isHealthcare },
      responsible: {
        ...item.responsible,
        inScope:
          !!responsibleAccess &&
          coversClient(
            { id: post.responsibleId, access: responsibleAccess },
            'content.manage',
            post.client,
          ),
      },
      caption: post.caption,
      hashtags: post.hashtags,
      notes: post.notes,
      needsClientApproval: post.needsClientApproval,
      media: content.media,
      linkedTasks: content.tasks.map((task) => {
        const line = task.cycleLineId ? taskLines.get(task.cycleLineId) : undefined;
        return {
          id: task.id,
          title: task.title,
          department: task.department,
          assignee: task.assigneeId ? (people.get(task.assigneeId) ?? null) : null,
          status: task.status,
          cycleLine: line ? { id: line.id, kind: line.kind, label: line.label } : null,
        };
      }),
      cycleLine,
      contentToken: content.token,
      ...review,
      pendingApproval: pendingApproval && {
        requestId: pendingApproval.requestId,
        state: pendingApproval.state,
        issuedAt: pendingApproval.issuedAt.toISOString(),
        expiresAt: pendingApproval.expiresAt.toISOString(),
      },
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
      publishedAt: post.publishedAt?.toISOString() ?? null,
      publishedBy: post.publishedById ? person(post.publishedById) : null,
      publishedLinks: post.publishedLinks,
      cancelledAt: post.cancelledAt?.toISOString() ?? null,
      cancelReason: post.cancelReason,
      createdBy: person(post.createdById),
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      archivedAt: post.archivedAt?.toISOString() ?? null,
      readOnly: !!post.archivedAt || post.client.archived,
      ...postPermissions(actor, post, content.hasWork, {
        waiting: pendingApproval?.state === 'open',
        clearedStage,
      }),
    };
  }

  async create(actor: CurrentUserInfo, input: CreatePost): Promise<PostDetail> {
    const id = await this.db.transaction(async (tx) => {
      // The responsible person is checked under the lock user archiving takes (rule 28).
      await lockAccessChanges(tx);
      const client = await this.activeClient(tx, actor, input.clientId);
      if (input.publishDate < businessDate()) {
        throw new CodedException(400, 'INVALID_DATES', 'The publish date is in the past');
      }
      const responsibleId = input.responsibleId ?? actor.id;
      await this.assertResponsible(tx, responsibleId, client);
      if (input.cycleLineId) await this.assertCycleLine(tx, client.id, input.cycleLineId);
      const [post] = await tx
        .insert(contentPosts)
        .values({
          clientId: client.id,
          title: input.title,
          type: input.type,
          platforms: input.platforms,
          caption: input.caption ?? null,
          hashtags: input.hashtags ?? null,
          notes: input.notes ?? null,
          publishDate: input.publishDate,
          publishTime: input.publishTime ?? null,
          needsClientApproval: input.needsClientApproval,
          responsibleId,
          cycleLineId: input.cycleLineId,
          createdById: actor.id,
        })
        .returning();
      if (!post) throw new Error('Post insert returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'post.created',
        entityType: 'post',
        entityId: post.id,
        after: auditFields(this.editable(post)),
      });
      await this.notices.send(tx, [
        this.notices.notice({ ...post, client }, 'post_assigned', [responsibleId], actor.id),
      ]);
      return post.id;
    });
    return this.detail(actor, id);
  }

  /** Rule 3: which fields change in which status. */
  async update(actor: CurrentUserInfo, id: string, input: UpdatePost): Promise<PostDetail> {
    await this.db.transaction(async (tx) => {
      if (input.responsibleId) await lockAccessChanges(tx);
      const post = await readablePost(tx, this.clients, actor, id, { forUpdate: true });
      if (!postRights(actor, post.client).edit) throw new ForbiddenException();
      assertPostWritable(post);
      const wanted = {
        ...input,
        ...(input.publishedAt && { publishedAt: new Date(input.publishedAt).toISOString() }),
      };
      const diff = changedFields(this.editable(post), wanted);
      if (!diff) return;
      const changed = Object.keys(diff.after) as (keyof typeof wanted)[];
      const publishing = changed.filter((key) => key === 'publishedAt' || key === 'publishedLinks');
      const locked =
        post.status === 'cancelled' ||
        (post.status === 'published'
          ? publishing.length < changed.length
          : publishing.length > 0 ||
            (!isPostContentEditable(post.status) &&
              changed.some((key) => (POST_CONTENT_FIELDS as readonly string[]).includes(key))));
      if (locked) {
        throw new CodedException(
          409,
          'POST_LOCKED',
          `These fields do not change on a post in ${post.status}`,
        );
      }
      if (
        diff.after.needsClientApproval === false &&
        (post.reviewStage === 'medical' || post.status === 'awaiting_client')
      ) {
        throw new CodedException(
          409,
          'INVALID_TRANSITION',
          'Withdraw the post before removing the client approval',
        );
      }
      if (diff.after.responsibleId) {
        await this.assertResponsible(tx, diff.after.responsibleId, post.client);
      }
      if (diff.after.cycleLineId) {
        await this.assertCycleLine(tx, post.clientId, diff.after.cycleLineId);
        // Rule 16: a unit counts once, through a linked task's line or the post's own.
        const linked = (await this.tasks.linked([id], tx)).get(id) ?? [];
        if (linked.some((task) => task.cycleLineId)) throw countedTwice();
      }
      if (diff.after.publishedAt && new Date(diff.after.publishedAt) > new Date()) {
        throw new CodedException(400, 'INVALID_DATES', 'The publish time is in the future');
      }
      if (diff.after.publishedLinks) assertLinksMatch(diff.after.publishedLinks, post.platforms);
      const { publishedAt, ...fields } = diff.after;
      await tx
        .update(contentPosts)
        .set({ ...fields, ...(publishedAt && { publishedAt: new Date(publishedAt) }) })
        .where(eq(contentPosts.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'post.updated',
        entityType: 'post',
        entityId: id,
        before: auditFields(diff.before),
        after: auditFields(diff.after),
      });
      if (diff.after.responsibleId) {
        await this.notices.send(tx, [
          this.notices.notice(
            { ...post, ...fields },
            'post_assigned',
            [diff.after.responsibleId],
            actor.id,
          ),
        ]);
      }
    });
    return this.detail(actor, id);
  }

  /** Rule 4: a new `idea` post of the same client, without files, line or history. */
  async duplicate(actor: CurrentUserInfo, id: string, input: DuplicatePost): Promise<PostDetail> {
    const copyId = await this.db.transaction(async (tx) => {
      const source = await readablePost(tx, this.clients, actor, id);
      const client = await this.activeClient(tx, actor, source.clientId);
      // A copy is a new post: never in the past, as on create.
      const publishDate = input.publishDate ?? source.publishDate;
      if (publishDate < businessDate()) {
        throw new CodedException(400, 'INVALID_DATES', 'The publish date is in the past');
      }
      const [copy] = await tx
        .insert(contentPosts)
        .values({
          clientId: source.clientId,
          title: source.title,
          type: source.type,
          platforms: source.platforms,
          caption: source.caption,
          hashtags: source.hashtags,
          notes: source.notes,
          publishDate,
          publishTime: source.publishTime,
          needsClientApproval: source.needsClientApproval,
          responsibleId: actor.id,
          createdById: actor.id,
        })
        .returning();
      if (!copy) throw new Error('Post insert returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'post.duplicated',
        entityType: 'post',
        entityId: copy.id,
        after: {
          fromPostId: id,
          title: copy.title,
          clientId: client.id,
          publishDate: copy.publishDate,
        },
      });
      return copy.id;
    });
    return this.detail(actor, copyId);
  }

  /** Archived = entered by mistake: hidden from calendars and counts, read-only. */
  async archive(actor: CurrentUserInfo, id: string): Promise<void> {
    await this.setArchived(actor, id, true);
  }

  async restore(actor: CurrentUserInfo, id: string): Promise<PostDetail> {
    await this.setArchived(actor, id, false);
    return this.detail(actor, id);
  }

  private async setArchived(actor: CurrentUserInfo, id: string, archived: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      // A restore must not hand an open post back to an archived user (rule 28): it waits for
      // user archiving, which checks open posts under the same lock, taken first.
      if (!archived) await lockAccessChanges(tx);
      const post = await readablePost(tx, this.clients, actor, id, { forUpdate: true });
      if (!holdsAll(actor, 'content.review')) throw new ForbiddenException();
      if (!!post.archivedAt === archived) return;
      if (
        !archived &&
        isPostOpen(post.status) &&
        !(await this.users.activeUser(post.responsibleId, tx))
      ) {
        throw new CodedException(
          400,
          'INVALID_RESPONSIBLE',
          'The responsible person is archived: the post cannot be restored to them',
        );
      }
      await tx
        .update(contentPosts)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(contentPosts.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: archived ? 'post.archived' : 'post.restored',
        entityType: 'post',
        entityId: id,
        after: { title: post.title, clientId: post.clientId },
      });
      // Rule 25: an archived post is no longer with the client.
      if (archived && post.status === 'awaiting_client') {
        await this.reviewHooks.left(tx, { postId: id, actor: actorOf(actor), response: null });
      }
    });
  }

  /** SQL over a row of `content_posts`: shown in calendars and counts (rule 2). */
  visibleSql(): SQL {
    return and(isNull(contentPosts.archivedAt), this.clients.isLive(contentPosts.clientId)) as SQL;
  }

  /**
   * SQL over a row of `content_posts`: ready to send to the client (rule 20): awaiting the
   * client, without a pending item in an open request, and for a healthcare client cleared by a
   * medical pass.
   */
  readyToSendSql(): SQL {
    return and(
      eq(contentPosts.status, 'awaiting_client'),
      sql`not ${this.reviewHooks.waitingSql(contentPosts.id)}`,
      or(sql`not ${this.clients.isHealthcare(contentPosts.clientId)}`, clearedByMedicalSql),
    ) as SQL;
  }

  /**
   * SQL over a row of `content_posts`: under the actor's review scope; null when the actor does
   * not hold `content.review` at all.
   */
  private reviewScopeSql(actor: CurrentUserInfo): SQL | null {
    const scopes = permissionScopes(actor.access, 'content.review');
    if (scopes.includes('all')) return sql`true`;
    if (scopes.includes('own_clients')) {
      return this.clients.managedBy(contentPosts.clientId, actor.id);
    }
    return null;
  }

  /** The sections of My posts (`POST_VIEWS`). */
  private viewSql(
    actor: CurrentUserInfo,
    view: NonNullable<PostListQuery['view']>,
    today: CalendarDate,
  ): SQL {
    const mine = eq(contentPosts.responsibleId, actor.id);
    const toPublish = inArray(contentPosts.status, TO_PUBLISH);
    switch (view) {
      case 'publish_today':
        return and(mine, toPublish, eq(contentPosts.publishDate, today)) as SQL;
      case 'overdue':
        return and(mine, toPublish, lt(contentPosts.publishDate, today)) as SQL;
      case 'returned':
        return and(mine, returnedSql) as SQL;
      case 'to_review':
        return and(
          eq(contentPosts.reviewStage, 'internal'),
          this.reviewScopeSql(actor) ?? sql`false`,
        ) as SQL;
    }
  }

  /** The filters the calendar and the list share. */
  private filters(
    actor: CurrentUserInfo,
    query: Pick<PostListQuery, 'clientId' | 'platform' | 'type' | 'responsible' | 'reviewStage'>,
  ): (SQL | undefined)[] {
    return [
      holdsAll(actor, 'content.read') ? undefined : sql`false`,
      query.clientId ? eq(contentPosts.clientId, query.clientId) : undefined,
      query.platform ? sql`${query.platform} = any(${contentPosts.platforms})` : undefined,
      query.type ? eq(contentPosts.type, query.type) : undefined,
      query.responsible
        ? eq(contentPosts.responsibleId, query.responsible === 'me' ? actor.id : query.responsible)
        : undefined,
      query.reviewStage ? eq(contentPosts.reviewStage, query.reviewStage) : undefined,
    ];
  }

  /** By publish date, then time (posts without one last). */
  publishOrder() {
    return [
      asc(contentPosts.publishDate),
      sql`${contentPosts.publishTime} asc nulls last`,
      asc(contentPosts.id),
    ];
  }

  /** List items for post rows, with their people, media and linked tasks. */
  async present(rows: PostRow[], now: Date): Promise<Post[]> {
    const [clients, people, work] = await Promise.all([
      this.clients.summaries(rows.map((row) => row.clientId)),
      this.users.summaries(rows.map((row) => row.responsibleId)),
      this.media.of(rows.map((row) => row.id)),
    ]);
    return rows.map((row) => ({
      id: row.id,
      client: { id: row.clientId, name: clients.get(row.clientId)?.name ?? '' },
      title: row.title,
      type: row.type,
      platforms: row.platforms,
      publishDate: row.publishDate,
      publishTime: toTimeOfDay(row.publishTime),
      status: row.status,
      reviewStage: row.reviewStage,
      responsible: people.get(row.responsibleId) ?? {
        id: row.responsibleId,
        name: '',
        archived: true,
      },
      thumbnailVersionId:
        work.get(row.id)?.media.find((version) => version.previewStatus === 'ready')?.id ?? null,
      linkedTaskCount: work.get(row.id)?.tasks.length ?? 0,
      overdue: isPostOverdue(row, now),
    }));
  }

  /** The fields `update` may change, as the contract names and shapes them. */
  private editable(post: PostRow) {
    return {
      title: post.title,
      type: post.type,
      platforms: post.platforms,
      publishDate: post.publishDate,
      publishTime: toTimeOfDay(post.publishTime),
      caption: post.caption,
      hashtags: post.hashtags,
      notes: post.notes,
      needsClientApproval: post.needsClientApproval,
      responsibleId: post.responsibleId,
      cycleLineId: post.cycleLineId,
      publishedAt: post.publishedAt?.toISOString() ?? null,
      publishedLinks: post.publishedLinks,
    };
  }

  /** Rule 2: a non-archived client that is not ended, under the actor's edit scope. */
  private async activeClient(
    tx: Transaction,
    actor: CurrentUserInfo,
    clientId: string,
  ): Promise<ClientSummary> {
    const client = await this.clients.summary(clientId, tx);
    if (!client) throw new BadRequestException('Unknown client');
    if (!postRights(actor, client).edit) throw new ForbiddenException();
    if (client.archived) throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
    if (client.status === 'ended') {
      throw new CodedException(409, 'CLIENT_ENDED', 'Posts are not added for an ended client');
    }
    return client;
  }

  /** A non-archived user whose `content.manage` covers the client. */
  private async assertResponsible(
    tx: Transaction,
    userId: string,
    client: ClientSummary,
  ): Promise<void> {
    const access = await this.users.access(userId, tx);
    if (!access || !coversClient({ id: userId, access }, 'content.manage', client)) {
      throw new CodedException(
        400,
        'INVALID_RESPONSIBLE',
        'The responsible person edits the content of this client',
      );
    }
  }

  /** Rule 16: a line of an open cycle of a retainer of the post's client. */
  private async assertCycleLine(executor: Executor, clientId: string, lineId: string) {
    const line = (await this.engagements.cycleLines([lineId], executor)).get(lineId);
    const cycle =
      line && (await this.engagements.cycles([line.cycleId], executor)).get(line.cycleId);
    if (!cycle || cycle.clientId !== clientId || cycle.retainerArchived) {
      throw new CodedException(400, 'INVALID_LINK', 'The line is not of a retainer of this client');
    }
    if (cycle.status !== 'open') {
      throw new CodedException(409, 'CYCLE_CLOSED', 'The cycle of this line is closed');
    }
  }

  private async cycleLineOf(post: PostAccess): Promise<PostDetail['cycleLine']> {
    if (!post.cycleLineId) return null;
    const line = (await this.engagements.cycleLines([post.cycleLineId])).get(post.cycleLineId);
    const cycle = line && (await this.engagements.cycles([line.cycleId])).get(line.cycleId);
    if (!line || !cycle) return null;
    return {
      id: line.id,
      kind: line.kind,
      label: line.label,
      retainer: { id: cycle.retainerId, name: cycle.retainerName },
    };
  }
}

/** At most one link per platform of the post (data table). */
export function assertLinksMatch(links: PublishedLink[], platforms: readonly string[]): void {
  if (links.some((link) => !platforms.includes(link.platform))) {
    throw new BadRequestException('A published link names a platform of the post');
  }
}
