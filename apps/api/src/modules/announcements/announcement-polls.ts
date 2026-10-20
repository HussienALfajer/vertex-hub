import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type AnnouncementPoll,
  businessDate,
  isPollCloseTime,
  POLL_LIMITS,
  type PollInput,
  type PollVote,
  pollClosingReminderAt,
} from '@vertex-hub/contracts';
import {
  announcementPollOptions,
  announcementPolls,
  announcementPollVotes,
  announcementRecipients,
  announcements,
  type Database,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, eq, gt, inArray, isNull, lte, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { runEach } from '../../core/jobs/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { DailyReminders, NotificationCenter, TimedNotifications } from '../notifications/index.js';
import {
  type AnnouncementRow,
  managesAll,
  mayRead,
  type RecipientRow,
} from './announcement-access.js';

type PollRow = typeof announcementPolls.$inferSelect;
type OptionRow = typeof announcementPollOptions.$inferSelect;
type VoteRow = typeof announcementPollVotes.$inferSelect;

/** A poll as an audit entry keeps it. */
export interface AuditedPoll {
  question: string;
  options: string[];
  multiple: boolean;
  anonymous: boolean;
  results: string;
  closesAt: string | null;
}

const HOUR_MS = 3_600_000;

/** Closed by the author or the minute job, or past its time before the job ran. */
const isClosed = (poll: PollRow, now: Date) =>
  poll.closedAt !== null || (poll.closesAt !== null && poll.closesAt <= now);

/**
 * The poll of an announcement (spec F16 rule D11): stored with the announcement, voted on by its
 * recipients until it closes at its time or by the author, with results shown as the author
 * chose. Anonymous votes keep the voter only to hold one vote per person; no response names them.
 * The minute job closes polls whose time has come and reminds non-voters a day before.
 */
@Injectable()
export class AnnouncementPolls implements OnModuleInit {
  private readonly logger = new Logger(AnnouncementPolls.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly center: NotificationCenter,
    private readonly reminders: DailyReminders,
    private readonly timed: TimedNotifications,
  ) {}

  onModuleInit(): void {
    this.timed.register('announcement-polls', (now) => this.runTimed(now));
  }

  /* Writing, inside the announcement's transaction */

  async pollOf(executor: Database | Transaction, announcementId: string) {
    const [poll] = await executor
      .select()
      .from(announcementPolls)
      .where(eq(announcementPolls.announcementId, announcementId));
    return poll ?? null;
  }

  /** The poll as an audit entry keeps it; null without one. */
  async audited(executor: Database | Transaction, announcementId: string) {
    const poll = await this.pollOf(executor, announcementId);
    if (!poll) return null;
    const options = await executor
      .select({ label: announcementPollOptions.label })
      .from(announcementPollOptions)
      .where(eq(announcementPollOptions.announcementId, announcementId))
      .orderBy(asc(announcementPollOptions.position));
    return auditedPoll({ ...poll, options: options.map((o) => o.label) });
  }

  async hasVotes(tx: Transaction, announcementId: string): Promise<boolean> {
    const [vote] = await tx
      .select({ userId: announcementPollVotes.userId })
      .from(announcementPollVotes)
      .where(eq(announcementPollVotes.announcementId, announcementId))
      .limit(1);
    return !!vote;
  }

  /** Stores, replaces or removes the poll; the caller made sure nobody has voted. */
  async write(tx: Transaction, announcementId: string, poll: PollInput | null): Promise<void> {
    await tx
      .delete(announcementPollOptions)
      .where(eq(announcementPollOptions.announcementId, announcementId));
    await tx.delete(announcementPolls).where(eq(announcementPolls.announcementId, announcementId));
    if (!poll) return;
    await tx.insert(announcementPolls).values({
      announcementId,
      question: poll.question,
      multiple: poll.multiple,
      anonymous: poll.anonymous,
      results: poll.results,
      closesAt: poll.closesAt ? new Date(poll.closesAt) : null,
    });
    await tx
      .insert(announcementPollOptions)
      .values(poll.options.map((label, position) => ({ announcementId, position, label })));
  }

  /** Rule D11: a poll closes 1 hour to 90 days after the announcement is sent, never in the past. */
  assertCloseTime(closesAt: Date | string | null, sentAt: Date, now: Date): void {
    if (closesAt === null) return;
    const time = new Date(closesAt);
    if (!isPollCloseTime(time, sentAt) || time <= now) {
      throw new BadRequestException(
        `Close the poll ${POLL_LIMITS.closeMinHours} hour to ${POLL_LIMITS.closeMaxDays} days after sending`,
      );
    }
  }

  /** Checks the stored poll's closing time against the moment the announcement goes out. */
  async assertStoredCloseTime(tx: Transaction, announcementId: string, sentAt: Date, now: Date) {
    const poll = await this.pollOf(tx, announcementId);
    if (poll) this.assertCloseTime(poll.closesAt, sentAt, now);
  }

  /* Voting and closing */

  /** Rule D11: a recipient's whole vote, which replaces the previous one until the poll closes. */
  async vote(actor: CurrentUserInfo, id: string, input: PollVote): Promise<AnnouncementPoll> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const poll = await this.lockPoll(tx, id);
      const [row] = await tx.select().from(announcements).where(eq(announcements.id, id));
      const receipt = row ? await this.receiptOf(tx, id, actor.id) : null;
      if (!row || !receipt || row.status !== 'sent' || !poll) throw new NotFoundException();
      if (isClosed(poll, now)) throw new CodedException(409, 'POLL_CLOSED', 'The poll is closed');
      if (!poll.multiple && input.optionIds.length > 1) {
        throw new CodedException(400, 'SINGLE_CHOICE', 'One option only');
      }
      const options = await tx
        .select({ id: announcementPollOptions.id })
        .from(announcementPollOptions)
        .where(eq(announcementPollOptions.announcementId, id));
      const known = new Set(options.map((o) => o.id));
      if (!input.optionIds.every((optionId) => known.has(optionId))) {
        throw new BadRequestException('Not an option of this poll');
      }
      await tx
        .delete(announcementPollVotes)
        .where(
          and(
            eq(announcementPollVotes.announcementId, id),
            eq(announcementPollVotes.userId, actor.id),
          ),
        );
      await tx.insert(announcementPollVotes).values(
        input.optionIds.map((optionId) => ({
          announcementId: id,
          optionId,
          userId: actor.id,
          createdAt: now,
        })),
      );
      await this.center.resolve(tx, {
        subject: { type: 'announcement', id },
        types: ['poll_closing'],
        outcome: 'done',
        actorId: actor.id,
        recipients: [actor.id],
      });
    });
    return this.viewOne(actor, id);
  }

  /** Rule D11: the author closes the poll before its time. */
  async close(actor: CurrentUserInfo, id: string): Promise<AnnouncementPoll> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const poll = await this.lockPoll(tx, id);
      const [row] = await tx.select().from(announcements).where(eq(announcements.id, id));
      const receipt = row ? await this.receiptOf(tx, id, actor.id) : null;
      if (!row || !mayRead(actor, row, receipt) || !poll) throw new NotFoundException();
      if (row.authorId !== actor.id) throw new ForbiddenException();
      if (row.status !== 'sent') throw new ConflictException('Only a sent announcement');
      if (poll.closedAt) throw new CodedException(409, 'POLL_CLOSED', 'Already closed');
      await this.closeOne(tx, row, { id: actor.id, name: actor.name }, now);
    });
    return this.viewOne(actor, id);
  }

  /**
   * Closes the poll: no more votes, `poll_closing` voided, `poll_results` to the author (left out
   * when they closed it themselves) and the audit entry.
   */
  private async closeOne(
    tx: Transaction,
    row: AnnouncementRow,
    actor: AuditActor | null,
    now: Date,
  ): Promise<void> {
    await tx
      .update(announcementPolls)
      .set({ closedAt: now })
      .where(eq(announcementPolls.announcementId, row.id));
    const votes = await tx
      .selectDistinct({ userId: announcementPollVotes.userId })
      .from(announcementPollVotes)
      .where(eq(announcementPollVotes.announcementId, row.id));
    await this.center.resolve(tx, {
      subject: { type: 'announcement', id: row.id },
      types: ['poll_closing'],
      outcome: 'void',
      actorId: actor?.id ?? null,
    });
    await this.center.notify(tx, {
      type: 'poll_results',
      recipients: [row.authorId],
      actorId: actor?.id ?? null,
      subjectId: row.id,
      data: { title: row.title, voters: votes.length },
    });
    await recordAudit(tx, {
      actor,
      action: 'announcement_poll.closed',
      entityType: 'announcement',
      entityId: row.id,
      before: { closed: false },
      after: { closed: true, voters: votes.length },
    });
  }

  /* The minute job */

  /** Rule D11 (minute job): closes the polls whose time has come, then reminds non-voters. */
  async runTimed(now: Date): Promise<number> {
    await this.closeDue(now);
    return this.remindClosing(now);
  }

  private async closeDue(now: Date): Promise<void> {
    const due = and(
      isNull(announcementPolls.closedAt),
      lte(announcementPolls.closesAt, now),
      eq(announcements.status, 'sent'),
    ) as SQL;
    const candidates = await this.db
      .select({ id: announcementPolls.announcementId })
      .from(announcementPolls)
      .innerJoin(announcements, eq(announcements.id, announcementPolls.announcementId))
      .where(due);
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Poll closing ${id}`,
      ({ id }) =>
        this.db.transaction(async (tx) => {
          const poll = await this.lockPoll(tx, id);
          const [row] = await tx.select().from(announcements).where(eq(announcements.id, id));
          if (!poll || !row || row.status !== 'sent' || poll.closedAt || !isClosed(poll, now)) {
            return;
          }
          await this.closeOne(tx, row, null, now);
        }),
    );
  }

  /** `poll_closing` once, a day before closing, to the active recipients who have not voted. */
  private async remindClosing(now: Date): Promise<number> {
    const candidates = await this.db
      .select({
        id: announcements.id,
        sentAt: announcements.sentAt,
        closesAt: announcementPolls.closesAt,
      })
      .from(announcementPolls)
      .innerJoin(announcements, eq(announcements.id, announcementPolls.announcementId))
      .where(
        and(
          isNull(announcementPolls.closedAt),
          gt(announcementPolls.closesAt, now),
          lte(
            announcementPolls.closesAt,
            new Date(now.getTime() + POLL_LIMITS.closingLeadHours * HOUR_MS),
          ),
          eq(announcements.status, 'sent'),
        ),
      );
    const due = candidates.filter(({ sentAt, closesAt }) => {
      const at = sentAt ? pollClosingReminderAt(sentAt, closesAt) : null;
      return at !== null && at <= now;
    });
    let sent = 0;
    await runEach(
      due,
      this.logger,
      ({ id }) => `Poll closing reminder ${id}`,
      async ({ id, closesAt }) => {
        const done = await this.db.transaction(async (tx) => {
          // Closed or withdrawn since the candidates were read: no reminder nothing would close.
          const poll = await this.lockPoll(tx, id);
          const [row] = await tx.select().from(announcements).where(eq(announcements.id, id));
          if (!poll || !row || !closesAt || poll.closedAt || row.status !== 'sent') return false;
          const recipients = await tx
            .select({ userId: announcementRecipients.userId })
            .from(announcementRecipients)
            .where(eq(announcementRecipients.announcementId, id));
          const voted = await tx
            .selectDistinct({ userId: announcementPollVotes.userId })
            .from(announcementPollVotes)
            .where(eq(announcementPollVotes.announcementId, id));
          const votedIds = new Set(voted.map((v) => v.userId));
          const pending = await this.users.activeIds(
            recipients.map((r) => r.userId).filter((userId) => !votedIds.has(userId)),
            tx,
          );
          return this.reminders.remindOnce(
            tx,
            { kind: 'poll_closing', subjectId: id, occurrence: businessDate(closesAt) },
            businessDate(now),
            {
              type: 'poll_closing',
              recipients: pending,
              actorId: null,
              subjectId: id,
              data: { title: row.title, closesAt: closesAt.toISOString() },
            },
          );
        });
        if (done) sent += 1;
      },
    );
    return sent;
  }

  /* Reading */

  /**
   * The polls of readable announcements as the caller may see them (rule D11): counts for the
   * author and managers, and for recipients once they voted or the poll closed when the results
   * are for everyone; names for the author and managers of a named poll only.
   */
  async views(
    actor: CurrentUserInfo,
    rows: readonly { row: AnnouncementRow; receipt: RecipientRow | null }[],
  ): Promise<Map<string, AnnouncementPoll>> {
    const ids = rows.map(({ row }) => row.id);
    if (ids.length === 0) return new Map();
    const now = new Date();
    const polls = await this.db
      .select()
      .from(announcementPolls)
      .where(inArray(announcementPolls.announcementId, ids));
    if (polls.length === 0) return new Map();
    const pollIds = polls.map((p) => p.announcementId);
    const options = await this.db
      .select()
      .from(announcementPollOptions)
      .where(inArray(announcementPollOptions.announcementId, pollIds))
      .orderBy(asc(announcementPollOptions.position));
    const votes = await this.db
      .select()
      .from(announcementPollVotes)
      .where(inArray(announcementPollVotes.announcementId, pollIds));
    const people = await this.users.summaries([...new Set(votes.map((v) => v.userId))]);
    const byId = new Map(rows.map((entry) => [entry.row.id, entry]));
    return new Map(
      polls.map((poll) => {
        const { row, receipt } = byId.get(poll.announcementId) as {
          row: AnnouncementRow;
          receipt: RecipientRow | null;
        };
        return [
          poll.announcementId,
          this.view(actor, row, receipt, poll, {
            options: options.filter((o) => o.announcementId === poll.announcementId),
            votes: votes.filter((v) => v.announcementId === poll.announcementId),
            name: (userId) => people.get(userId)?.name ?? '',
            now,
          }),
        ];
      }),
    );
  }

  private view(
    actor: CurrentUserInfo,
    row: AnnouncementRow,
    receipt: RecipientRow | null,
    poll: PollRow,
    context: {
      options: OptionRow[];
      votes: VoteRow[];
      name: (userId: string) => string;
      now: Date;
    },
  ): AnnouncementPoll {
    const { options, votes, name, now } = context;
    const closed = isClosed(poll, now);
    const privileged = row.authorId === actor.id || managesAll(actor.access);
    const myVote = votes.filter((v) => v.userId === actor.id).map((v) => v.optionId);
    const seesCounts =
      privileged || (poll.results === 'everyone_after_voting' && (myVote.length > 0 || closed));
    const seesNames = privileged && !poll.anonymous;
    return {
      question: poll.question,
      multiple: poll.multiple,
      anonymous: poll.anonymous,
      results: poll.results,
      closesAt: poll.closesAt?.toISOString() ?? null,
      closedAt: poll.closedAt?.toISOString() ?? null,
      closed,
      options: options.map((option) => {
        const chosen = votes.filter((v) => v.optionId === option.id);
        return {
          id: option.id,
          label: option.label,
          votes: seesCounts ? chosen.length : null,
          voters: seesNames ? chosen.map((v) => ({ id: v.userId, name: name(v.userId) })) : null,
        };
      }),
      voters: seesCounts ? new Set(votes.map((v) => v.userId)).size : null,
      myVote: options.filter((o) => myVote.includes(o.id)).map((o) => o.id),
      rights: {
        vote: !!receipt && row.status === 'sent' && !closed,
        close: row.authorId === actor.id && row.status === 'sent' && poll.closedAt === null,
      },
    };
  }

  private async viewOne(actor: CurrentUserInfo, id: string): Promise<AnnouncementPoll> {
    const [row] = await this.db.select().from(announcements).where(eq(announcements.id, id));
    if (!row) throw new NotFoundException();
    const receipt = await this.receiptOf(this.db, id, actor.id);
    const poll = (await this.views(actor, [{ row, receipt }])).get(id);
    if (!poll) throw new NotFoundException();
    return poll;
  }

  /** The poll locked against votes, closing and edits; null without one. */
  async lockPoll(tx: Transaction, id: string) {
    const [poll] = await tx
      .select()
      .from(announcementPolls)
      .where(eq(announcementPolls.announcementId, id))
      .for('update');
    return poll ?? null;
  }

  private async receiptOf(executor: Database | Transaction, id: string, userId: string) {
    const [receipt] = await executor
      .select()
      .from(announcementRecipients)
      .where(
        and(
          eq(announcementRecipients.announcementId, id),
          eq(announcementRecipients.userId, userId),
        ),
      );
    return receipt ?? null;
  }
}

/** A poll input or stored poll as an audit entry keeps it. */
export function auditedPoll(
  poll: Pick<PollInput, 'question' | 'multiple' | 'anonymous' | 'results'> & {
    options: readonly string[];
    closesAt: Date | string | null;
  },
): AuditedPoll {
  return {
    question: poll.question,
    options: [...poll.options],
    multiple: poll.multiple,
    anonymous: poll.anonymous,
    results: poll.results,
    closesAt: poll.closesAt === null ? null : new Date(poll.closesAt).toISOString(),
  };
}
