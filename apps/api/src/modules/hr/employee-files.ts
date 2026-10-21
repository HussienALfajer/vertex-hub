import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { businessDate } from '@vertex-hub/contracts';
import {
  type Database,
  employeeFiles,
  hrSettings,
  type Transaction,
  workSchedules,
} from '@vertex-hub/db';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { recordAudit } from '../audit/index.js';
import { UserDirectory, UserLifecycle, type UserProfile } from '../auth/index.js';

type Executor = Database | Transaction;

/**
 * Rule A1: one employee file per user, created with the account on the default schedule and
 * the settings' default annual leave, archived and restored with it (F01). Users created outside `UsersService` (the `user:create`
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
      restored: async (tx, userId, actor) => {
        const [file] = await tx
          .update(employeeFiles)
          .set({ archivedAt: null })
          .where(eq(employeeFiles.userId, userId))
          .returning();
        // An end of service up to today belongs to the archived account: a restored
        // (rehired) user starts without it, so the daily job does not archive them again.
        if (file?.endedOn && file.endedOn <= businessDate()) {
          const before = {
            endedOn: file.endedOn,
            endReason: file.endReason,
            endNote: file.endNote,
          };
          const cleared = { endedOn: null, endReason: null, endNote: null };
          await tx.update(employeeFiles).set(cleared).where(eq(employeeFiles.id, file.id));
          await recordAudit(tx, {
            actor,
            action: 'employee_file.service_end_cleared',
            entityType: 'employee_file',
            entityId: userId,
            before,
            after: cleared,
          });
        }
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
    const [settings] = await executor
      .select({ annualLeaveDays: hrSettings.defaultAnnualLeaveDays })
      .from(hrSettings);
    if (!settings) throw new Error('No HR settings');
    const now = new Date();
    await executor
      .insert(employeeFiles)
      .values(
        profiles.map((profile) => ({
          userId: profile.id,
          scheduleId: schedule.id,
          annualLeaveDays: settings.annualLeaveDays,
          archivedAt: profile.archived ? now : null,
        })),
      )
      .onConflictDoNothing({ target: employeeFiles.userId });
  }
}
