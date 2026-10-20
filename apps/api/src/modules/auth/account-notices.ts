import { Injectable } from '@nestjs/common';
import type {
  NotificationContent,
  NotificationResolution,
  NotificationSubjectType,
  NotificationType,
} from '@vertex-hub/contracts';
import type { Transaction } from '@vertex-hub/db';

/** One type of notification for one change in `auth`, with its recipients (F16 part C). */
export type AccountNotice = NotificationContent & {
  recipients: readonly string[];
  actorId: string | null;
  subjectId: string;
  subjectType?: NotificationSubjectType;
};

/** What a change in `auth` closes (F16 rule B5). */
export interface AccountResolution {
  subject: { type: NotificationSubjectType; id: string };
  types: readonly NotificationType[];
  outcome: NotificationResolution;
  actorId: string | null;
}

/** Stores the notices, after closing what the change resolves, inside its transaction. */
export type AccountNoticeSink = (
  tx: Transaction,
  notices: readonly AccountNotice[],
  resolutions: readonly AccountResolution[],
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

  async send(
    tx: Transaction,
    notices: readonly AccountNotice[],
    resolutions: readonly AccountResolution[] = [],
  ): Promise<void> {
    if (this.sink && notices.length + resolutions.length > 0) {
      await this.sink(tx, notices, resolutions);
    }
  }
}
