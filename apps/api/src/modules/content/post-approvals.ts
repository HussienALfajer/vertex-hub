import { Inject, Injectable } from '@nestjs/common';
import {
  type CalendarDate,
  type ClientDecision,
  type ClientResponseEntry,
  type ClientResponsePage,
  firstOfMonth,
  lastOfMonth,
  type PageQuery,
  type PostPlatform,
  type PostType,
  permissionScopes,
  type ReadyPost,
  type TimeOfDay,
} from '@vertex-hub/contracts';
import {
  contentPosts,
  type Database,
  postClientResponses,
  postReviews,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, count, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { FileVersions } from '../files/index.js';
import type { ResponseSummary } from '../tasks/index.js';
import { ContentService } from './content.service.js';
import { PostNotices, toTimeOfDay } from './post-notices.js';

type Executor = Database | Transaction;

type ReviewRow = typeof postReviews.$inferSelect;

/** A client's answer through an approval link, as the `approvals` module passes it. */
export interface PostLinkResponse {
  postId: string;
  /** The pending item it answers, and the snapshot that item sent. */
  itemId: string;
  reviewId: string;
  decision: ClientDecision;
  note: string | null;
  contact: { id: string; name: string };
  ip: string | null;
  userAgent: string | null;
}

/** A post that goes into an approval request, with the snapshot it sends. */
export interface SendablePost {
  id: string;
  title: string;
  reviewId: string;
}

/** What a pass approved: the media in display order and the post as the client is shown it. */
export interface PostSnapshot {
  versionIds: string[];
  caption: string | null;
  hashtags: string | null;
  type: PostType;
  platforms: PostPlatform[];
  publishDate: CalendarDate;
  publishTime: TimeOfDay | null;
}

/**
 * What the `approvals` module reads and changes of posts (spec F08 rules 20–23, ADR 0021): the
 * ready ones, their snapshots, and the response a link records, as `tasks`' `TaskApprovals` does
 * for tasks. The caller locks posts (`lock`) before tasks, the request and its items.
 */
@Injectable()
export class PostApprovals {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly content: ContentService,
    private readonly notices: PostNotices,
    private readonly files: FileVersions,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
  ) {}

  /**
   * The posts ready to send (rule 20) under the actor's client scope, in publish order, each
   * with what its cleared review would send; `month` (`YYYY-MM`) keeps one publish month.
   */
  async ready(
    actor: CurrentUserInfo,
    filter: { clientId?: string; month?: string },
  ): Promise<ReadyPost[]> {
    const scopes = permissionScopes(actor.access, 'tasks.manage');
    const scope = scopes.includes('all')
      ? undefined
      : scopes.includes('own_clients')
        ? this.clients.managedBy(contentPosts.clientId, actor.id)
        : null;
    if (scope === null) return [];
    const monthStart = filter.month ? `${filter.month}-01` : undefined;
    const rows = await this.db
      .select()
      .from(contentPosts)
      .where(
        and(
          this.content.visibleSql(),
          this.content.readyToSendSql(),
          scope,
          filter.clientId ? eq(contentPosts.clientId, filter.clientId) : undefined,
          monthStart ? gte(contentPosts.publishDate, firstOfMonth(monthStart)) : undefined,
          monthStart ? lte(contentPosts.publishDate, lastOfMonth(monthStart)) : undefined,
        ),
      )
      .orderBy(...this.content.publishOrder());
    const [items, snapshots] = await Promise.all([
      this.content.present(rows, new Date()),
      this.snapshots(rows.flatMap((row) => (row.clearedReviewId ? [row.clearedReviewId] : []))),
    ]);
    const versions = await this.files.sent(
      [...snapshots.values()].flatMap((snapshot) => snapshot.versionIds),
    );
    return rows.map((row, index) => {
      const snapshot = row.clearedReviewId ? snapshots.get(row.clearedReviewId) : undefined;
      const sent = (snapshot?.versionIds ?? []).flatMap((id) => versions.get(id) ?? []);
      return {
        ...(items[index] as (typeof items)[number]),
        snapshot: {
          files: sent.length,
          caption: snapshot?.caption ?? null,
          thumbnailVersionId: sent.find((version) => version.previewStatus === 'ready')?.id ?? null,
        },
      };
    });
  }

  /** Locks the post rows, by id: the order every post lock set follows. */
  async lock(tx: Transaction, postIds: readonly string[]): Promise<void> {
    if (postIds.length === 0) return;
    await tx
      .select({ id: contentPosts.id })
      .from(contentPosts)
      .where(inArray(contentPosts.id, [...postIds]))
      .orderBy(asc(contentPosts.id))
      .for('update');
  }

  /**
   * Rule 20, without the pending item (the `approvals` module knows it): locks the posts and
   * checks that each is a live post of the client waiting for it, cleared by a medical pass for a
   * healthcare client. `POST_NOT_READY` or `MEDICAL_REVIEW_REQUIRED` otherwise.
   */
  async sendable(
    tx: Transaction,
    client: ClientSummary,
    postIds: readonly string[],
  ): Promise<SendablePost[]> {
    if (postIds.length === 0) return [];
    await this.lock(tx, postIds);
    const rows = await tx
      .select({
        id: contentPosts.id,
        title: contentPosts.title,
        reviewId: contentPosts.clearedReviewId,
      })
      .from(contentPosts)
      .where(
        and(
          inArray(contentPosts.id, [...postIds]),
          eq(contentPosts.clientId, client.id),
          eq(contentPosts.status, 'awaiting_client'),
          this.content.visibleSql(),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const passes = await this.passes(
      rows.flatMap((row) => (row.reviewId ? [row.reviewId] : [])),
      tx,
    );
    return postIds.map((id) => {
      const row = byId.get(id);
      if (!row?.reviewId) {
        throw new CodedException(409, 'POST_NOT_READY', 'A post is not ready to send', {
          postId: id,
        });
      }
      if (client.isHealthcare && passes.get(row.reviewId)?.stage !== 'medical') {
        throw new CodedException(
          409,
          'MEDICAL_REVIEW_REQUIRED',
          'A post was not cleared by a medical review: withdraw it for re-review',
          { postId: id },
        );
      }
      return { id: row.id, title: row.title, reviewId: row.reviewId };
    });
  }

  /** The snapshots of the given passes, by review id. */
  async snapshots(
    reviewIds: readonly string[],
    executor: Executor = this.db,
  ): Promise<Map<string, PostSnapshot>> {
    const snapshots = new Map<string, PostSnapshot>();
    for (const pass of (await this.passes(reviewIds, executor)).values()) {
      // A pass always holds the post it approved; a return holds nothing to send.
      if (!pass.type || !pass.publishDate) continue;
      snapshots.set(pass.id, {
        versionIds: pass.versionIds,
        caption: pass.caption,
        hashtags: pass.hashtags,
        type: pass.type,
        platforms: pass.platforms,
        publishDate: pass.publishDate,
        publishTime: toTimeOfDay(pass.publishTime),
      });
    }
    return snapshots;
  }

  /** Titles of the given posts, archived or not. */
  async titles(postIds: readonly string[]): Promise<Map<string, string>> {
    if (postIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: contentPosts.id, title: contentPosts.title })
      .from(contentPosts)
      .where(inArray(contentPosts.id, [...new Set(postIds)]));
    return new Map(rows.map((row) => [row.id, row.title]));
  }

  /** Client responses by id, as approval items show them. */
  async responses(ids: readonly string[]): Promise<Map<string, ResponseSummary>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: postClientResponses.id,
        decision: postClientResponses.decision,
        channel: postClientResponses.channel,
        note: postClientResponses.note,
        createdAt: postClientResponses.createdAt,
      })
      .from(postClientResponses)
      .where(inArray(postClientResponses.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** The responses of a client on all its posts, newest first, for its Approvals tab. */
  async clientResponses(clientId: string, query: PageQuery): Promise<ClientResponsePage> {
    const where = eq(contentPosts.clientId, clientId);
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ response: postClientResponses, title: contentPosts.title })
        .from(postClientResponses)
        .innerJoin(contentPosts, eq(contentPosts.id, postClientResponses.postId))
        .where(where)
        .orderBy(desc(postClientResponses.createdAt), desc(postClientResponses.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ value: count() })
        .from(postClientResponses)
        .innerJoin(contentPosts, eq(contentPosts.id, postClientResponses.postId))
        .where(where),
    ]);
    const responses = rows.map((row) => row.response);
    const snapshots = await this.snapshots(responses.map((response) => response.reviewId));
    const [versions, people, contacts] = await Promise.all([
      this.files.versionRefs([...snapshots.values()].flatMap((snapshot) => snapshot.versionIds)),
      this.users.summaries(responses.flatMap((r) => (r.recordedById ? [r.recordedById] : []))),
      this.clients.contactSummaries(responses.map((response) => response.contactId)),
    ]);
    return {
      items: rows.map(
        ({ response, title }): ClientResponseEntry => ({
          id: response.id,
          kind: 'post',
          task: null,
          post: { id: response.postId, title },
          decision: response.decision,
          channel: response.channel,
          contact: contacts.get(response.contactId) ?? {
            id: response.contactId,
            name: '',
            archived: true,
          },
          note: response.note,
          // In the order of the snapshot: the display order of the media (rule 5).
          versions: (snapshots.get(response.reviewId)?.versionIds ?? []).flatMap(
            (id) => versions.get(id) ?? [],
          ),
          recordedBy: response.recordedById
            ? { id: response.recordedById, name: people.get(response.recordedById)?.name ?? '' }
            : null,
          createdAt: response.createdAt.toISOString(),
        }),
      ),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * Rule 22: the client's decision through a link moves the post, in the transaction that
   * closes the item: approved, or back to production with the note. The caller locked the post
   * (`lock`) before the item, and closes the item itself. No user acts: the audit entries carry
   * the contact's name. No final markers are written.
   */
  async recordLink(
    tx: Transaction,
    response: PostLinkResponse,
  ): Promise<ResponseSummary & { id: string }> {
    const { postId, decision, note, contact } = response;
    const [row] = await tx.select().from(contentPosts).where(eq(contentPosts.id, postId));
    const client = row ? await this.clients.summary(row.clientId, tx) : null;
    if (
      !row ||
      !client ||
      row.archivedAt ||
      row.status !== 'awaiting_client' ||
      row.clearedReviewId !== response.reviewId
    ) {
      throw new CodedException(409, 'ITEM_WITHDRAWN', 'The post is no longer with the client');
    }
    const post = { ...row, client };
    const approved = decision === 'approved';
    const to = approved ? 'approved' : 'in_production';
    await tx.update(contentPosts).set({ status: to }).where(eq(contentPosts.id, postId));
    await recordAudit(tx, {
      actor: null,
      actorName: contact.name,
      action: 'post.status_changed',
      entityType: 'post',
      entityId: postId,
      before: { status: 'awaiting_client' },
      after: { status: to, via: 'approval_link', ...(note && { note }), contactId: contact.id },
    });
    const [created] = await tx
      .insert(postClientResponses)
      .values({
        postId,
        decision,
        channel: 'link',
        contactId: contact.id,
        note,
        reviewId: response.reviewId,
        approvalItemId: response.itemId,
        ip: response.ip,
        userAgent: response.userAgent?.slice(0, 500) ?? null,
      })
      .returning({ id: postClientResponses.id, createdAt: postClientResponses.createdAt });
    if (!created) throw new Error('Client response insert returned no row');
    await recordAudit(tx, {
      actor: null,
      actorName: contact.name,
      action: 'post.client_response_recorded',
      entityType: 'post',
      entityId: postId,
      after: {
        decision,
        channel: 'link',
        via: 'approval_link',
        contactId: contact.id,
        ...(note && { note }),
      },
    });
    await this.notices.send(tx, [
      this.notices.notice(
        post,
        approved ? 'post_approved' : 'post_returned',
        [post.responsibleId],
        null,
        { source: 'client' },
      ),
    ]);
    return { id: created.id, decision, channel: 'link', note, createdAt: created.createdAt };
  }

  /** Passes by id, with their stage and snapshot. */
  private async passes(
    reviewIds: readonly string[],
    executor: Executor,
  ): Promise<Map<string, ReviewRow>> {
    if (reviewIds.length === 0) return new Map();
    const rows = await executor
      .select()
      .from(postReviews)
      .where(inArray(postReviews.id, [...new Set(reviewIds)]));
    return new Map(rows.map((row) => [row.id, row]));
  }
}
