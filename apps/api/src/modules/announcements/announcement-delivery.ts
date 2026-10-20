import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  ANNOUNCEMENT_LIMITS,
  type AnnouncementBody,
  announcementExcerpt,
  businessDate,
  businessInstant,
  type CalendarDate,
  isWorkDay,
  permissionScopes,
  storedAudience,
  type UserAccess,
} from '@vertex-hub/contracts';
import {
  announcementRecipients,
  announcements,
  type Database,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, eq, inArray, isNull, lt, lte, type SQL, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { AudienceResolver } from '../audiences/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { UserDirectory } from '../auth/index.js';
import {
  DailyReminders,
  type Notice,
  NotificationCenter,
  TimedNotifications,
} from '../notifications/index.js';
import { type AnnouncementRow, needsManage } from './announcement-access.js';

/** Why a send did not happen: nobody in the audience, or recipients outside the author's reach. */
export type Unsendable = 'EMPTY_AUDIENCE' | 'FORBIDDEN_AUDIENCE';

/**
 * Sending an announcement (rule D3): resolving and freezing its recipients, notifying them in the
 * same transaction, and the jobs around it: scheduled sends in the minute job (rule D5) and the
 * acknowledgement reminders in the daily job (rule D8).
 */
@Injectable()
export class AnnouncementDelivery implements OnModuleInit {
  private readonly logger = new Logger(AnnouncementDelivery.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audiences: AudienceResolver,
    private readonly users: UserDirectory,
    private readonly center: NotificationCenter,
    private readonly reminders: DailyReminders,
    private readonly timed: TimedNotifications,
  ) {}

  onModuleInit(): void {
    this.timed.register('announcements-scheduled', (now) => this.sendScheduled(now));
    this.reminders.register('announcements-ack', (today) => this.remindUnacknowledged(today));
  }

  /**
   * The recipients the announcement would have now: its audience resolved, without the author.
   * Returns why it cannot be sent instead when nobody is left (`EMPTY_AUDIENCE`), or when it is
   * critical or pinned and the author's `announcements.manage` does not cover every recipient.
   */
  async recipientsOf(
    tx: Database | Transaction,
    row: Pick<AnnouncementRow, 'audience' | 'authorId' | 'priority' | 'pinnedUntil'>,
    authorAccess: UserAccess,
  ): Promise<string[] | Unsendable> {
    const resolved = await this.audiences.resolve(tx, storedAudience(row.audience));
    const recipients = resolved.filter((id) => id !== row.authorId);
    if (recipients.length === 0) return 'EMPTY_AUDIENCE';
    if (needsManage(row) && !(await this.covers(tx, authorAccess, recipients))) {
      return 'FORBIDDEN_AUDIENCE';
    }
    return recipients;
  }

  /** Whether the access's `announcements.manage` covers every one of the users. */
  async covers(
    tx: Database | Transaction,
    access: UserAccess,
    userIds: readonly string[],
  ): Promise<boolean> {
    const scopes = permissionScopes(access, 'announcements.manage');
    if (scopes.includes('all')) return true;
    if (!scopes.includes('department')) return false;
    const managed = new Set(access.departments.filter((d) => d.isManager).map((d) => d.code));
    const memberships = await this.users.memberships([...userIds], tx);
    return userIds.every((id) => [...(memberships.get(id) ?? [])].some((c) => managed.has(c)));
  }

  /**
   * Rule D3: freezes the recipients, marks the announcement sent and notifies them with its
   * priority. `actor` is null for a scheduled send (the minute job).
   */
  async send(
    tx: Transaction,
    row: AnnouncementRow,
    recipients: readonly string[],
    actor: AuditActor | null,
    now: Date,
  ): Promise<void> {
    await tx
      .insert(announcementRecipients)
      .values(recipients.map((userId) => ({ announcementId: row.id, userId })))
      .onConflictDoNothing();
    await tx
      .update(announcements)
      .set({ status: 'sent', sentAt: now, unsentAt: null })
      .where(eq(announcements.id, row.id));
    await this.center.notify(tx, this.notice(row, recipients));
    await recordAudit(tx, {
      actor,
      action: 'announcement.sent',
      entityType: 'announcement',
      entityId: row.id,
      before: { status: row.status },
      after: { status: 'sent', recipients: recipients.length },
    });
  }

  /** The `announcement` notification of the announcement as it is now. */
  notice(
    row: Pick<AnnouncementRow, 'id' | 'authorId' | 'title' | 'body' | 'priority' | 'requiresAck'>,
    recipients: readonly string[],
  ): Notice {
    return {
      type: 'announcement',
      recipients,
      actorId: row.authorId,
      subjectId: row.id,
      data: {
        title: row.title,
        excerpt: announcementExcerpt(row.body as AnnouncementBody),
        priority: row.priority,
        requiresAck: row.requiresAck,
      },
    };
  }

  /**
   * Rule D5 (minute job): sends the scheduled announcements whose time has come, resolving the
   * audience then. One whose author was archived, or whose audience is empty or out of the
   * author's reach, is not sent and returns to draft (edge case 17: `unsent_at`).
   */
  async sendScheduled(now: Date): Promise<number> {
    const due = and(
      eq(announcements.status, 'scheduled'),
      lte(announcements.scheduledAt, now),
      isNull(announcements.archivedAt),
    ) as SQL;
    const candidates = await this.db
      .select({ id: announcements.id })
      .from(announcements)
      .where(due)
      .orderBy(asc(announcements.scheduledAt));
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Scheduled announcement ${id}`,
      async ({ id }) => {
        const done = await this.db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(announcements)
            .where(and(eq(announcements.id, id), due))
            .for('update');
          if (!row) return false;
          const access = await this.users.access(row.authorId, tx);
          const recipients = access ? await this.recipientsOf(tx, row, access) : null;
          if (!Array.isArray(recipients)) {
            await tx
              .update(announcements)
              .set({ status: 'draft', scheduledAt: null, unsentAt: access ? now : null })
              .where(eq(announcements.id, id));
            await recordAudit(tx, {
              actor: null,
              action: 'announcement.schedule_cancelled',
              entityType: 'announcement',
              entityId: id,
              before: { status: 'scheduled' },
              after: { status: 'draft', reason: recipients ?? 'AUTHOR_ARCHIVED' },
            });
            return false;
          }
          await this.send(tx, row, recipients, null, now);
          return true;
        });
        if (done) sent += 1;
      },
    );
    return sent;
  }

  /**
   * Rule D8 (daily job, 09:00 on work days): `announcement_ack_reminder` to the recipients of a
   * sent announcement who have not acknowledged it, from the work day after it was sent, three
   * times at most each. After the third round the author gets `announcement_ack_summary` once.
   */
  async remindUnacknowledged(today: CalendarDate): Promise<number> {
    if (!isWorkDay(today)) return 0;
    const candidates = await this.db
      .select({ id: announcements.id })
      .from(announcements)
      .where(
        and(
          eq(announcements.status, 'sent'),
          eq(announcements.requiresAck, true),
          // Sent before today, in business time.
          lt(announcements.sentAt, businessInstant(today, '00:00')),
        ),
      )
      .orderBy(asc(announcements.sentAt));
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Acknowledgement reminders ${id}`,
      async ({ id }) => {
        sent += await this.db.transaction((tx) => this.remindOne(tx, id, today));
      },
    );
    return sent;
  }

  private async remindOne(tx: Transaction, id: string, today: CalendarDate): Promise<number> {
    const [row] = await tx
      .select()
      .from(announcements)
      .where(and(eq(announcements.id, id), eq(announcements.status, 'sent')))
      .for('update');
    if (!row) return 0;
    const pending = await tx
      .select({ userId: announcementRecipients.userId, sent: announcementRecipients.remindersSent })
      .from(announcementRecipients)
      .where(
        and(
          eq(announcementRecipients.announcementId, id),
          isNull(announcementRecipients.acknowledgedAt),
        ),
      );
    const active = new Set(
      await this.users.activeIds(
        pending.map((p) => p.userId),
        tx,
      ),
    );
    const open = pending.filter((p) => active.has(p.userId));
    const due = open.filter((p) => p.sent < ANNOUNCEMENT_LIMITS.reminders).map((p) => p.userId);
    let sent = 0;
    let recorded = false;
    if (due.length > 0) {
      recorded = await this.reminders.remindOnce(
        tx,
        { kind: 'ack_reminder', subjectId: id, occurrence: today },
        today,
        {
          type: 'announcement_ack_reminder',
          recipients: due,
          actorId: null,
          subjectId: id,
          data: { title: row.title },
        },
      );
      if (recorded) {
        await tx
          .update(announcementRecipients)
          .set({ remindersSent: sql`${announcementRecipients.remindersSent} + 1` })
          .where(
            and(
              eq(announcementRecipients.announcementId, id),
              inArray(announcementRecipients.userId, due),
            ),
          );
        sent += 1;
      }
    }
    // Everyone still open has had the third reminder (this round included): tell the author once.
    const afterRound = open.map((p) => (recorded && due.includes(p.userId) ? p.sent + 1 : p.sent));
    if (open.length > 0 && afterRound.every((n) => n >= ANNOUNCEMENT_LIMITS.reminders)) {
      const summarized = await this.reminders.remindOnce(
        tx,
        { kind: 'ack_summary', subjectId: id, occurrence: businessDate(row.sentAt ?? new Date()) },
        today,
        {
          type: 'announcement_ack_summary',
          recipients: [row.authorId],
          actorId: null,
          subjectId: id,
          data: { title: row.title, pending: open.length },
        },
      );
      if (summarized) sent += 1;
    }
    return sent;
  }
}
