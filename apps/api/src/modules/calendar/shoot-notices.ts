import { Injectable } from '@nestjs/common';
import type { NotificationData, NotificationType } from '@vertex-hub/contracts';
import type { Transaction } from '@vertex-hub/db';
import { type Notice, NotificationCenter, type Resolution } from '../notifications/index.js';
import type { ShootRow } from './shoot-access.js';

/** Types whose snapshot is a shoot plus fields of their own. */
type ShootNoticeType = {
  [Type in NotificationType]: NotificationData<Type> extends { shoot: unknown } ? Type : never;
}[NotificationType];

/** What a shoot notice carries besides the shoot snapshot. */
type Extra<Type extends ShootNoticeType> = Omit<NotificationData<Type>, 'shoot'>;

/** What a notice needs of a shoot: the row and its client's name. */
export type NoticeShoot = Pick<ShootRow, 'id' | 'title' | 'startsAt' | 'endsAt' | 'location'> & {
  client: string | null;
};

/**
 * Builds and sends the shoot notifications of F11 ("Audit, notifications and jobs"). Callers pass
 * every notice of one change in one `send`, so the first-match order applies.
 */
@Injectable()
export class ShootNotices {
  constructor(private readonly center: NotificationCenter) {}

  /** A notice about `shoot`. */
  notice<Type extends ShootNoticeType>(
    shoot: NoticeShoot,
    type: Type,
    recipients: readonly string[],
    actorId: string | null,
    ...extra: keyof Extra<Type> extends never ? [] : [Extra<Type>]
  ): Notice {
    return {
      type,
      recipients,
      actorId,
      subjectId: shoot.id,
      data: {
        shoot: {
          title: shoot.title,
          client: shoot.client,
          startsAt: shoot.startsAt.toISOString(),
          endsAt: shoot.endsAt.toISOString(),
          location: shoot.location,
        },
        ...extra[0],
      },
    } as Notice;
  }

  /** `resolutions`: what the change closes (F16 rule B5). */
  async send(
    tx: Transaction,
    notices: readonly Notice[],
    resolutions: readonly Resolution[] = [],
  ): Promise<void> {
    const sendable = notices.filter((notice) => notice.recipients.length > 0);
    if (sendable.length > 0 || resolutions.length > 0) {
      await this.center.notify(tx, sendable, resolutions);
    }
  }
}
