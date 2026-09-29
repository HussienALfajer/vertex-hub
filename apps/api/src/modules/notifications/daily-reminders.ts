import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  businessDate,
  type CalendarDate,
  NOTIFICATION_RETENTION_DAYS,
  NOTIFICATIONS_DAILY_JOB,
  type NotificationReminderKind,
} from '@vertex-hub/contracts';
import {
  type Database,
  notificationReminders,
  notifications,
  type Transaction,
} from '@vertex-hub/db';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { JobQueue } from '../../core/jobs/index.js';
import { type Notice, NotificationCenter } from './notification-center.js';

/** A module's part of the daily job; returns how many reminders it sent. */
export type DailyReminderSource = (today: CalendarDate) => Promise<number>;

/** What one reminder is for: sent once per kind, subject and occurrence (spec F14 rule 8). */
export interface ReminderKey {
  kind: NotificationReminderKind;
  /** The task or retainer. */
  subjectId: string;
  /** The due date or renewal date. */
  occurrence: CalendarDate;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The `notifications.daily` job (rule 8): runs the sources other modules register (tasks: A07,
 * A08 and escalation; projects: renewal), then deletes notifications read more than 90 days ago
 * (rule 13). `apps/worker` schedules it; this process works it.
 */
@Injectable()
export class DailyReminders implements OnModuleInit {
  private readonly logger = new Logger(DailyReminders.name);
  private readonly sources = new Map<string, DailyReminderSource>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly jobs: JobQueue,
    private readonly center: NotificationCenter,
  ) {}

  onModuleInit(): void {
    this.jobs.work(NOTIFICATIONS_DAILY_JOB.queue, async () => {
      const result = await this.runDaily();
      this.logger.log(`Daily notifications: ${result.sent} sent, ${result.purged} purged`);
    });
  }

  register(name: string, source: DailyReminderSource): void {
    this.sources.set(name, source);
  }

  /** Idempotent: every reminder is keyed in `notification_reminders`, so a rerun sends nothing. */
  async runDaily(
    today: CalendarDate = businessDate(),
    now: Date = new Date(),
  ): Promise<{ sent: number; purged: number }> {
    let sent = 0;
    for (const [name, source] of this.sources) {
      const count = await source(today);
      this.logger.log(`Daily source ${name}: ${count} sent`);
      sent += count;
    }
    return { sent, purged: await this.purge(now) };
  }

  /**
   * Records the reminder and notifies only when this call recorded it, so a retry or a second run
   * sends nothing twice. Returns whether it was sent.
   */
  async remindOnce(
    tx: Transaction,
    key: ReminderKey,
    today: CalendarDate,
    notice: Notice,
  ): Promise<boolean> {
    const inserted = await tx
      .insert(notificationReminders)
      .values({ ...key, sentOn: today })
      .onConflictDoNothing()
      .returning({ kind: notificationReminders.kind });
    if (inserted.length === 0) return false;
    await this.center.notify(tx, notice);
    return true;
  }

  /**
   * When each reminder was sent, by subject id; subjects without a reminder of that kind for the
   * given occurrence are left out (rule 11 escalates a day after the overdue reminder).
   */
  async sentOn(
    kind: NotificationReminderKind,
    subjects: readonly { subjectId: string; occurrence: CalendarDate }[],
  ): Promise<Map<string, CalendarDate>> {
    if (subjects.length === 0) return new Map();
    const occurrences = new Map(subjects.map((subject) => [subject.subjectId, subject.occurrence]));
    const rows = await this.db
      .select({
        subjectId: notificationReminders.subjectId,
        occurrence: notificationReminders.occurrence,
        sentOn: notificationReminders.sentOn,
      })
      .from(notificationReminders)
      .where(
        and(
          eq(notificationReminders.kind, kind),
          inArray(notificationReminders.subjectId, [...occurrences.keys()]),
        ),
      );
    return new Map(
      rows
        .filter((row) => occurrences.get(row.subjectId) === row.occurrence)
        .map((row) => [row.subjectId, row.sentOn]),
    );
  }

  private async purge(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
    const deleted = await this.db
      .delete(notifications)
      .where(lt(notifications.readAt, cutoff))
      .returning({ id: notifications.id });
    return deleted.length;
  }
}
