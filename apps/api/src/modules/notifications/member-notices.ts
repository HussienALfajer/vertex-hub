import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { type Database, notifications } from '@vertex-hub/db';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { AccountNotices, ResponsibilityRegistry, UserDirectory } from '../auth/index.js';
import { DailyReminders } from './daily-reminders.js';
import { NotificationCenter } from './notification-center.js';

/**
 * F16 part C: stores the notices of `auth` (department managers, membership changes, archived
 * members with open work) through `AccountNotices`, since `auth` cannot import this module. In the
 * daily job, `member_archived_open_work` closes once the member holds no open item any more (the
 * modules' checks in `ResponsibilityRegistry`), and goes void when the member is restored.
 */
@Injectable()
export class MemberNotices implements OnModuleInit {
  private readonly logger = new Logger(MemberNotices.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly center: NotificationCenter,
    private readonly accountNotices: AccountNotices,
    private readonly reminders: DailyReminders,
    private readonly responsibilities: ResponsibilityRegistry,
    private readonly users: UserDirectory,
  ) {}

  onModuleInit(): void {
    this.accountNotices.register(async (tx, notices) => {
      await this.center.notify(tx, notices);
    });
    this.reminders.register('member-open-work', async () => {
      await this.resolveOpenWork();
      return 0;
    });
  }

  /** Returns how many members' notices it closed. */
  async resolveOpenWork(): Promise<number> {
    const open = await this.db
      .selectDistinct({ userId: notifications.subjectId })
      .from(notifications)
      .where(
        and(
          eq(notifications.resolutionType, 'member_archived_open_work'),
          isNull(notifications.resolvedAt),
        ),
      );
    let closed = 0;
    await runEach(
      open,
      this.logger,
      ({ userId }) => `Open work of ${userId}`,
      async ({ userId }) => {
        const resolved = await this.db.transaction(async (tx) => {
          const member = (await this.users.summaries([userId], tx)).get(userId);
          const restored = member?.archived === false;
          if (!restored && (await this.responsibilities.openWork(tx, userId)) > 0) return 0;
          return this.center.resolve(tx, {
            subject: { type: 'user', id: userId },
            types: ['member_archived_open_work'],
            outcome: restored ? 'void' : 'done',
            actorId: null,
          });
        });
        if (resolved > 0) closed += 1;
      },
    );
    return closed;
  }
}
