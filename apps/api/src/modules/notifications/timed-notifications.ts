import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  NOTIFICATIONS_TIMED_JOB,
  TIMED_REMINDER_RETENTION_DAYS,
  type TimedReminderKind,
} from '@vertex-hub/contracts';
import { type Database, notifications, type Transaction, timedReminders } from '@vertex-hub/db';
import { lt, lte, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { JobQueue, runEach } from '../../core/jobs/index.js';
import { type Notice, NotificationCenter } from './notification-center.js';

/** A module's timed source (rule B13); returns how many reminders it sent. */
export type TimedReminderSource = (now: Date) => Promise<number>;

/** What one timed reminder is for: sent once per kind, subject and moment (rule B13). */
export interface TimedReminderKey {
  kind: TimedReminderKind;
  subjectId: string;
  /** The due, publish or start time; a moved time is a new key (edge case 14). */
  occursAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The `notifications.timed` job (F16 rule B13), every minute: runs the timed sources other
 * modules register (tasks, content, calendar) and wakes the snoozed notifications whose time has
 * come (rule B8). A snooze the job missed is caught up by the next run; a timed reminder whose
 * moment passed is skipped (edge case 15). `apps/worker` schedules it; this process works it.
 */
@Injectable()
export class TimedNotifications implements OnModuleInit {
  private readonly logger = new Logger(TimedNotifications.name);
  private readonly sources = new Map<string, TimedReminderSource>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly jobs: JobQueue,
    private readonly center: NotificationCenter,
  ) {}

  onModuleInit(): void {
    this.jobs.work(NOTIFICATIONS_TIMED_JOB.queue, async () => {
      const { sent, woken } = await this.runTimed();
      if (sent + woken > 0) this.logger.log(`Timed notifications: ${sent} sent, ${woken} woken`);
    });
  }

  register(name: string, source: TimedReminderSource): void {
    this.sources.set(name, source);
  }

  /** A failing source holds back neither the others nor the wake-ups; the run fails at the end. */
  async runTimed(now: Date = new Date()): Promise<{ sent: number; woken: number }> {
    let sent = 0;
    let woken = 0;
    const steps: [string, () => Promise<void>][] = [
      ...[...this.sources].map(([name, source]): [string, () => Promise<void>] => [
        `Timed source ${name}`,
        async () => {
          sent += await source(now);
        },
      ]),
      [
        'Snooze wake-ups',
        async () => {
          const rows = await this.db.transaction((tx) =>
            this.center.wake(tx, lte(notifications.snoozedUntil, now) as SQL),
          );
          woken = rows.length;
        },
      ],
    ];
    await runEach(
      steps,
      this.logger,
      ([name]) => name,
      ([, step]) => step(),
    );
    return { sent, woken };
  }

  /**
   * Records the reminder and notifies only when this call recorded it, so a second run sends
   * nothing twice. Returns whether it was sent.
   */
  async remindOnce(tx: Transaction, key: TimedReminderKey, notice: Notice): Promise<boolean> {
    const inserted = await tx
      .insert(timedReminders)
      .values(key)
      .onConflictDoNothing()
      .returning({ kind: timedReminders.kind });
    if (inserted.length === 0) return false;
    await this.center.notify(tx, notice);
    return true;
  }

  /** Deletes the keys whose moment is more than 30 days old (the daily job). */
  async purge(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - TIMED_REMINDER_RETENTION_DAYS * DAY_MS);
    const deleted = await this.db
      .delete(timedReminders)
      .where(lt(timedReminders.occursAt, cutoff))
      .returning({ kind: timedReminders.kind });
    return deleted.length;
  }
}
