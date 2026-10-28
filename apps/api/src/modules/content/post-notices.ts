import { Injectable } from '@nestjs/common';
import {
  type NotificationData,
  type NotificationType,
  type PostResolutionState,
  postResolutions,
} from '@vertex-hub/contracts';
import { contentPosts, type Database, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { UserDirectory } from '../auth/index.js';
import {
  type Notice,
  NotificationCenter,
  RecordFollowers,
  type Resolution,
} from '../notifications/index.js';
import type { PostAccess } from './post-access.js';

type Executor = Database | Transaction;

/** Types whose snapshot is a post plus fields of their own. */
type PostNoticeType = {
  [Type in NotificationType]: NotificationData<Type> extends { post: unknown } ? Type : never;
}[NotificationType];

/** What a post notice carries besides the post snapshot. */
type Extra<Type extends PostNoticeType> = Omit<NotificationData<Type>, 'post'>;

/** What a notice needs of a post. */
export type NoticePost = Pick<
  PostAccess,
  'id' | 'title' | 'publishDate' | 'publishTime' | 'responsibleId' | 'client'
>;

/** `HH:MM:SS` from the database to `HH:MM`. */
export const toTimeOfDay = (time: string | null): string | null => time?.slice(0, 5) ?? null;

/** What a change of a post needs of it: the notice fields and those the F16 rules read. */
export type ChangedPost = NoticePost & Pick<PostAccess, 'status' | 'reviewStage' | 'archivedAt'>;

/** The fields the F16 resolution rules read. */
const resolutionState = (post: ChangedPost): PostResolutionState => ({
  status: post.status,
  reviewStage: post.reviewStage,
  responsibleId: post.responsibleId,
  publishDate: post.publishDate,
  publishTime: toTimeOfDay(post.publishTime),
  archived: !!post.archivedAt,
});

/**
 * Builds and sends the post notifications of F08 ("Audit, notifications and jobs"): recipients
 * by role at the moment of the change and the post snapshot. Callers pass every notice of one
 * change in one `send`, so the first-match order applies.
 */
@Injectable()
export class PostNotices {
  constructor(
    private readonly users: UserDirectory,
    private readonly center: NotificationCenter,
    private readonly followers: RecordFollowers,
  ) {}

  /** A notice about `post`; null recipients are left out. */
  notice<Type extends PostNoticeType>(
    post: NoticePost,
    type: Type,
    recipients: readonly (string | null)[],
    actorId: string | null,
    ...extra: keyof Extra<Type> extends never ? [] : [Extra<Type>]
  ): Notice {
    return {
      type,
      recipients: recipients.filter((id): id is string => !!id),
      actorId,
      subjectId: post.id,
      data: {
        post: {
          title: post.title,
          client: post.client.name,
          publishDate: post.publishDate,
          publishTime: toTimeOfDay(post.publishTime),
        },
        ...extra[0],
      },
    } as Notice;
  }

  /**
   * Who reviews the post day to day: the managers of Content Management and Internal Operations
   * and the client's account manager.
   */
  async reviewers(executor: Executor, post: NoticePost): Promise<string[]> {
    const managers = await this.users.functionManagers(
      ['content_management', 'internal_operations'],
      executor,
    );
    return [...[...managers.values()].flat(), post.client.accountManagerId];
  }

  /** Rule 13 (A13): the Medical Consultation members hear about a post entering their stage. */
  async medicalRequested(tx: Transaction, post: NoticePost, actorId: string | null) {
    const members = await this.users.functionMembers(['medical_consultation'], tx);
    return this.notice(
      post,
      'post_medical_review_requested',
      members.map((member) => member.id).filter((id) => id !== post.responsibleId),
      actorId,
    );
  }

  send(
    tx: Transaction,
    notices: readonly Notice[],
    resolutions: readonly Resolution[] = [],
  ): Promise<number> {
    return this.center.notify(tx, notices, resolutions);
  }

  /**
   * F16 part C: sends the notices of one change of the post (`before`: the post as it was) with
   * what the change closes (rule B5) and, when its status moved, `post_progressed` to its
   * followers, which the first-match order drops for those another notice already tells (rule
   * B12).
   */
  async sendChange(
    tx: Transaction,
    before: ChangedPost,
    actorId: string | null,
    notices: readonly Notice[] = [],
  ): Promise<number> {
    const [row] = await tx.select().from(contentPosts).where(eq(contentPosts.id, before.id));
    if (!row) throw new Error(`Post ${before.id} not found`);
    const after: ChangedPost = { ...row, client: before.client };
    const subject = { type: 'post' as const, id: before.id };
    const progressed =
      before.status === after.status
        ? []
        : [
            this.notice(
              after,
              'post_progressed',
              await this.followers.recipients(tx, subject, 'content.read'),
              actorId,
              { status: after.status },
            ),
          ];
    return this.center.notify(
      tx,
      [...notices, ...progressed],
      postResolutions(resolutionState(before), resolutionState(after)).map((rule) => ({
        subject,
        ...rule,
        actorId,
      })),
    );
  }

  /** Rule B12: the users follow the post from now on, unless they unfollowed it. */
  follow(tx: Transaction, postId: string, userIds: readonly (string | null)[]): Promise<void> {
    return this.followers.follow(tx, { type: 'post', id: postId }, userIds);
  }
}
