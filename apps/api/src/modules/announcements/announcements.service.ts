import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ANNOUNCEMENT_LIMITS,
  type Announcement,
  type AnnouncementBody,
  type AnnouncementHome,
  type AnnouncementListQuery,
  type AnnouncementPage,
  type AnnouncementReceipts,
  type AnnouncementReceiptsQuery,
  type AnnouncementSummary,
  type AnnouncementTotals,
  addDays,
  announcementExcerpt,
  businessDate,
  type CreateAnnouncement,
  isSchedulable,
  type RemindAnnouncementResult,
  SENT_ANNOUNCEMENT_FIELDS,
  type SendAnnouncement,
  storedAudience,
  type UpdateAnnouncement,
} from '@vertex-hub/contracts';
import {
  announcementRecipients,
  announcements,
  type Database,
  type Transaction,
} from '@vertex-hub/db';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, personRef, UserDirectory } from '../auth/index.js';
import { NotificationCenter } from '../notifications/index.js';
import {
  type AnnouncementRow,
  isDiscarded,
  managesAll,
  mayRead,
  type RecipientRow,
  rightsOf,
  wasSent,
} from './announcement-access.js';
import { AnnouncementDelivery, type Unsendable } from './announcement-delivery.js';
import { AnnouncementPolls, type AuditedPoll, auditedPoll } from './announcement-polls.js';

/** The notification types an acknowledgement closes, and a withdrawal voids (rules D4, D10). */
const ACK_TYPES = ['announcement', 'announcement_ack_reminder'] as const;

const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

const iso = (value: Date | null) => value?.toISOString() ?? null;

const unsendable = (code: Unsendable) =>
  code === 'EMPTY_AUDIENCE'
    ? new CodedException(409, code, 'Nobody is in the audience')
    : new CodedException(403, code, 'Critical or pinned for recipients outside your reach');

/** The text an audit entry keeps of an announcement's editable fields, with its poll if given. */
function audited(row: Partial<AnnouncementRow>, poll?: AuditedPoll | null) {
  return {
    poll,
    title: row.title,
    body: row.body === undefined ? undefined : announcementExcerpt(row.body as AnnouncementBody),
    linkUrl: row.linkUrl,
    linkLabel: row.linkLabel,
    priority: row.priority,
    requiresAck: row.requiresAck,
    audience: row.audience,
    pinnedUntil: row.pinnedUntil,
    scheduledAt: row.scheduledAt === undefined ? undefined : iso(row.scheduledAt),
  };
}

@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly delivery: AnnouncementDelivery,
    private readonly users: UserDirectory,
    private readonly center: NotificationCenter,
    private readonly polls: AnnouncementPolls,
  ) {}

  /* Writing */

  /** Rules D3, D5: a draft, a scheduled announcement, or one sent at once. */
  async create(actor: CurrentUserInfo, input: CreateAnnouncement): Promise<Announcement> {
    const now = new Date();
    this.assertPin(input.pinnedUntil ?? null, now);
    const scheduledAt =
      input.send === 'schedule' ? this.scheduleTime(input.scheduledAt, now) : null;
    if (input.send !== 'draft') {
      this.polls.assertCloseTime(input.poll?.closesAt ?? null, scheduledAt ?? now, now);
    }
    const id = await this.db.transaction(async (tx) => {
      await this.users.assertActiveDepartments(input.audience.departments ?? [], tx);
      const [row] = await tx
        .insert(announcements)
        .values({
          authorId: actor.id,
          title: input.title,
          body: input.body,
          linkUrl: input.linkUrl ?? null,
          linkLabel: input.linkUrl ? (input.linkLabel ?? null) : null,
          priority: input.priority,
          requiresAck: input.requiresAck,
          audience: input.audience,
          status: input.send === 'schedule' ? 'scheduled' : 'draft',
          scheduledAt,
          pinnedUntil: input.pinnedUntil ?? null,
        })
        .returning();
      if (!row) throw new Error('Insert returned no row');
      if (input.poll) await this.polls.write(tx, row.id, input.poll);
      if (input.send === 'now') await this.sendNow(tx, actor, row, now);
      if (input.send === 'schedule') await this.schedule(tx, actor, { ...row, status: 'draft' });
      return row.id;
    });
    return this.detail(actor, id);
  }

  /**
   * Rule D10: a draft or scheduled announcement changes in full; a sent one only its title,
   * body, link and pin, and "Notify again" makes its notification unread with a new push and
   * clears the acknowledgements.
   */
  async update(
    actor: CurrentUserInfo,
    id: string,
    input: UpdateAnnouncement,
  ): Promise<Announcement> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const row = await this.lockOwn(tx, actor, id);
      if (row.status === 'withdrawn') {
        throw new CodedException(409, 'ALREADY_WITHDRAWN', 'The announcement was withdrawn');
      }
      const sent = row.status === 'sent';
      if (sent) {
        const locked = Object.keys(input).filter(
          (key) =>
            input[key as keyof UpdateAnnouncement] !== undefined &&
            !(SENT_ANNOUNCEMENT_FIELDS as readonly string[]).includes(key),
        );
        if (locked.length > 0) {
          throw new CodedException(409, 'LOCKED_FIELD', 'Locked once sent', { fields: locked });
        }
      }
      if (input.scheduledAt !== undefined && row.status !== 'scheduled') {
        throw new BadRequestException('Only a scheduled announcement takes a new time');
      }
      if (input.pinnedUntil !== undefined) this.assertPin(input.pinnedUntil, now);
      // F23 edge case 9: a stored archived department may stay; a newly added one must be active.
      if (input.audience?.departments) {
        const stored = storedAudience(row.audience).departments ?? [];
        await this.users.assertActiveDepartments(
          input.audience.departments.filter((code) => !stored.includes(code)),
          tx,
        );
      }
      const { notifyAgain, scheduledAt, poll, ...fields } = input;
      // Rule D10: a sent announcement's existing poll changes only while nobody has voted.
      if (sent && poll !== undefined) {
        // Locked first, so a vote arriving now waits for this edit or is seen by it.
        const existing = await this.polls.lockPoll(tx, id);
        if (!existing || poll === null || (await this.polls.hasVotes(tx, id))) {
          throw new CodedException(409, 'LOCKED_FIELD', 'Locked once sent', { fields: ['poll'] });
        }
        if (existing.closedAt || (existing.closesAt && existing.closesAt <= now)) {
          throw new CodedException(409, 'POLL_CLOSED', 'The poll is closed');
        }
        this.polls.assertCloseTime(poll.closesAt, row.sentAt ?? now, now);
      }
      const pollBefore = poll === undefined ? undefined : await this.polls.audited(tx, id);
      const pollAfter = poll === undefined ? undefined : poll && auditedPoll(poll);
      const linkUrl = fields.linkUrl === undefined ? row.linkUrl : fields.linkUrl;
      const priority = fields.priority ?? row.priority;
      const next: Partial<AnnouncementRow> = {
        ...fields,
        // A label without a link is dropped with the link; critical keeps the acknowledgement.
        linkLabel: linkUrl
          ? fields.linkLabel === undefined
            ? row.linkLabel
            : fields.linkLabel
          : null,
        requiresAck: priority === 'critical' ? true : (fields.requiresAck ?? row.requiresAck),
        ...(scheduledAt ? { scheduledAt: this.scheduleTime(scheduledAt, now) } : {}),
      };
      const changes = changedFields(audited(row, pollBefore), audited(next, pollAfter));
      const contentChanged = ['title', 'body', 'linkUrl', 'linkLabel', 'poll'].some(
        (key) => changes?.after[key as keyof typeof changes.after] !== undefined,
      );
      if (sent && next.pinnedUntil && next.pinnedUntil !== row.pinnedUntil) {
        await this.assertCoversRecipients(tx, actor, row.id);
      }
      const [updated] = await tx
        .update(announcements)
        .set({
          ...next,
          ...(sent && contentChanged ? { editedAt: now } : {}),
          ...(sent && notifyAgain ? { renotifiedAt: now } : {}),
        })
        .where(eq(announcements.id, id))
        .returning();
      if (!updated) throw new NotFoundException();
      if (poll !== undefined) await this.polls.write(tx, id, poll);
      if (updated.status === 'scheduled') {
        await this.polls.assertStoredCloseTime(tx, id, updated.scheduledAt ?? now, now);
        // The audience as it is now, as when it was scheduled (rule D5).
        const recipients = await this.delivery.recipientsOf(tx, updated, actor.access);
        if (!Array.isArray(recipients)) throw unsendable(recipients);
      }
      if (sent && notifyAgain) await this.notifyAgain(tx, updated);
      if (changes || (sent && notifyAgain)) {
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'announcement.edited',
          entityType: 'announcement',
          entityId: id,
          before: changes?.before ?? null,
          after: { ...changes?.after, ...(sent && notifyAgain ? { notifyAgain: true } : {}) },
        });
      }
    });
    return this.detail(actor, id);
  }

  /** Rule D5: a draft goes now, or at `scheduledAt`. */
  async send(actor: CurrentUserInfo, id: string, input: SendAnnouncement): Promise<Announcement> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const row = await this.lockOwn(tx, actor, id);
      if (row.status !== 'draft') throw new CodedException(409, 'NOT_DRAFT', 'Not a draft');
      this.assertPin(row.pinnedUntil, now);
      if (input.scheduledAt) {
        const scheduledAt = this.scheduleTime(input.scheduledAt, now);
        const [updated] = await tx
          .update(announcements)
          .set({ status: 'scheduled', scheduledAt, unsentAt: null })
          .where(eq(announcements.id, id))
          .returning();
        await this.polls.assertStoredCloseTime(tx, id, scheduledAt, now);
        if (updated) await this.schedule(tx, actor, { ...updated, status: 'draft' });
      } else {
        await this.polls.assertStoredCloseTime(tx, id, now, now);
        await this.sendNow(tx, actor, row, now);
      }
    });
    return this.detail(actor, id);
  }

  /** Rule D5: a scheduled announcement goes back to draft. */
  async cancelSchedule(actor: CurrentUserInfo, id: string): Promise<Announcement> {
    await this.db.transaction(async (tx) => {
      const row = await this.lockOwn(tx, actor, id);
      if (row.status !== 'scheduled') {
        throw new CodedException(409, 'NOT_SCHEDULED', 'Not scheduled');
      }
      await tx
        .update(announcements)
        .set({ status: 'draft', scheduledAt: null })
        .where(eq(announcements.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'announcement.schedule_cancelled',
        entityType: 'announcement',
        entityId: id,
        before: { status: 'scheduled', scheduledAt: iso(row.scheduledAt) },
        after: { status: 'draft' },
      });
    });
    return this.detail(actor, id);
  }

  /**
   * Rule D10: the author, or a holder of `announcements.manage` `all`, withdraws a sent
   * announcement: its notifications are voided and it is archived.
   */
  async withdraw(actor: CurrentUserInfo, id: string): Promise<Announcement> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const row = await this.lockReadable(tx, actor, id);
      if (row.authorId !== actor.id && !managesAll(actor.access)) throw new ForbiddenException();
      if (row.status === 'withdrawn') {
        throw new CodedException(409, 'ALREADY_WITHDRAWN', 'Already withdrawn');
      }
      if (row.status !== 'sent') throw new ConflictException('Only a sent announcement');
      await tx
        .update(announcements)
        .set({ status: 'withdrawn', withdrawnAt: now, withdrawnById: actor.id, archivedAt: now })
        .where(eq(announcements.id, id));
      await this.center.resolve(tx, {
        subject: { type: 'announcement', id },
        types: [...ACK_TYPES, 'poll_closing'],
        outcome: 'void',
        actorId: actor.id,
        includeInfo: true,
      });
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'announcement.withdrawn',
        entityType: 'announcement',
        entityId: id,
        before: { status: 'sent' },
        after: { status: 'withdrawn' },
      });
    });
    return this.detail(actor, id);
  }

  /** Rule D10: a draft is discarded by archiving it. */
  async archive(actor: CurrentUserInfo, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.lockOwn(tx, actor, id);
      if (row.status !== 'draft') throw new CodedException(409, 'NOT_DRAFT', 'Not a draft');
      await tx
        .update(announcements)
        .set({ archivedAt: new Date() })
        .where(eq(announcements.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'announcement.archived',
        entityType: 'announcement',
        entityId: id,
        before: { archived: false },
        after: { archived: true },
      });
    });
  }

  /** Rule D4: "I have read this" closes the recipient's notification and reminders. */
  async acknowledge(actor: CurrentUserInfo, id: string): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const { row, receipt } = await this.received(tx, actor, id);
      if (!row.requiresAck) {
        throw new CodedException(409, 'NO_ACK_REQUIRED', 'No acknowledgement asked');
      }
      if (receipt.acknowledgedAt) return;
      await tx
        .update(announcementRecipients)
        .set({ acknowledgedAt: now, openedAt: receipt.openedAt ?? now })
        .where(this.receiptOf(id, actor.id));
      await this.center.resolve(tx, {
        subject: { type: 'announcement', id },
        types: ACK_TYPES,
        outcome: 'done',
        actorId: actor.id,
        recipients: [actor.id],
      });
    });
  }

  /**
   * Rule D8: the author reminds those who have not acknowledged, at most once an hour; these
   * reminders do not count toward the three daily ones.
   */
  async remind(actor: CurrentUserInfo, id: string): Promise<RemindAnnouncementResult> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const row = await this.lockOwn(tx, actor, id);
      if (row.status !== 'sent') throw new ConflictException('Only a sent announcement');
      if (!row.requiresAck) {
        throw new CodedException(409, 'NO_ACK_REQUIRED', 'No acknowledgement asked');
      }
      const pause = ANNOUNCEMENT_LIMITS.remindEveryMinutes * 60_000;
      if (row.remindedAt && now.getTime() - row.remindedAt.getTime() < pause) {
        throw new HttpException('One reminder an hour', HttpStatus.TOO_MANY_REQUESTS);
      }
      const pending = await tx
        .select({ userId: announcementRecipients.userId })
        .from(announcementRecipients)
        .where(
          and(
            eq(announcementRecipients.announcementId, id),
            isNull(announcementRecipients.acknowledgedAt),
          ),
        );
      const recipients = await this.users.activeIds(
        pending.map((p) => p.userId),
        tx,
      );
      await tx.update(announcements).set({ remindedAt: now }).where(eq(announcements.id, id));
      await this.center.notify(tx, {
        type: 'announcement_ack_reminder',
        recipients,
        actorId: actor.id,
        subjectId: id,
        data: { title: row.title },
      });
      return { reminded: recipients.length };
    });
  }

  /* Reading */

  /**
   * An announcement as the caller may see it. A recipient's first opening sets `opened_at`, and
   * closes the notification when no acknowledgement is asked (rule D4).
   */
  async open(actor: CurrentUserInfo, id: string): Promise<Announcement> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(announcements).where(eq(announcements.id, id));
      const receipt = row ? await this.receiptRow(tx, id, actor.id) : null;
      if (!row || !receipt || row.status !== 'sent' || receipt.openedAt) return;
      await tx
        .update(announcementRecipients)
        .set({ openedAt: new Date() })
        .where(this.receiptOf(id, actor.id));
      if (!row.requiresAck) {
        await this.center.resolve(tx, {
          subject: { type: 'announcement', id },
          types: ['announcement'],
          outcome: 'done',
          actorId: actor.id,
          recipients: [actor.id],
          includeInfo: true,
        });
      }
    });
    return this.detail(actor, id);
  }

  async detail(actor: CurrentUserInfo, id: string): Promise<Announcement> {
    const [row] = await this.db.select().from(announcements).where(eq(announcements.id, id));
    const receipt = row ? await this.receiptRow(this.db, id, actor.id) : null;
    if (!row || !mayRead(actor, row, receipt)) throw new NotFoundException();
    const [announcement] = await this.toAnnouncements(actor, [row]);
    if (!announcement) throw new NotFoundException();
    return announcement;
  }

  /** Received, sent by the caller, or every sent and withdrawn one (`announcements.manage` `all`). */
  async list(actor: CurrentUserInfo, query: AnnouncementListQuery): Promise<AnnouncementPage> {
    if (query.view === 'all' && !managesAll(actor.access)) throw new ForbiddenException();
    const filters: SQL[] = [];
    if (query.view === 'received') {
      filters.push(
        eq(announcements.status, 'sent'),
        inArray(
          announcements.id,
          this.db
            .select({ id: announcementRecipients.announcementId })
            .from(announcementRecipients)
            .where(eq(announcementRecipients.userId, actor.id)),
        ),
      );
    } else if (query.view === 'sent') {
      filters.push(
        eq(announcements.authorId, actor.id),
        or(isNull(announcements.archivedAt), eq(announcements.status, 'withdrawn')) as SQL,
      );
    } else {
      filters.push(inArray(announcements.status, ['sent', 'withdrawn']));
    }
    if (query.status) filters.push(inArray(announcements.status, query.status));
    if (query.search) {
      filters.push(ilike(announcements.title, `%${query.search.replace(/[\\%_]/g, '\\$&')}%`));
    }
    const where = and(...filters);
    const [total] = await this.db.select({ count: count() }).from(announcements).where(where);
    const rows = await this.db
      .select()
      .from(announcements)
      .where(where)
      .orderBy(
        desc(
          sql`coalesce(${announcements.sentAt}, ${announcements.scheduledAt}, ${announcements.createdAt})`,
        ),
        desc(announcements.id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return {
      items: await this.toSummaries(actor, rows),
      total: total?.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Rules D6, D7: the caller's pinned announcements and unacknowledged critical ones. */
  async home(actor: CurrentUserInfo): Promise<AnnouncementHome> {
    const today = businessDate();
    const mine = and(
      eq(announcements.status, 'sent'),
      eq(announcementRecipients.userId, actor.id),
    ) as SQL;
    const pinned = await this.db
      .select({ announcement: announcements })
      .from(announcements)
      .innerJoin(
        announcementRecipients,
        eq(announcementRecipients.announcementId, announcements.id),
      )
      .where(and(mine, gte(announcements.pinnedUntil, today)))
      .orderBy(desc(announcements.sentAt));
    const critical = await this.db
      .select({ announcement: announcements })
      .from(announcements)
      .innerJoin(
        announcementRecipients,
        eq(announcementRecipients.announcementId, announcements.id),
      )
      .where(
        and(
          mine,
          eq(announcements.priority, 'critical'),
          isNull(announcementRecipients.acknowledgedAt),
        ),
      )
      .orderBy(asc(announcements.sentAt));
    return {
      pinned: await this.toSummaries(
        actor,
        pinned.map((r) => r.announcement),
      ),
      critical: await this.toAnnouncements(
        actor,
        critical.map((r) => r.announcement),
      ),
    };
  }

  /** Rule D9: each recipient with their times, for the author and managers. */
  async receipts(
    actor: CurrentUserInfo,
    id: string,
    query: AnnouncementReceiptsQuery,
  ): Promise<AnnouncementReceipts> {
    const [row] = await this.db.select().from(announcements).where(eq(announcements.id, id));
    const receipt = row ? await this.receiptRow(this.db, id, actor.id) : null;
    if (!row || !mayRead(actor, row, receipt)) throw new NotFoundException();
    if (!rightsOf(actor, row, receipt).receipts) throw new ForbiddenException();
    const rows = await this.db
      .select()
      .from(announcementRecipients)
      .where(eq(announcementRecipients.announcementId, id));
    const members = await this.users.audienceMembers(rows.map((r) => r.userId));
    const people = await this.users.summaries(rows.map((r) => r.userId));
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    const items = members
      .map((member) => ({ member, row: byUser.get(member.id) as RecipientRow }))
      .filter(({ row: r }) =>
        query.filter === 'not_opened'
          ? r.openedAt === null
          : query.filter === 'not_acknowledged'
            ? r.acknowledgedAt === null
            : true,
      )
      .map(({ member, row: r }) => ({
        user: {
          id: member.id,
          name: member.name,
          imageId: member.imageId,
          archived: people.get(member.id)?.archived ?? false,
        },
        openedAt: iso(r.openedAt),
        acknowledgedAt: iso(r.acknowledgedAt),
        remindersSent: r.remindersSent,
      }));
    return { totals: totalsOf(rows), items };
  }

  /* Helpers */

  private async sendNow(
    tx: Transaction,
    actor: CurrentUserInfo,
    row: AnnouncementRow,
    now: Date,
  ): Promise<void> {
    const recipients = await this.delivery.recipientsOf(tx, row, actor.access);
    if (!Array.isArray(recipients)) throw unsendable(recipients);
    await this.delivery.send(tx, row, recipients, actorOf(actor), now);
  }

  /** Checks the audience as it is now, so the author learns of a problem before the time. */
  private async schedule(
    tx: Transaction,
    actor: CurrentUserInfo,
    row: AnnouncementRow,
  ): Promise<void> {
    const recipients = await this.delivery.recipientsOf(tx, row, actor.access);
    if (!Array.isArray(recipients)) throw unsendable(recipients);
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'announcement.scheduled',
      entityType: 'announcement',
      entityId: row.id,
      before: { status: row.status },
      after: { status: 'scheduled', scheduledAt: iso(row.scheduledAt) },
    });
  }

  /** Rule D10: unread again with a new push, and every acknowledgement cleared. */
  private async notifyAgain(tx: Transaction, row: AnnouncementRow): Promise<void> {
    const recipients = await tx
      .update(announcementRecipients)
      .set({ acknowledgedAt: null, remindersSent: 0 })
      .where(eq(announcementRecipients.announcementId, row.id))
      .returning({ userId: announcementRecipients.userId });
    await this.center.reopen(
      tx,
      this.delivery.notice(
        row,
        recipients.map((r) => r.userId),
      ),
    );
  }

  /** Rule D5: 5 minutes to 90 days ahead. */
  private scheduleTime(at: string | undefined, now: Date): Date {
    const time = at ? new Date(at) : null;
    if (!time || !isSchedulable(time, now)) {
      throw new BadRequestException('Schedule 5 minutes to 90 days ahead');
    }
    return time;
  }

  /** Rule D7: today to 90 days ahead. */
  private assertPin(pinnedUntil: string | null, now: Date): void {
    if (pinnedUntil === null) return;
    const today = businessDate(now);
    if (pinnedUntil < today || pinnedUntil > addDays(today, ANNOUNCEMENT_LIMITS.pinMaxDays)) {
      throw new BadRequestException('Pin until today or up to 90 days ahead');
    }
  }

  private async assertCoversRecipients(tx: Transaction, actor: CurrentUserInfo, id: string) {
    const rows = await tx
      .select({ userId: announcementRecipients.userId })
      .from(announcementRecipients)
      .where(eq(announcementRecipients.announcementId, id));
    const ids = rows.map((r) => r.userId);
    if (!(await this.delivery.covers(tx, actor.access, ids))) {
      throw unsendable('FORBIDDEN_AUDIENCE');
    }
  }

  /** The caller's own announcement, locked; others answer 404 (or 403 when they may read it). */
  private async lockOwn(tx: Transaction, actor: CurrentUserInfo, id: string) {
    const row = await this.lockReadable(tx, actor, id);
    if (row.authorId !== actor.id) throw new ForbiddenException();
    return row;
  }

  private async lockReadable(tx: Transaction, actor: CurrentUserInfo, id: string) {
    const [row] = await tx
      .select()
      .from(announcements)
      .where(eq(announcements.id, id))
      .for('update');
    const receipt = row ? await this.receiptRow(tx, id, actor.id) : null;
    if (!row || !mayRead(actor, row, receipt)) throw new NotFoundException();
    return row;
  }

  /** A sent announcement the caller received, with their receipt; 404 otherwise. */
  private async received(tx: Transaction, actor: CurrentUserInfo, id: string) {
    const [row] = await tx.select().from(announcements).where(eq(announcements.id, id));
    const receipt = row ? await this.receiptRow(tx, id, actor.id) : null;
    if (!row || !receipt || row.status !== 'sent' || isDiscarded(row)) {
      throw new NotFoundException();
    }
    return { row, receipt };
  }

  private receiptOf(announcementId: string, userId: string): SQL {
    return and(
      eq(announcementRecipients.announcementId, announcementId),
      eq(announcementRecipients.userId, userId),
    ) as SQL;
  }

  private async receiptRow(
    executor: Database | Transaction,
    announcementId: string,
    userId: string,
  ): Promise<RecipientRow | null> {
    const [row] = await executor
      .select()
      .from(announcementRecipients)
      .where(this.receiptOf(announcementId, userId));
    return row ?? null;
  }

  private async toSummaries(
    actor: CurrentUserInfo,
    rows: AnnouncementRow[],
  ): Promise<AnnouncementSummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const receipts = await this.db
      .select()
      .from(announcementRecipients)
      .where(
        and(
          inArray(announcementRecipients.announcementId, ids),
          eq(announcementRecipients.userId, actor.id),
        ),
      );
    const receiptOf = new Map(receipts.map((r) => [r.announcementId, r]));
    const counted = rows
      .filter(
        (row) => wasSent(row.status) && (row.authorId === actor.id || managesAll(actor.access)),
      )
      .map((row) => row.id);
    const totals = await this.totals(counted);
    const people = await this.users.summaries(rows.flatMap((row) => [row.authorId]));
    return rows.map((row) => {
      const receipt = receiptOf.get(row.id) ?? null;
      return {
        id: row.id,
        author: personRef(people, row.authorId),
        title: row.title,
        excerpt: announcementExcerpt(row.body as AnnouncementBody),
        priority: row.priority,
        requiresAck: row.requiresAck,
        status: row.status,
        scheduledAt: iso(row.scheduledAt),
        sentAt: iso(row.sentAt),
        pinnedUntil: row.pinnedUntil,
        editedAt: iso(row.editedAt),
        unsentAt: iso(row.unsentAt),
        withdrawnAt: iso(row.withdrawnAt),
        receipt: receipt
          ? { openedAt: iso(receipt.openedAt), acknowledgedAt: iso(receipt.acknowledgedAt) }
          : null,
        totals: totals.get(row.id) ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  private async toAnnouncements(
    actor: CurrentUserInfo,
    rows: AnnouncementRow[],
  ): Promise<Announcement[]> {
    const summaries = await this.toSummaries(actor, rows);
    const withdrawers = await this.users.summaries(
      rows.flatMap((row) => (row.withdrawnById ? [row.withdrawnById] : [])),
    );
    const receipts = await this.db
      .select()
      .from(announcementRecipients)
      .where(
        and(
          inArray(
            announcementRecipients.announcementId,
            rows.map((row) => row.id),
          ),
          eq(announcementRecipients.userId, actor.id),
        ),
      );
    const receiptOf = new Map(receipts.map((r) => [r.announcementId, r]));
    const polls = await this.polls.views(
      actor,
      rows.map((row) => ({ row, receipt: receiptOf.get(row.id) ?? null })),
    );
    return rows.map((row, index) => {
      const summary = summaries[index] as AnnouncementSummary;
      const showsAudience = row.authorId === actor.id || managesAll(actor.access);
      return {
        ...summary,
        body: row.body as AnnouncementBody,
        linkUrl: row.linkUrl,
        linkLabel: row.linkLabel,
        audience: showsAudience ? storedAudience(row.audience) : null,
        renotifiedAt: iso(row.renotifiedAt),
        withdrawnBy: row.withdrawnById ? personRef(withdrawers, row.withdrawnById) : null,
        poll: polls.get(row.id) ?? null,
        rights: rightsOf(actor, row, receiptOf.get(row.id) ?? null),
      };
    });
  }

  private async totals(ids: string[]): Promise<Map<string, AnnouncementTotals>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: announcementRecipients.announcementId,
        recipients: count(),
        opened: count(announcementRecipients.openedAt),
        acknowledged: count(announcementRecipients.acknowledgedAt),
      })
      .from(announcementRecipients)
      .where(inArray(announcementRecipients.announcementId, ids))
      .groupBy(announcementRecipients.announcementId);
    return new Map(rows.map(({ id, ...totals }) => [id, totals]));
  }
}

function totalsOf(rows: RecipientRow[]): AnnouncementTotals {
  return {
    recipients: rows.length,
    opened: rows.filter((r) => r.openedAt).length,
    acknowledged: rows.filter((r) => r.acknowledgedAt).length,
  };
}
