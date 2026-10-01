import { Injectable } from '@nestjs/common';
import type { NotificationData, NotificationType } from '@vertex-hub/contracts';
import type { Database, Transaction } from '@vertex-hub/db';
import { UserDirectory } from '../auth/index.js';
import { type Notice, NotificationCenter } from '../notifications/index.js';
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
    const managers = await this.users.departmentManagers(
      ['content_management', 'internal_operations'],
      executor,
    );
    return [...[...managers.values()].flat(), post.client.accountManagerId];
  }

  /** Rule 13 (A13): the Medical Consultation members hear about a post entering their stage. */
  async medicalRequested(tx: Transaction, post: NoticePost, actorId: string | null) {
    const members = await this.users.activeMembers(['medical_consultation'], tx);
    return this.notice(
      post,
      'post_medical_review_requested',
      members.map((member) => member.id).filter((id) => id !== post.responsibleId),
      actorId,
    );
  }

  send(tx: Transaction, notices: readonly Notice[]): Promise<number> {
    return this.center.notify(tx, notices);
  }
}
