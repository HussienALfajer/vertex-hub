import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { DEFAULT_ANNUAL_LEAVE_DAYS } from '@vertex-hub/contracts';
import { type Database, employeeFiles, type Transaction, workSchedules } from '@vertex-hub/db';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { UserDirectory, UserLifecycle, type UserProfile } from '../auth/index.js';

type Executor = Database | Transaction;

/**
 * Rule A1: one employee file per user, created with the account on the default schedule,
 * archived and restored with it (F01). Users created outside `UsersService` (the `user:create`
 * command, the seed) get theirs when HR first reads them.
 */
@Injectable()
export class EmployeeFiles implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly lifecycle: UserLifecycle,
    private readonly users: UserDirectory,
  ) {}

  onModuleInit(): void {
    this.lifecycle.register({
      created: async (tx, userId) => {
        await this.insert(tx, [{ id: userId, archived: false }]);
      },
      archived: async (tx, userId) => {
        await tx
          .update(employeeFiles)
          .set({ archivedAt: new Date() })
          .where(and(eq(employeeFiles.userId, userId), isNull(employeeFiles.archivedAt)));
      },
      restored: async (tx, userId) => {
        await tx
          .update(employeeFiles)
          .set({ archivedAt: null })
          .where(eq(employeeFiles.userId, userId));
      },
    });
  }

  /** Creates the missing files of these users, archived with archived users. */
  async ensure(
    executor: Executor,
    profiles: readonly Pick<UserProfile, 'id' | 'archived'>[],
  ): Promise<void> {
    await this.insert(executor, profiles);
  }

  /** Every user's file, for the daily job. */
  async ensureAll(executor: Executor = this.db): Promise<void> {
    await this.insert(executor, await this.users.profiles({}, executor));
  }

  private async insert(
    executor: Executor,
    profiles: readonly Pick<UserProfile, 'id' | 'archived'>[],
  ): Promise<void> {
    if (profiles.length === 0) return;
    const [schedule] = await executor
      .select({ id: workSchedules.id })
      .from(workSchedules)
      .where(eq(workSchedules.isDefault, true));
    if (!schedule) throw new Error('No default work schedule');
    const now = new Date();
    await executor
      .insert(employeeFiles)
      .values(
        profiles.map((profile) => ({
          userId: profile.id,
          scheduleId: schedule.id,
          annualLeaveDays: DEFAULT_ANNUAL_LEAVE_DAYS,
          archivedAt: profile.archived ? now : null,
        })),
      )
      .onConflictDoNothing({ target: employeeFiles.userId });
  }
}
