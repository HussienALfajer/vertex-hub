import { Inject, Injectable } from '@nestjs/common';
import {
  blockingChecks,
  captionGroupsOf,
  fileTypeOf,
  isClientReturn,
  type PostCaption,
  type PostCheck,
  type PostCheckSettings,
  type PostClientResponse,
  type PostDetail,
  type PostMedia as PostMediaVersion,
  type PostReview,
  postChecks,
  postContentToken,
  type ReviewStage,
  type ReviewVersion,
} from '@vertex-hub/contracts';
import { type Database, postClientResponses, postReviews, type Transaction } from '@vertex-hub/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { personRef, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { FileVersions } from '../files/index.js';
import type { LinkedTask } from '../tasks/index.js';
import type { PostAccess, PostRow } from './post-access.js';
import { PostCaptions, shownCaptions } from './post-captions.js';
import { PostMedia } from './post-media.js';
import { toTimeOfDay } from './post-notices.js';

type Executor = Database | Transaction;

type ReviewRow = typeof postReviews.$inferSelect;

/**
 * What a review looks at (rule 11, F08B rule A7): the media in slide order with their captions,
 * and the captions of the post's groups.
 */
export interface PostContent {
  media: PostMediaVersion[];
  versionIds: string[];
  slideCaptions: (string | null)[];
  /** One per group of the post's platforms. */
  captions: PostCaption[];
  token: string;
  /** The tasks linked to the post, by link time. */
  tasks: LinkedTask[];
  /** It has linked tasks or media: where reopening a cancelled post goes (rule 19). */
  hasWork: boolean;
}

/** What a pass stores: the media in slide order and the post as the client is shown it. */
type Snapshot = Pick<
  ReviewRow,
  'versionIds' | 'type' | 'platforms' | 'publishDate' | 'publishTime'
> & { captions: PostCaption[]; slideCaptions: (string | null)[] };

/**
 * F08B rule A7 and edge case 1: a pass's captions per group of its platforms; a pass from before
 * F08B holds one caption, shown under every group.
 */
export function snapshotCaptions(
  pass: Pick<ReviewRow, 'captions' | 'caption' | 'hashtags' | 'platforms'>,
): PostCaption[] {
  return (
    pass.captions ??
    captionGroupsOf(pass.platforms).map((group) => ({
      group,
      caption: pass.caption,
      hashtags: pass.hashtags,
      title: null,
    }))
  );
}

/** F08B rules A3–A4 over what a review looks at, with the client's X long posts setting. */
export function contentChecks(
  post: Pick<PostRow, 'type' | 'platforms'>,
  content: Pick<PostContent, 'captions' | 'media'>,
  settings: PostCheckSettings,
): PostCheck[] {
  return postChecks(
    { type: post.type, platforms: post.platforms, captions: content.captions },
    content.media,
    { xLongPosts: settings.xLongPosts },
  );
}

/** Rule A3: a submission or an internal pass is refused while a limit is broken. */
export function assertWithinLimits(
  post: Pick<PostRow, 'type' | 'platforms'>,
  content: Pick<PostContent, 'captions' | 'media'>,
  settings: PostCheckSettings,
): void {
  const blocking = blockingChecks(contentChecks(post, content, settings));
  if (blocking.length > 0) {
    throw new CodedException(409, 'CAPTION_TOO_LONG', 'A caption is over its platform limit', {
      checks: blocking,
    });
  }
}

/** A pass's slide captions, aligned with its versions; none before F08B. */
export const snapshotSlideCaptions = (pass: Pick<ReviewRow, 'slideCaptions' | 'versionIds'>) =>
  pass.slideCaptions ?? pass.versionIds.map(() => null);

/** The review part of a post's detail. */
type ReviewDetail = Pick<PostDetail, 'clearedReview' | 'reviewHistory' | 'clientResponses'>;

/**
 * Review snapshots of posts (spec F08 rules 11–13, ADR 0021): the content a review looks at and
 * the pass and return records. Used inside the transactions of the workflow.
 */
@Injectable()
export class PostReviews {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly files: FileVersions,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly media: PostMedia,
    private readonly captions: PostCaptions,
  ) {}

  /**
   * Rules 5 and 11, F08B rules A6–A7: the media of the post now, in slide order, the captions of
   * its groups and the content token.
   */
  async content(executor: Executor, post: Pick<PostRow, 'id' | 'platforms'>): Promise<PostContent> {
    const [work, stored] = await Promise.all([
      this.media.of([post.id], executor).then((media) => media.get(post.id)),
      this.captions.of([post.id], executor).then((captions) => captions.get(post.id) ?? []),
    ]);
    const versions = work?.media ?? [];
    const tasks = work?.tasks ?? [];
    const versionIds = versions.map((version) => version.id);
    const slideCaptions = versions.map((version) => version.slideCaption);
    const captions = shownCaptions(stored, post.platforms);
    return {
      tasks,
      hasWork: versions.length > 0 || tasks.length > 0,
      media: versions.map((version) => ({
        id: version.id,
        fileItemId: version.fileItemId,
        name: version.name,
        number: version.number,
        kind: version.kind,
        type: fileTypeOf(version.kind, version.mimeType),
        previewStatus: version.previewStatus,
        task: version.task,
        slideCaption: version.slideCaption,
        width: version.width,
        height: version.height,
        durationMs: version.durationMs,
      })),
      versionIds,
      slideCaptions,
      captions,
      token: postContentToken(versionIds, captions, slideCaptions),
    };
  }

  /** Rule 11: a pass with the snapshot it approved; returns the review id. */
  async recordPass(
    tx: Transaction,
    postId: string,
    stage: ReviewStage,
    reviewer: AuditActor,
    snapshot: Snapshot,
    note: string | null = null,
  ): Promise<string> {
    const [review] = await tx
      .insert(postReviews)
      .values({
        postId,
        stage,
        outcome: 'passed',
        note,
        reviewerId: reviewer.id,
        versionIds: snapshot.versionIds,
        // The first group's text, as the previous release reads a snapshot (ADR 0042).
        caption: snapshot.captions[0]?.caption ?? null,
        hashtags: snapshot.captions[0]?.hashtags ?? null,
        captions: snapshot.captions,
        slideCaptions: snapshot.slideCaptions,
        type: snapshot.type,
        platforms: snapshot.platforms,
        publishDate: snapshot.publishDate,
        publishTime: snapshot.publishTime,
      })
      .returning({ id: postReviews.id });
    if (!review) throw new Error('Review insert returned no row');
    const versions = await this.files.versionRefs(snapshot.versionIds, tx);
    await recordAudit(tx, {
      actor: reviewer,
      action: 'post.reviewed',
      entityType: 'post',
      entityId: postId,
      after: {
        stage,
        outcome: 'passed',
        ...(note && { note }),
        versions: snapshot.versionIds.flatMap((id) => {
          const version = versions.get(id);
          return version ? [{ name: version.name, number: version.number }] : [];
        }),
        hasCaption: snapshot.captions.some((caption) => !!caption.caption),
      },
    });
    return review.id;
  }

  /** Rule 11: every return writes a `returned` row. */
  async recordReturn(
    tx: Transaction,
    postId: string,
    stage: ReviewStage,
    reviewer: AuditActor,
    note: string,
  ): Promise<void> {
    await tx
      .insert(postReviews)
      .values({ postId, stage, outcome: 'returned', note, reviewerId: reviewer.id });
    await recordAudit(tx, {
      actor: reviewer,
      action: 'post.reviewed',
      entityType: 'post',
      entityId: postId,
      after: { stage, outcome: 'returned', note },
    });
  }

  /** The internal pass that started the medical stage: the latest internal pass of the post. */
  async startingPass(executor: Executor, postId: string): Promise<ReviewRow> {
    const [pass] = await executor
      .select()
      .from(postReviews)
      .where(
        and(
          eq(postReviews.postId, postId),
          eq(postReviews.stage, 'internal'),
          eq(postReviews.outcome, 'passed'),
        ),
      )
      .orderBy(desc(postReviews.createdAt), desc(postReviews.id))
      .limit(1);
    if (!pass) throw new Error(`Post ${postId} is in the medical stage without an internal pass`);
    return pass;
  }

  /** The pass that cleared the post for the client; `INVALID_TRANSITION` when it has none. */
  async clearedPass(
    executor: Executor,
    post: Pick<PostRow, 'clearedReviewId'>,
  ): Promise<ReviewRow> {
    const [pass] = post.clearedReviewId
      ? await executor.select().from(postReviews).where(eq(postReviews.id, post.clearedReviewId))
      : [];
    if (!pass) {
      throw new CodedException(
        409,
        'INVALID_TRANSITION',
        'The post has no reviewed snapshot: withdraw it for re-review first',
      );
    }
    return pass;
  }

  /** The stage of the post's cleared review, for the "ready to send" rule (rule 20). */
  async clearedStage(
    executor: Executor,
    post: Pick<PostRow, 'clearedReviewId'>,
  ): Promise<ReviewStage | null> {
    if (!post.clearedReviewId) return null;
    const [pass] = await executor
      .select({ stage: postReviews.stage })
      .from(postReviews)
      .where(eq(postReviews.id, post.clearedReviewId));
    return pass?.stage ?? null;
  }

  /**
   * Rule 12: the client response that sent the post back, while nothing was reviewed or answered
   * since; null when the post came back another way.
   */
  async returningResponse(
    executor: Executor,
    postId: string,
  ): Promise<{ id: string; contactId: string } | null> {
    const [[review], [response]] = await Promise.all([
      executor
        .select({ createdAt: postReviews.createdAt })
        .from(postReviews)
        .where(eq(postReviews.postId, postId))
        .orderBy(desc(postReviews.createdAt), desc(postReviews.id))
        .limit(1),
      executor
        .select()
        .from(postClientResponses)
        .where(eq(postClientResponses.postId, postId))
        .orderBy(desc(postClientResponses.createdAt), desc(postClientResponses.id))
        .limit(1),
    ]);
    if (!response) return null;
    const reviewedSince = !!review && review.createdAt > response.createdAt;
    const latest = reviewedSince
      ? { kind: 'review' as const, changesRequested: false }
      : { kind: 'response' as const, changesRequested: response.decision === 'changes_requested' };
    return isClientReturn(latest) ? { id: response.id, contactId: response.contactId } : null;
  }

  /** The reviews and client responses of a post, oldest first, for its page. */
  async detail(post: PostAccess): Promise<ReviewDetail> {
    const [reviews, responses] = await Promise.all([
      this.db
        .select()
        .from(postReviews)
        .where(eq(postReviews.postId, post.id))
        .orderBy(asc(postReviews.createdAt), asc(postReviews.id)),
      this.db
        .select()
        .from(postClientResponses)
        .where(eq(postClientResponses.postId, post.id))
        .orderBy(asc(postClientResponses.createdAt), asc(postClientResponses.id)),
    ]);
    const [versions, people, contacts] = await Promise.all([
      this.files.versionRefs(reviews.flatMap((review) => review.versionIds)),
      this.users.summaries([
        ...reviews.flatMap((review) => (review.reviewerId ? [review.reviewerId] : [])),
        ...responses.flatMap((response) => (response.recordedById ? [response.recordedById] : [])),
      ]),
      this.clients.contactSummaries(responses.map((response) => response.contactId)),
    ]);
    const person = (userId: string) => personRef(people, userId);
    // In the order of the snapshot: the display order of the media (rule 5).
    const versionsOf = (ids: string[]): ReviewVersion[] =>
      ids.flatMap((id) => versions.get(id) ?? []);
    const toReview = (review: ReviewRow): PostReview => ({
      id: review.id,
      stage: review.stage,
      outcome: review.outcome,
      note: review.note,
      reviewer: review.reviewerId ? person(review.reviewerId) : null,
      versions: versionsOf(review.versionIds),
      caption: review.caption,
      hashtags: review.hashtags,
      captions: review.outcome === 'passed' ? snapshotCaptions(review) : [],
      slideCaptions: review.outcome === 'passed' ? snapshotSlideCaptions(review) : [],
      type: review.type,
      platforms: review.platforms,
      publishDate: review.publishDate,
      publishTime: toTimeOfDay(review.publishTime),
      createdAt: review.createdAt.toISOString(),
    });
    const byId = new Map(reviews.map((review) => [review.id, review]));
    const cleared = post.clearedReviewId ? byId.get(post.clearedReviewId) : undefined;
    return {
      clearedReview: cleared ? toReview(cleared) : null,
      reviewHistory: reviews.map(toReview),
      clientResponses: responses.map(
        (response): PostClientResponse => ({
          id: response.id,
          decision: response.decision,
          channel: response.channel,
          contact: contacts.get(response.contactId) ?? {
            id: response.contactId,
            name: '',
            archived: true,
          },
          note: response.note,
          versions: versionsOf(byId.get(response.reviewId)?.versionIds ?? []),
          recordedBy: response.recordedById ? person(response.recordedById) : null,
          createdAt: response.createdAt.toISOString(),
        }),
      ),
    };
  }
}
