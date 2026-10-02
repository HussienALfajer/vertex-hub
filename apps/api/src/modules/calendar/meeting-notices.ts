import { Injectable } from '@nestjs/common';
import type { NotificationData, NotificationType } from '@vertex-hub/contracts';
import type { meetings, Transaction } from '@vertex-hub/db';
import { type Notice, NotificationCenter } from '../notifications/index.js';

/** Types whose snapshot is a meeting plus fields of their own. */
type MeetingNoticeType = {
  [Type in NotificationType]: NotificationData<Type> extends { meeting: unknown } ? Type : never;
}[NotificationType];

/** What a meeting notice carries besides the meeting snapshot. */
type Extra<Type extends MeetingNoticeType> = Omit<NotificationData<Type>, 'meeting'>;

/** What a notice needs of a meeting: the row and its client's name. */
export type NoticeMeeting = Pick<
  typeof meetings.$inferSelect,
  'id' | 'title' | 'startsAt' | 'endsAt'
> & { client: string | null };

/**
 * Builds and sends the meeting notifications of F11 ("Audit, notifications and jobs"). Callers
 * pass every notice of one change in one `send`, so the first-match order applies.
 */
@Injectable()
export class MeetingNotices {
  constructor(private readonly center: NotificationCenter) {}

  /** A notice about `meeting`. */
  notice<Type extends MeetingNoticeType>(
    meeting: NoticeMeeting,
    type: Type,
    recipients: readonly string[],
    actorId: string | null,
    ...extra: keyof Extra<Type> extends never ? [] : [Extra<Type>]
  ): Notice {
    return {
      type,
      recipients,
      actorId,
      subjectId: meeting.id,
      data: {
        meeting: {
          title: meeting.title,
          client: meeting.client,
          startsAt: meeting.startsAt.toISOString(),
          endsAt: meeting.endsAt.toISOString(),
        },
        ...extra[0],
      },
    } as Notice;
  }

  async send(tx: Transaction, notices: readonly Notice[]): Promise<void> {
    const sendable = notices.filter((notice) => notice.recipients.length > 0);
    if (sendable.length > 0) await this.center.notify(tx, sendable);
  }
}
