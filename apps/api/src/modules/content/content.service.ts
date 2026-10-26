import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  addDays,
  businessDate,
  type CalendarDate,
  type ContentCalendar,
  type ContentCalendarQuery,
  type CreatePost,
  captionGroupsOf,
  type DuplicatePost,
  type ErrorCode,
  type ErrorResponse,
  type Following,
  type HolidayRange,
  isPostContentEditable,
  isPostOpen,
  isPostOverdue,
  MEDIA_LAYOUT_LIMIT,
  type MyContentSummary,
  nthWorkDay,
  PLANNING_RULES,
  POST_CONTENT_FIELDS,
  POST_LIMITS,
  POST_STATUSES,
  type Post,
  type PostCaption,
  type PostChange,
  type PostDetail,
  type PostListQuery,
  type PostPage,
  type PostStatus,
  type PublishedLink,
  permissionScopes,
  type UpdatePost,
  type UpdatePostLayout,
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
  between,
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
import {
  type CurrentUserInfo,
  lockAccessChanges,
  personRef,
  UserDirectory,
} from '../auth/index.js';
import { ClientDirectory, type ClientSummary, clientRef } from '../clients/index.js';
import { FileAttachments } from '../files/index.js';
import { HolidayCalendar } from '../hr/index.js';
import { type Notice, RecordFollowers } from '../notifications/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { countedTwice, PostTasks, type ShiftedTask } from '../tasks/index.js';
import { ContentIdeasService } from './content-ideas.service.js';
import { ContentOccasionsService } from './content-occasions.service.js';
import { ContentPlanner } from './content-planner.js';
import { ContentSettingsService } from './content-settings.service.js';
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
import { captionLengths, PostCaptions } from './post-captions.js';
import { PostMedia } from './post-media.js';
import { PostNotices, toTimeOfDay } from './post-notices.js';
import { PostReviewHooks } from './post-review-hooks.js';
import { contentChecks, PostReviews } from './post-reviews.js';

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

/** F08B rule B2: the part of the wizard's save an error belongs to. */
type Part = { part: 'captions' | 'files' | 'tasks' | 'links'; index: number };

/**
 * F08B rule B2: a coded error thrown while saving one part of the wizard names that part in its
 * `details`, so the wizard opens its step; an error that names a part already (a subtask of a new
 * task) keeps its own details under `cause`.
 */
async function inPart<T>(part: Part, save: () => Promise<T>): Promise<T> {
  try {
    return await save();
  } catch (error) {
    const body = error instanceof HttpException ? (error.getResponse() as ErrorResponse) : null;
    if (body?.code && error instanceof HttpException) {
      throw new CodedException(
        error.getStatus() as ConstructorParameters<typeof CodedException>[0],
        body.code as ErrorCode,
        body.message,
        { ...part, ...(body.details !== undefined && { cause: body.details }) },
      );
    }
    throw error;
  }
}

/** Open, not yet approved: what `post_at_risk` and the "At risk" view watch (F08B). */
const NOT_APPROVED: PostStatus[] = ['idea', 'in_production', 'internal_review', 'awaiting_client'];

/** With the client or past it: the account manager hears of a move (F08B `post_moved`). */
const WITH_CLIENT: PostStatus[] = ['awaiting_client', 'approved', 'scheduled'];

/** F08B `post_at_risk`: the last publish date the check covers from `today`. */
export const atRiskUntil = (today: CalendarDate, holidays: readonly HolidayRange[]) =>
  nthWorkDay(addDays(today, 1), PLANNING_RULES.atRiskWorkDays, holidays);

/** Rule 3 and F08B rule A1: the content changes only in `idea` and `in_production`. */
const contentLocked = (status: PostStatus) =>
  new CodedException(409, 'POST_LOCKED', `The content does not change on a post in ${status}`);

/** A layout as an audit entry keeps it: the order and the slide caption lengths. */
const layoutAudit = (items: readonly { fileItemId: string; caption: string | null }[]) => ({
  layout: items.map((item) => ({
    fileItemId: item.fileItemId,
    captionLength: item.caption?.length ?? 0,
  })),
});

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
    private readonly followers: RecordFollowers,
    private readonly captions: PostCaptions,
    private readonly attachments: FileAttachments,
    private readonly settings: ContentSettingsService,
    private readonly occasions: ContentOccasionsService,
    private readonly ideas: ContentIdeasService,
    private readonly planner: ContentPlanner,
    private readonly holidays: HolidayCalendar,
  ) {}

  /** F16 rule B12: whether the actor follows a post they may read. */
  async following(actor: CurrentUserInfo, id: string): Promise<Following> {
    await readablePost(this.db, this.clients, actor, id);
    return this.followers.following({ type: 'post', id }, actor.id);
  }

  /** F16 rule B12: anyone who may read the post follows or unfollows it by hand. */
  async setFollowing(actor: CurrentUserInfo, id: string, following: boolean): Promise<Following> {
    await readablePost(this.db, this.clients, actor, id);
    return this.followers.setFollowing({ type: 'post', id }, actor.id, following);
  }

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
    const [posts, overlays] = await Promise.all([
      this.present(rows, now),
      this.planner.calendarOverlays(query.from, query.to, query.clientId),
    ]);
    return { from: query.from, to: query.to, posts, counts, ...overlays };
  }

  async list(actor: CurrentUserInfo, query: PostListQuery): Promise<PostPage> {
    if (query.archived && !holdsAll(actor, 'content.review')) throw new ForbiddenException();
    const now = new Date();
    const today = businessDate(now);
    const filters: (SQL | undefined)[] = [
      query.archived ? isNotNull(contentPosts.archivedAt) : this.visibleSql(),
      ...this.filters(actor, query),
      query.status && inArray(contentPosts.status, query.status),
      query.from ? gte(contentPosts.publishDate, query.from) : undefined,
      query.to ? lte(contentPosts.publishDate, query.to) : undefined,
      query.q ? ilike(contentPosts.title, `%${escapeLike(query.q)}%`) : undefined,
      query.view
        ? this.viewSql(
            actor,
            query.view,
            today,
            atRiskUntil(today, await this.holidays.from(today)),
          )
        : undefined,
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
    const until = atRiskUntil(today, await this.holidays.from(today));
    const view = (name: NonNullable<PostListQuery['view']>) =>
      this.viewSql(actor, name, today, until);
    const toReview = this.reviewScopeSql(actor);
    const [row] = await this.db
      .select({
        publishToday: countWhere(view('publish_today')),
        overdue: countWhere(view('overdue')),
        returned: countWhere(view('returned')),
        atRisk: countWhere(view('at_risk')),
        toReview: toReview ? countWhere(view('to_review')) : sql<null>`null`,
      })
      .from(contentPosts)
      .where(this.visibleSql());
    return (
      row ?? { publishToday: 0, overdue: 0, returned: 0, atRisk: 0, toReview: toReview ? 0 : null }
    );
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
    const [people, taskLines, planning, occasion] = await Promise.all([
      this.users.summaries([
        post.createdById,
        ...(post.publishedById ? [post.publishedById] : []),
        ...content.tasks.flatMap((task) => (task.assigneeId ? [task.assigneeId] : [])),
      ]),
      this.engagements.cycleLines(
        content.tasks.flatMap((task) => (task.cycleLineId ? [task.cycleLineId] : [])),
      ),
      this.settings.planningSettings(post.client),
      post.occasionId
        ? this.occasions.refs([post.occasionId]).then((refs) => refs.get(post.occasionId ?? ''))
        : undefined,
    ]);
    const person = (userId: string) => personRef(people, userId);
    const pendingApproval = pending.get(id) ?? null;
    return {
      ...item,
      client: {
        id: post.client.id,
        name: post.client.name,
        imageId: post.client.imageId,
        healthcare: post.client.isHealthcare,
      },
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
      captions: content.captions,
      notes: post.notes,
      needsClientApproval: post.needsClientApproval,
      media: content.media,
      checks: contentChecks(post, content, planning),
      occasion: occasion ?? null,
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

  /**
   * F08 rules 2 and 16, F08B rules B1–B3: the post with its captions, held files and their slide
   * captions, the links of existing tasks, new tasks with their subtasks and the idea it comes
   * from, in one transaction; one failing part saves nothing and the error names it. A post with
   * a linked or new task starts in production.
   */
  async create(actor: CurrentUserInfo, input: CreatePost): Promise<PostDetail> {
    const { id, preview } = await this.db.transaction(async (tx) => {
      // The responsible person is checked under the lock user archiving takes (rule 28).
      await lockAccessChanges(tx);
      const client = await this.activeClient(tx, actor, input.clientId);
      if (input.publishDate < businessDate()) {
        throw new CodedException(400, 'INVALID_DATES', 'The publish date is in the past');
      }
      const responsibleId = input.responsibleId ?? actor.id;
      await this.assertResponsible(tx, responsibleId, client);
      if (input.cycleLineId) await this.assertCycleLine(tx, client.id, input.cycleLineId);
      await this.assertPlanningLinks(tx, client, input);
      if (input.linkTaskIds.length + input.tasks.length > POST_LIMITS.tasks) {
        throw new CodedException(
          409,
          'LIMIT_REACHED',
          `A post links at most ${POST_LIMITS.tasks} tasks`,
        );
      }
      const withTasks = input.linkTaskIds.length + input.tasks.length > 0;
      const [post] = await tx
        .insert(contentPosts)
        .values({
          clientId: client.id,
          title: input.title,
          type: input.type,
          platforms: input.platforms,
          notes: input.notes ?? null,
          publishDate: input.publishDate,
          publishTime: input.publishTime ?? null,
          status: withTasks ? 'in_production' : 'idea',
          needsClientApproval: input.needsClientApproval,
          responsibleId,
          cycleLineId: input.cycleLineId,
          pillarId: input.pillarId,
          occasionId: input.occasionId,
          createdById: actor.id,
        })
        .returning();
      if (!post) throw new Error('Post insert returned no row');
      const captions = await inPart({ part: 'captions', index: 0 }, async () => {
        const written = this.captions.changes([], post.platforms, input.captions)?.after ?? [];
        await this.captions.write(tx, post.id, written);
        await this.captions.sync(tx, post.id, post.platforms);
        return written;
      });

      let preview = false;
      const names = new Set<string>();
      const layout: { fileItemId: string; caption: string | null }[] = [];
      for (const [index, file] of input.files.entries()) {
        const attached = await inPart({ part: 'files', index }, () =>
          this.attachments.attachToPost(
            tx,
            actor,
            { postId: post.id, clientId: client.id },
            [file],
            names,
          ),
        );
        preview ||= attached.preview;
        layout.push(
          ...attached.itemIds.map((fileItemId) => ({ fileItemId, caption: file.slideCaption })),
        );
      }
      if (layout.some((slide) => slide.caption)) {
        await tx
          .update(contentPosts)
          .set({ mediaLayout: layout })
          .where(eq(contentPosts.id, post.id));
      }

      const ref = { id: post.id, clientId: client.id, cycleLineId: post.cycleLineId };
      const taskIds: string[] = [];
      for (const [index, taskId] of input.linkTaskIds.entries()) {
        const linked = await inPart({ part: 'links', index }, () =>
          this.tasks.link(tx, ref, taskId, actorOf(actor)),
        );
        taskIds.push(linked.id);
      }
      for (const [index, task] of input.tasks.entries()) {
        const created = await inPart({ part: 'tasks', index }, () =>
          this.tasks.createFull(
            tx,
            ref,
            { ...task, acceptLeave: task.acceptLeave ?? input.acceptLeave },
            actor,
          ),
        );
        preview ||= created.preview;
        taskIds.push(created.task.id);
      }

      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'post.created',
        entityType: 'post',
        entityId: post.id,
        after: {
          ...this.editable(post),
          captions: captionLengths(captions),
          ...(input.files.length > 0 && { files: input.files.length }),
          ...(taskIds.length > 0 && { taskIds }),
          ...(input.ideaId && { ideaId: input.ideaId }),
        },
      });
      const noticePost = { ...post, client };
      if (input.ideaId) await this.ideas.use(tx, actor, input.ideaId, noticePost);
      await this.notices.send(tx, [
        this.notices.notice(noticePost, 'post_assigned', [responsibleId], actor.id),
      ]);
      // F16 rule B12: the creator and the responsible follow the post.
      await this.notices.follow(tx, post.id, [actor.id, responsibleId]);
      return { id: post.id, preview };
    });
    if (preview) await this.attachments.queuePreviews();
    return this.detail(actor, id);
  }

  /** F08B rules C1 and C6: a live pillar, and an occasion that applies to the client. */
  private async assertPlanningLinks(
    tx: Transaction,
    client: ClientSummary,
    input: { pillarId?: string | null; occasionId?: string | null },
  ): Promise<void> {
    if (input.pillarId) await this.settings.assertLivePillar(tx, input.pillarId);
    if (input.occasionId) {
      const settings = await this.settings.planningSettings(client, tx);
      await this.occasions.assertUsable(tx, input.occasionId, { id: client.id, settings });
    }
  }

  /** Rule 3: which fields change in which status. */
  async update(actor: CurrentUserInfo, id: string, input: UpdatePost): Promise<PostDetail> {
    await this.db.transaction(async (tx) => {
      if (input.responsibleId) await lockAccessChanges(tx);
      const post = await readablePost(tx, this.clients, actor, id, { forUpdate: true });
      if (!postRights(actor, post.client).edit) throw new ForbiddenException();
      assertPostWritable(post);
      const { captions: captionInputs, ...fields } = input;
      const wanted = {
        ...fields,
        ...(fields.publishedAt && { publishedAt: new Date(fields.publishedAt).toISOString() }),
      };
      const diff = changedFields(this.editable(post), wanted);
      const platforms = diff?.after.platforms ?? post.platforms;
      const stored = (await this.captions.of([id], tx)).get(id) ?? [];
      const captions = captionInputs
        ? this.captions.changes(stored, platforms, captionInputs)
        : null;
      if (!diff && !captions) return;
      const changed = [
        ...(Object.keys(diff?.after ?? {}) as (keyof typeof wanted)[]),
        ...(captions ? (['captions'] as const) : []),
      ];
      const publishing = changed.filter((key) => key === 'publishedAt' || key === 'publishedLinks');
      // F08B rule A2: a platform of a new caption group is content editing.
      const oldGroups = captionGroupsOf(post.platforms);
      const newGroup = captionGroupsOf(platforms).some((group) => !oldGroups.includes(group));
      const locked =
        post.status === 'cancelled' ||
        (post.status === 'published'
          ? publishing.length < changed.length
          : publishing.length > 0 ||
            (!isPostContentEditable(post.status) &&
              (newGroup ||
                changed.some((key) => (POST_CONTENT_FIELDS as readonly string[]).includes(key)))));
      if (locked) {
        throw new CodedException(
          409,
          'POST_LOCKED',
          `These fields do not change on a post in ${post.status}`,
        );
      }
      if (!diff) {
        await this.writeCaptions(tx, actor, post, platforms, captions);
        await this.notices.sendChange(
          tx,
          post,
          actor.id,
          await this.changedNotices(tx, post, ['captions'], actor.id),
        );
        return;
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
      if (diff.after.pillarId || diff.after.occasionId) {
        await this.assertPlanningLinks(tx, post.client, diff.after);
      }
      if (diff.after.publishedAt && new Date(diff.after.publishedAt) > new Date()) {
        throw new CodedException(400, 'INVALID_DATES', 'The publish time is in the future');
      }
      if (diff.after.publishedLinks) assertLinksMatch(diff.after.publishedLinks, post.platforms);
      const { publishedAt, ...changes } = diff.after;
      await tx
        .update(contentPosts)
        .set({ ...changes, ...(publishedAt && { publishedAt: new Date(publishedAt) }) })
        .where(eq(contentPosts.id, id));
      await this.writeCaptions(tx, actor, post, platforms, captions, diff);
      const responsibleId = diff.after.responsibleId;
      if (responsibleId) await this.notices.follow(tx, id, [responsibleId]);
      const after = { ...post, ...changes };
      const notices: Notice[] = [];
      // F16 part C: a new responsible or publish time closes what no longer applies; F08B: the
      // previous responsible is told who holds the post now.
      if (responsibleId) {
        const holder = (await this.users.summaries([responsibleId], tx)).get(responsibleId);
        notices.push(
          this.notices.notice(after, 'post_assigned', [responsibleId], actor.id),
          this.notices.notice(after, 'post_unassigned', [post.responsibleId], actor.id, {
            holder: holder?.name ?? '',
          }),
        );
      }
      // F08B: a new publish date by edit is a move without a shift.
      if (diff.after.publishDate) {
        notices.push(
          await this.movedNotice(
            tx,
            after,
            { date: post.publishDate, time: toTimeOfDay(post.publishTime) },
            [],
            actor.id,
          ),
        );
      }
      const content: PostChange[] = [
        ...(captions ? (['captions'] as const) : []),
        ...(['platforms', 'type', 'title'] as const).filter((key) => key in diff.after),
      ];
      notices.push(...(await this.changedNotices(tx, after, content, actor.id)));
      await this.notices.sendChange(tx, post, actor.id, notices);
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
          // F08B rule A9: the pillar comes along; the occasion and the idea do not.
          pillarId: source.pillarId,
          responsibleId: actor.id,
          createdById: actor.id,
        })
        .returning();
      if (!copy) throw new Error('Post insert returned no row');
      // F08B rule A9: the captions per group, every stored group included.
      await this.captions.write(tx, copy.id, (await this.captions.of([id], tx)).get(id) ?? []);
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

  /**
   * F08B rule A6: the slide order of every current medium (the first 40 when there are more),
   * each with its caption; content editing.
   */
  async setLayout(
    actor: CurrentUserInfo,
    id: string,
    input: UpdatePostLayout,
  ): Promise<PostDetail> {
    await this.db.transaction(async (tx) => {
      const post = await readablePost(tx, this.clients, actor, id, { forUpdate: true });
      if (!postRights(actor, post.client).edit) throw new ForbiddenException();
      assertPostWritable(post);
      if (!isPostContentEditable(post.status)) throw contentLocked(post.status);
      const work = (await this.media.of([id], tx)).get(id);
      const media = [...new Set((work?.media ?? []).map((medium) => medium.fileItemId))];
      const given = input.items.map((item) => item.fileItemId);
      if (
        given.length !== Math.min(media.length, MEDIA_LAYOUT_LIMIT) ||
        given.some((itemId) => !media.includes(itemId))
      ) {
        throw new CodedException(
          400,
          'INVALID_ORDER',
          'The layout lists every medium of the post once',
        );
      }
      const before = (work?.media ?? []).map((medium) => ({
        fileItemId: medium.fileItemId,
        caption: medium.slideCaption,
      }));
      if (JSON.stringify(before.slice(0, given.length)) === JSON.stringify(input.items)) return;
      await tx
        .update(contentPosts)
        .set({ mediaLayout: input.items })
        .where(eq(contentPosts.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'post.layout_changed',
        entityType: 'post',
        entityId: id,
        before: layoutAudit(before),
        after: layoutAudit(input.items),
      });
      await this.notices.sendChange(
        tx,
        post,
        actor.id,
        await this.changedNotices(tx, post, ['slides'], actor.id),
      );
    });
    return this.detail(actor, id);
  }

  /**
   * F08B edge case 5: once a medium left the post (a task unlinked), its slide and slide caption
   * leave the layout, audited.
   */
  async pruneLayout(tx: Transaction, actor: CurrentUserInfo, post: PostRow): Promise<void> {
    if (post.mediaLayout.length === 0) return;
    const media = new Set(
      ((await this.media.of([post.id], tx)).get(post.id)?.media ?? []).map(
        (medium) => medium.fileItemId,
      ),
    );
    const kept = post.mediaLayout.filter((entry) => media.has(entry.fileItemId));
    if (kept.length === post.mediaLayout.length) return;
    await tx.update(contentPosts).set({ mediaLayout: kept }).where(eq(contentPosts.id, post.id));
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'post.layout_changed',
      entityType: 'post',
      entityId: post.id,
      before: layoutAudit(post.mediaLayout),
      after: layoutAudit(kept),
    });
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
      // F16 rule B5: archiving voids what the post still waited for.
      await this.notices.sendChange(tx, post, actor.id);
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
    riskUntil: CalendarDate,
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
      case 'at_risk':
        return and(
          mine,
          inArray(contentPosts.status, NOT_APPROVED),
          between(contentPosts.publishDate, today, riskUntil),
        ) as SQL;
    }
  }

  /** The filters the calendar and the list share. */
  private filters(
    actor: CurrentUserInfo,
    query: Pick<
      PostListQuery,
      'clientId' | 'pillarId' | 'platform' | 'type' | 'responsible' | 'reviewStage'
    >,
  ): (SQL | undefined)[] {
    return [
      holdsAll(actor, 'content.read') ? undefined : sql`false`,
      query.clientId ? eq(contentPosts.clientId, query.clientId) : undefined,
      query.pillarId ? eq(contentPosts.pillarId, query.pillarId) : undefined,
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
    const [clients, people, work, pillars] = await Promise.all([
      this.clients.summaries(rows.map((row) => row.clientId)),
      this.users.summaries(rows.map((row) => row.responsibleId)),
      this.media.of(rows.map((row) => row.id)),
      this.settings.pillarsById(rows.flatMap((row) => row.pillarId ?? [])),
    ]);
    return rows.map((row) => ({
      id: row.id,
      client: clientRef(clients, row.clientId),
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
        imageId: null,
        archived: true,
      },
      thumbnailVersionId:
        work.get(row.id)?.media.find((version) => version.previewStatus === 'ready')?.id ?? null,
      linkedTaskCount: work.get(row.id)?.tasks.length ?? 0,
      overdue: isPostOverdue(row, now),
      pillar: row.pillarId ? (pillars.get(row.pillarId) ?? null) : null,
      occasionId: row.occasionId,
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
      notes: post.notes,
      needsClientApproval: post.needsClientApproval,
      responsibleId: post.responsibleId,
      cycleLineId: post.cycleLineId,
      pillarId: post.pillarId,
      occasionId: post.occasionId,
      publishedAt: post.publishedAt?.toISOString() ?? null,
      publishedLinks: post.publishedLinks,
    };
  }

  /**
   * Writes changed captions and the post's caption extract, and the `post.updated` entry with
   * the changed fields and the captions as lengths per group.
   */
  private async writeCaptions(
    tx: Transaction,
    actor: CurrentUserInfo,
    post: PostRow,
    platforms: PostRow['platforms'],
    captions: { before: PostCaption[]; after: PostCaption[] } | null,
    diff?: { before: Record<string, unknown>; after: Record<string, unknown> },
  ): Promise<void> {
    if (captions) await this.captions.write(tx, post.id, captions.after);
    if (captions || diff?.after.platforms) await this.captions.sync(tx, post.id, platforms);
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'post.updated',
      entityType: 'post',
      entityId: post.id,
      before: { ...diff?.before, ...(captions && { captions: captionLengths(captions.before) }) },
      after: { ...diff?.after, ...(captions && { captions: captionLengths(captions.after) }) },
    });
  }

  /**
   * F08B `post_changed`: content changed by someone other than the responsible tells the
   * responsible and the followers (merged per post and day).
   */
  private async changedNotices(
    tx: Transaction,
    post: PostAccess,
    changes: PostChange[],
    actorId: string,
  ): Promise<Notice[]> {
    if (changes.length === 0 || post.responsibleId === actorId) return [];
    const followers = await this.followers.recipients(
      tx,
      { type: 'post', id: post.id },
      'content.read',
    );
    return [
      this.notices.notice(
        post,
        'post_changed',
        [post.responsibleId, ...followers].filter((id) => id !== actorId),
        actorId,
        { changes },
      ),
    ];
  }

  /**
   * F08B `post_moved`: the responsible, the assignees of the open linked tasks and their open
   * subtasks, and the account manager once the post is with the client or past it, with the old
   * date and the tasks the move shifted.
   */
  async movedNotice(
    tx: Transaction,
    post: PostAccess,
    previous: { date: CalendarDate; time: string | null },
    shifted: readonly ShiftedTask[],
    actorId: string,
  ): Promise<Notice> {
    const today = businessDate();
    const open = await this.tasks.shiftPlan(
      tx,
      post.id,
      0,
      today,
      await this.holidays.from(today, tx),
    );
    return this.notices.notice(
      post,
      'post_moved',
      [
        post.responsibleId,
        ...open.map((task) => task.assigneeId),
        ...(WITH_CLIENT.includes(post.status) ? [post.client.accountManagerId] : []),
      ].filter((id) => id !== actorId),
      actorId,
      {
        previousDate: previous.date,
        previousTime: previous.time,
        shiftedTasks: shifted.slice(0, 30).map((task) => task.title),
      },
    );
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
