import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import {
  canMakePostMove,
  type MedicalReview,
  type PostDetail,
  type PostMove,
  type PostStatus,
  type PostStatusChange,
  postMove,
  postMoveNeeds,
  postReopenTarget,
} from '@vertex-hub/contracts';
import { contentPosts, type Database, postClientResponses, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, lockAccessChanges, UserDirectory } from '../auth/index.js';
import { ClientDirectory, ClientFlagHooks, type HealthcareChange } from '../clients/index.js';
import type { Notice } from '../notifications/index.js';
import { assertLinksMatch, ContentService } from './content.service.js';
import {
  actorOf,
  assertPostWritable,
  type PostAccess,
  postRights,
  postState,
  readablePost,
} from './post-access.js';
import { PostNotices } from './post-notices.js';
import { PostReviews } from './post-reviews.js';

/** Client responses (rule 24): recorded against the snapshot, with the contact who answered. */
const RESPONSE_MOVES: readonly PostMove[] = ['client_approved', 'client_changes'];

/** Internal passes (rule 11): they write a snapshot of the content they were shown. */
const PASS_MOVES: readonly PostMove[] = ['send_to_client', 'approve'];

/** Where a pass leads once no review stage is left: the client, or approved without them. */
const afterReview = (post: Pick<PostAccess, 'needsClientApproval'>): PostStatus =>
  post.needsClientApproval ? 'awaiting_client' : 'approved';

/**
 * The post workflow (spec F08, "Post status" and rules 1, 10–15, 17–19, 24, 26): status moves,
 * the review snapshots they write, the medical stage and healthcare flag changes.
 */
@Injectable()
export class PostWorkflowService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly users: UserDirectory,
    private readonly content: ContentService,
    private readonly reviews: PostReviews,
    private readonly notices: PostNotices,
    private readonly flagHooks: ClientFlagHooks,
  ) {}

  onModuleInit(): void {
    this.flagHooks.register((tx, change) => this.healthcareChanged(tx, change));
  }

  async changeStatus(
    actor: CurrentUserInfo,
    id: string,
    change: PostStatusChange,
  ): Promise<PostDetail> {
    await this.db.transaction(async (tx) => {
      // A reopen must not hand an open post back to an archived user (rule 28): it waits for
      // user archiving, which checks open posts under the same lock, taken first.
      if (change.to === 'idea' || change.to === 'in_production') await lockAccessChanges(tx);
      // The row lock makes a second concurrent move see the first one's status (edge case 1).
      const post = await readablePost(tx, this.clients, actor, id, { forUpdate: true });
      assertPostWritable(post);
      const content = await this.reviews.content(tx, post);
      const state = postState(post, content.versionIds.length > 0);
      const move = this.moveOf(post, change, postReopenTarget(state));
      if (!canMakePostMove(state, move, postRights(actor, post.client))) {
        throw new ForbiddenException();
      }
      const note = change.note ?? null;
      const reason = change.reason ?? null;
      const needs = postMoveNeeds(move);
      if ((needs === 'note' && !note) || (needs === 'reason' && !reason)) {
        throw new BadRequestException(`This move needs a ${needs}`);
      }
      const responds = RESPONSE_MOVES.includes(move);
      if (responds !== !!change.contactId) {
        throw new BadRequestException('A contact is named for client responses, and only there');
      }
      if (
        change.contactId &&
        !(await this.clients.isActiveContact(post.clientId, change.contactId, tx))
      ) {
        throw new CodedException(
          400,
          'UNKNOWN_CONTACT',
          'The contact is not a contact of the client',
        );
      }
      if (move === 'reopen' && !(await this.users.activeUser(post.responsibleId, tx))) {
        throw new CodedException(
          400,
          'INVALID_RESPONSIBLE',
          'The responsible person is archived: name someone else first',
        );
      }
      if (move === 'submit' && content.versionIds.length === 0 && !post.caption) {
        throw new CodedException(409, 'NOTHING_TO_APPROVE', 'Add a caption or media first');
      }
      if (move === 'schedule' && !post.publishTime) {
        throw new CodedException(409, 'PUBLISH_TIME_REQUIRED', 'Set the publish time first');
      }

      // Rules 11 and 13: a pass is refused when the content changed since the reviewer loaded
      // it, writes the snapshot, and for a healthcare client leads to the medical stage.
      const reviewer = actorOf(actor);
      const medical = PASS_MOVES.includes(move) && post.client.isHealthcare;
      const to = medical ? 'internal_review' : change.to;
      let clearedReviewId: string | null = null;
      if (PASS_MOVES.includes(move)) {
        if (!change.contentToken) {
          throw new BadRequestException('A pass sends the content token it reviewed');
        }
        if (content.token !== change.contentToken) {
          throw new CodedException(
            409,
            'REVIEW_CONTENT_CHANGED',
            'The media, the caption or the hashtags changed since the review was loaded',
          );
        }
        const reviewId = await this.reviews.recordPass(
          tx,
          id,
          'internal',
          reviewer,
          { ...post, versionIds: content.versionIds },
          note,
        );
        if (!medical) clearedReviewId = reviewId;
      }
      if (move === 'return' && post.reviewStage && note) {
        await this.reviews.recordReturn(tx, id, post.reviewStage, reviewer, note);
      }
      // Rule 24: a response answers the snapshot that was sent.
      if (responds && change.contactId) {
        const answered = await this.reviews.clearedPass(tx, post);
        // Rule 13: a healthcare post is answered only once a medical pass cleared it.
        if (post.client.isHealthcare && answered.stage !== 'medical') {
          throw new CodedException(
            409,
            'MEDICAL_REVIEW_REQUIRED',
            'Withdraw the post for re-review: it has no medical pass',
          );
        }
        const decision = move === 'client_approved' ? 'approved' : 'changes_requested';
        await tx.insert(postClientResponses).values({
          postId: id,
          decision,
          channel: 'manual',
          contactId: change.contactId,
          note,
          reviewId: answered.id,
          recordedById: actor.id,
        });
        await recordAudit(tx, {
          actor: reviewer,
          action: 'post.client_response_recorded',
          entityType: 'post',
          entityId: id,
          after: {
            decision,
            channel: 'manual',
            contactId: change.contactId,
            ...(note && { note }),
          },
        });
      }

      const now = new Date();
      const publishedAt = change.publishedAt ? new Date(change.publishedAt) : now;
      if (move === 'publish') {
        if (publishedAt > now) {
          throw new CodedException(400, 'INVALID_DATES', 'The publish time is in the future');
        }
        assertLinksMatch(change.publishedLinks ?? [], post.platforms);
      } else if (change.publishedAt || change.publishedLinks) {
        throw new BadRequestException('The publish time and links go with a move to published');
      }
      await tx
        .update(contentPosts)
        .set({
          status: to,
          reviewStage: medical ? 'medical' : to === 'internal_review' ? 'internal' : null,
          ...(clearedReviewId && { clearedReviewId }),
          // Set on scheduled, cleared on leaving it backwards (data table).
          ...(move === 'schedule' && { scheduledAt: now }),
          ...(post.status === 'scheduled' && move !== 'publish' && { scheduledAt: null }),
          ...(move === 'publish' && {
            publishedAt,
            publishedById: actor.id,
            publishedLinks: change.publishedLinks ?? [],
          }),
          ...(move === 'cancel' && { cancelledAt: now, cancelReason: reason }),
          ...(move === 'reopen' && { cancelledAt: null, cancelReason: null }),
        })
        .where(eq(contentPosts.id, id));
      await this.auditMove(tx, reviewer, post, to, {
        ...(medical && { reviewStage: 'medical' }),
        ...(note && { note }),
        ...(reason && { reason }),
        ...(change.contactId && { contactId: change.contactId }),
        ...(move === 'publish' && { publishedAt: publishedAt.toISOString() }),
      });
      await this.notices.send(
        tx,
        medical
          ? [await this.notices.medicalRequested(tx, post, actor.id)]
          : await this.moveNotices(tx, actor.id, post, move),
      );
    });
    return this.content.detail(actor, id);
  }

  /**
   * Rule 13: a medical reviewer who is not the responsible person approves the snapshot of the
   * internal pass unchanged, or returns the post with notes.
   */
  async medicalReview(
    actor: CurrentUserInfo,
    id: string,
    input: MedicalReview,
  ): Promise<PostDetail> {
    await this.db.transaction(async (tx) => {
      const post = await readablePost(tx, this.clients, actor, id, { forUpdate: true });
      assertPostWritable(post);
      if (post.reviewStage !== 'medical') {
        throw new CodedException(
          409,
          'INVALID_TRANSITION',
          'The post is not waiting for medical review',
        );
      }
      if (post.responsibleId === actor.id) {
        throw new CodedException(
          403,
          'SELF_REVIEW',
          'The responsible person does not review their own post',
        );
      }
      const reviewer = actorOf(actor);
      const note = input.note ?? null;
      if (input.decision === 'approve') {
        const internal = await this.reviews.startingPass(tx, id);
        const reviewId = await this.reviews.recordPass(tx, id, 'medical', reviewer, internal, note);
        const to = afterReview(post);
        await tx
          .update(contentPosts)
          .set({ status: to, reviewStage: null, clearedReviewId: reviewId })
          .where(eq(contentPosts.id, id));
        await this.auditMove(tx, reviewer, post, to, { ...(note && { note }) });
        await this.notices.send(tx, [this.clearedNotice(post, to, actor.id, 'medical')]);
        return;
      }
      // The contract requires the note of a return.
      await this.reviews.recordReturn(tx, id, 'medical', reviewer, note ?? '');
      await tx
        .update(contentPosts)
        .set({ status: 'in_production', reviewStage: null })
        .where(eq(contentPosts.id, id));
      await this.auditMove(tx, reviewer, post, 'in_production', { note });
      await this.notices.send(tx, [
        this.notices.notice(post, 'post_returned', [post.responsibleId], actor.id, {
          source: 'medical',
        }),
      ]);
    });
    return this.content.detail(actor, id);
  }

  /**
   * Rule 26, in the transaction that changes the flag. Turned off: posts in the medical stage
   * move on with their internal pass. Turned on: posts waiting for the client go back to the
   * medical stage.
   */
  private async healthcareChanged(tx: Transaction, change: HealthcareChange): Promise<void> {
    const affected = await tx
      .select()
      .from(contentPosts)
      .where(
        and(
          eq(contentPosts.clientId, change.clientId),
          isNull(contentPosts.archivedAt),
          change.isHealthcare
            ? eq(contentPosts.status, 'awaiting_client')
            : eq(contentPosts.reviewStage, 'medical'),
        ),
      )
      // By id, the order every post lock set follows, so a concurrent move cannot deadlock.
      .orderBy(asc(contentPosts.id))
      .for('update');
    if (affected.length === 0) return;
    const client = await this.clients.summary(change.clientId, tx);
    if (!client) return;
    for (const row of affected) {
      const post: PostAccess = { ...row, client };
      if (change.isHealthcare) {
        await tx
          .update(contentPosts)
          .set({ status: 'internal_review', reviewStage: 'medical' })
          .where(eq(contentPosts.id, post.id));
        await this.auditMove(tx, change.actor, post, 'internal_review', {
          reviewStage: 'medical',
          reason: 'healthcare_on',
        });
        await this.notices.send(tx, [
          await this.notices.medicalRequested(tx, post, change.actor.id),
        ]);
        continue;
      }
      const internal = await this.reviews.startingPass(tx, post.id);
      const to = afterReview(post);
      await tx
        .update(contentPosts)
        .set({ status: to, reviewStage: null, clearedReviewId: internal.id })
        .where(eq(contentPosts.id, post.id));
      await this.auditMove(tx, change.actor, post, to, { reason: 'healthcare_off' });
      await this.notices.send(tx, [this.clearedNotice(post, to, change.actor.id, 'internal')]);
    }
  }

  /** Who hears that a post passed its last review stage. */
  private clearedNotice(
    post: PostAccess,
    to: PostStatus,
    actorId: string | null,
    source: 'internal' | 'medical',
  ): Notice {
    return to === 'awaiting_client'
      ? this.notices.notice(post, 'post_awaiting_client', [post.client.accountManagerId], actorId)
      : this.notices.notice(post, 'post_approved', [post.responsibleId], actorId, { source });
  }

  /** Who hears about a move ("Audit, notifications and jobs"); `post` is as it was before it. */
  private async moveNotices(
    tx: Transaction,
    actorId: string,
    post: PostAccess,
    move: PostMove,
  ): Promise<Notice[]> {
    const responsible = [post.responsibleId];
    switch (move) {
      case 'submit':
        return [
          this.notices.notice(
            post,
            'post_review_requested',
            await this.notices.reviewers(tx, post),
            actorId,
          ),
        ];
      case 'return':
        return [
          this.notices.notice(post, 'post_returned', responsible, actorId, { source: 'internal' }),
        ];
      case 'client_changes':
        return [
          this.notices.notice(post, 'post_returned', responsible, actorId, { source: 'client' }),
        ];
      case 'send_to_client':
      case 'approve':
        return [this.clearedNotice(post, afterReview(post), actorId, 'internal')];
      case 'client_approved':
        return [
          this.notices.notice(post, 'post_approved', responsible, actorId, { source: 'client' }),
        ];
      default:
        return [];
    }
  }

  /** The move the change asks for; `INVALID_TRANSITION` when the workflow has none. */
  private moveOf(post: PostAccess, change: PostStatusChange, reopenTarget: PostStatus): PostMove {
    const move = postMove(post.status, change.to);
    const invalid = () =>
      new CodedException(
        409,
        'INVALID_TRANSITION',
        `A ${post.status} post cannot become ${change.to}`,
      );
    if (!move) throw invalid();
    // A cancelled post reopens to an idea, or to production when it has media.
    if (move === 'reopen' && change.to !== reopenTarget) throw invalid();
    // The client step follows the approval flag.
    if (move === 'send_to_client' && !post.needsClientApproval) throw invalid();
    if (move === 'approve' && post.needsClientApproval) throw invalid();
    // Rule 13: in the medical stage the pass belongs to the medical reviewers.
    if (PASS_MOVES.includes(move) && post.reviewStage === 'medical') throw invalid();
    return move;
  }

  private auditMove(
    tx: Transaction,
    actor: AuditActor,
    post: PostAccess,
    to: PostStatus,
    extra: Record<string, unknown>,
  ) {
    return recordAudit(tx, {
      actor,
      action: 'post.status_changed',
      entityType: 'post',
      entityId: post.id,
      before: {
        status: post.status,
        ...(post.reviewStage === 'medical' && { reviewStage: 'medical' }),
      },
      after: { status: to, ...extra },
    });
  }
}
