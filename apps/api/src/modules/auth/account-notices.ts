import { Injectable } from '@nestjs/common';
import type { NotificationContent, NotificationSubjectType } from '@vertex-hub/contracts';
import type { Transaction } from '@vertex-hub/db';

/** One type of notification for one change in `auth`, with its recipients (F16 part C). */
export type AccountNotice = NotificationContent & {
  recipients: readonly string[];
  actorId: string | null;
  subjectId: string;
  subjectType?: NotificationSubjectType;
};

/** Stores the notices inside the transaction of the change. */
export type AccountNoticeSink = (
  tx: Transaction,
  notices: readonly AccountNotice[],
) => Promise<void>;

/**
 * Lets `notifications`, which imports `auth`, store the notices of department and membership
 * changes (F16 part C) without `auth` importing it.
 */
@Injectable()
export class AccountNotices {
  private sink: AccountNoticeSink | undefined;

  register(sink: AccountNoticeSink): void {
    this.sink = sink;
  }

  async send(tx: Transaction, notices: readonly AccountNotice[]): Promise<void> {
    if (this.sink && notices.length > 0) await this.sink(tx, notices);
  }
}
