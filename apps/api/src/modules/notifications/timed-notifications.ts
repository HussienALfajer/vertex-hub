import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { NOTIFICATIONS_TIMED_JOB } from '@vertex-hub/contracts';
import { type Database, notifications } from '@vertex-hub/db';
import { lte, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { JobQueue } from '../../core/jobs/index.js';
import { NotificationCenter } from './notification-center.js';

/**
 * The `notifications.timed` job (F16 rule B13), every minute: wakes the snoozed notifications
 * whose time has come (rule B8). A minute the job missed is caught up by the next run (edge case
 * 15). `apps/worker` schedules it; this process works it.
 */
@Injectable()
export class TimedNotifications implements OnModuleInit {
  private readonly logger = new Logger(TimedNotifications.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly jobs: JobQueue,
    private readonly center: NotificationCenter,
  ) {}

  onModuleInit(): void {
    this.jobs.work(NOTIFICATIONS_TIMED_JOB.queue, async () => {
      const woken = await this.runTimed();
      if (woken > 0) this.logger.log(`Timed notifications: ${woken} woken`);
    });
  }

  /** Returns the number of notifications woken. */
  async runTimed(now: Date = new Date()): Promise<number> {
    const woken = await this.db.transaction((tx) =>
      this.center.wake(tx, lte(notifications.snoozedUntil, now) as SQL),
    );
    return woken.length;
  }
}
