import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  businessDate,
  type CalendarDate,
  type DepartmentCode,
  type DigestTask,
  EMAIL_DIGEST_JOB,
  EMAIL_NOTIFICATIONS_JOB,
  type EmailData,
  isEmailBatchWindow,
  isWorkDay,
  NOTIFICATION_EMAIL,
} from '@vertex-hub/contracts';
import {
  type Database,
  emailDigests,
  notificationSettings,
  notifications,
  type Transaction,
} from '@vertex-hub/db';
import { digestEmail, notificationBatchEmail } from '@vertex-hub/messages';
import { and, count, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { ENV, type Env } from '../../core/config/env.js';
import { DATABASE } from '../../core/database/database.module.js';
import { JobQueue, runEach } from '../../core/jobs/index.js';
import { type Mailbox, UserDirectory } from '../auth/index.js';
import { Mailer } from '../email/index.js';
import { notificationResponses } from './notification-responses.js';

/** A list cut to its first items, with how many were left out. */
export interface ShortList<Item> {
  items: Item[];
  more: number;
}

/** A module's part of the digest (rule 12): the user's tasks overdue and due today. */
export type DigestSource = (
  userId: string,
  now: Date,
) => Promise<{ overdue: ShortList<DigestTask>; dueToday: ShortList<DigestTask> }>;

type NotificationRow = typeof notifications.$inferSelect;

/**
 * Notification emails (F14 email rules 3–12, ADR 0028): the `email.notifications` batches every
 * 5 minutes and the `email.digest` at 08:00, both scheduled by the worker and worked here. The
 * digest runs the sources other modules register (tasks); this module never imports them.
 */
@Injectable()
export class NotificationEmails implements OnModuleInit {
  private readonly logger = new Logger(NotificationEmails.name);
  private readonly sources: DigestSource[] = [];

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly jobs: JobQueue,
    private readonly users: UserDirectory,
    private readonly mailer: Mailer,
  ) {}

  onModuleInit(): void {
    this.jobs.work(EMAIL_NOTIFICATIONS_JOB.queue, async () => {
      const sent = await this.runBatches();
      if (sent > 0) this.logger.log(`Notification emails: ${sent} queued`);
    });
    this.jobs.work(EMAIL_DIGEST_JOB.queue, async () => {
      const sent = await this.runDigest();
      this.logger.log(`Digests: ${sent} queued`);
    });
  }

  registerDigestSource(source: DigestSource): void {
    this.sources.push(source);
  }

  /**
   * Rules 5–7: inside the window, one batch email per recipient whose pending notifications are
   * due; read ones are skipped. Returns the number of emails queued.
   */
  async runBatches(now: Date = new Date()): Promise<number> {
    if (!isEmailBatchWindow(now)) return 0;
    const recipients = await this.db
      .selectDistinct({ id: notifications.recipientId })
      .from(notifications)
      .where(and(eq(notifications.emailState, 'pending'), lte(notifications.emailAfter, now)));
    let sent = 0;
    await runEach(
      recipients,
      this.logger,
      ({ id }) => `Notification email to ${id}`,
      async ({ id }) => {
        const queued = await this.db.transaction((tx) => this.sendBatch(tx, id, now));
        if (queued) sent += 1;
      },
    );
    return sent;
  }

  private async sendBatch(tx: Transaction, recipientId: string, now: Date): Promise<boolean> {
    const due = await this.lockPending(tx, recipientId, now);
    const mailbox = (await this.users.mailboxes([recipientId], tx)).get(recipientId);
    // Edge case 6: an archived recipient gets nothing; their pending notifications are skipped.
    if (!mailbox) {
      await this.skip(tx, due);
      return false;
    }
    const unread = await this.skipRead(tx, due);
    if (unread.length === 0) return false;
    const data: EmailData<'notification_batch'> = {
      notifications: await this.shortList(tx, unread, NOTIFICATION_EMAIL.batchItems),
      departments: await this.departmentNames(tx),
    };
    const emailId = await this.mailer.queue(tx, {
      kind: 'notification_batch',
      to: [toAddress(mailbox)],
      subject: notificationBatchEmail(data, this.env.APP_URL).subject,
      data,
      sender: null,
    });
    await this.markSent(tx, unread, emailId);
    return true;
  }

  /**
   * Rules 10–12: on work days, one digest per active user with the digest on and none yet for
   * `date`: their overdue tasks and tasks due today, their pending notifications, and the unread
   * count. Nothing when the three lists are empty. Returns the number of digests queued.
   */
  async runDigest(date: CalendarDate = businessDate(), now: Date = new Date()): Promise<number> {
    if (!isWorkDay(date)) return 0;
    const [mailboxes, off, done] = await Promise.all([
      this.users.mailboxes(null),
      this.db
        .select({ userId: notificationSettings.userId })
        .from(notificationSettings)
        .where(eq(notificationSettings.digestEnabled, false)),
      this.db
        .select({ userId: emailDigests.userId })
        .from(emailDigests)
        .where(eq(emailDigests.digestDate, date)),
    ]);
    const skip = new Set([...off, ...done].map((row) => row.userId));
    let sent = 0;
    await runEach(
      [...mailboxes.values()].filter((mailbox) => !skip.has(mailbox.id)),
      this.logger,
      (mailbox) => `Digest for ${mailbox.id}`,
      async (mailbox) => {
        const queued = await this.db.transaction((tx) => this.sendDigest(tx, mailbox, date, now));
        if (queued) sent += 1;
      },
    );
    return sent;
  }

  private async sendDigest(
    tx: Transaction,
    mailbox: Mailbox,
    date: CalendarDate,
    now: Date,
  ): Promise<boolean> {
    const [settings] = await tx
      .select({ digestEnabled: notificationSettings.digestEnabled })
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, mailbox.id))
      .for('update');
    if (settings?.digestEnabled === false) return false;
    const tasks = await this.digestTasks(mailbox.id, now);
    // Rule 7: everything that waits, whether or not its 10 minutes have passed.
    const unread = await this.skipRead(tx, await this.lockPending(tx, mailbox.id, null));
    if (tasks.overdue.items.length + tasks.dueToday.items.length + unread.length === 0) {
      return false;
    }
    // The key first: a second run (or a retry) finds it and sends nothing twice.
    const keyed = await tx
      .insert(emailDigests)
      .values({ userId: mailbox.id, digestDate: date })
      .onConflictDoNothing()
      .returning({ userId: emailDigests.userId });
    if (keyed.length === 0) return false;
    const [unreadCount] = await tx
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.recipientId, mailbox.id), isNull(notifications.readAt)));
    const data: EmailData<'digest'> = {
      date,
      ...tasks,
      notifications: await this.shortList(tx, unread, NOTIFICATION_EMAIL.digestNotifications),
      unreadCount: unreadCount?.value ?? 0,
      departments: await this.departmentNames(tx),
    };
    const emailId = await this.mailer.queue(tx, {
      kind: 'digest',
      to: [toAddress(mailbox)],
      subject: digestEmail(data, this.env.APP_URL).subject,
      data,
      sender: null,
    });
    await tx
      .update(emailDigests)
      .set({ emailId })
      .where(and(eq(emailDigests.userId, mailbox.id), eq(emailDigests.digestDate, date)));
    await this.markSent(tx, unread, emailId);
    return true;
  }

  /** The registered sources' tasks, merged and cut to `digestTasks` each. */
  private async digestTasks(userId: string, now: Date) {
    const parts = await Promise.all(this.sources.map((source) => source(userId, now)));
    const merge = (key: 'overdue' | 'dueToday'): ShortList<DigestTask> => {
      const items = parts.flatMap((part) => part[key].items);
      const shown = items.slice(0, NOTIFICATION_EMAIL.digestTasks);
      const more = parts.reduce((sum, part) => sum + part[key].more, 0);
      return { items: shown, more: more + items.length - shown.length };
    };
    return { overdue: merge('overdue'), dueToday: merge('dueToday') };
  }

  /**
   * Rule 6: the recipient's pending notifications, newest first, locked so a concurrent run
   * skips them; with `now`, only those whose 10 minutes have passed.
   */
  private lockPending(
    tx: Transaction,
    recipientId: string,
    now: Date | null,
  ): Promise<NotificationRow[]> {
    return tx
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.emailState, 'pending'),
          now ? lte(notifications.emailAfter, now) : undefined,
        ),
      )
      .orderBy(desc(notifications.updatedAt), desc(notifications.id))
      .for('update', { skipLocked: true });
  }

  /** Rule 5: read notifications become `skipped`; returns the unread ones. */
  private async skipRead(tx: Transaction, rows: NotificationRow[]): Promise<NotificationRow[]> {
    await this.skip(
      tx,
      rows.filter((row) => row.readAt !== null),
    );
    return rows.filter((row) => row.readAt === null);
  }

  private async skip(tx: Transaction, rows: NotificationRow[]): Promise<void> {
    if (rows.length === 0) return;
    await tx
      .update(notifications)
      .set({ emailState: 'skipped' })
      .where(
        inArray(
          notifications.id,
          rows.map((row) => row.id),
        ),
      );
  }

  private async shortList(tx: Transaction, rows: NotificationRow[], max: number) {
    return {
      items: await notificationResponses(rows.slice(0, max), this.users, tx),
      more: Math.max(0, rows.length - max),
    };
  }

  /** Every notification the email carries, "n more" included, is `sent` with its id. */
  private async markSent(tx: Transaction, rows: NotificationRow[], emailId: string) {
    await tx
      .update(notifications)
      .set({ emailState: 'sent', emailId })
      .where(
        inArray(
          notifications.id,
          rows.map((row) => row.id),
        ),
      );
  }

  private async departmentNames(tx: Transaction) {
    return Object.fromEntries(await this.users.departmentNames(tx)) as Partial<
      Record<DepartmentCode, string>
    >;
  }
}

const toAddress = (mailbox: Mailbox) => ({
  name: mailbox.name,
  email: mailbox.email,
  userId: mailbox.id,
});
