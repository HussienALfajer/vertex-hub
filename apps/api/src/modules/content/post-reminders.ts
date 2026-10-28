import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  businessDate,
  businessInstant,
  type CalendarDate,
  contentWeekSubjectId,
  type HolidayRange,
  isWorkDay,
  type NotificationReminderKind,
  nextWorkDay,
  nthWorkDay,
  type PostRiskWait,
  type PostStatus,
  timedReminderWindow,
  weekOf,
} from '@vertex-hub/contracts';
import { contentPosts, type Database, type Transaction } from '@vertex-hub/db';
import { and, asc, between, eq, gte, inArray, isNotNull, lt, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { HolidayCalendar } from '../hr/index.js';
import { DailyReminders, type Notice, TimedNotifications } from '../notifications/index.js';
import { PostTasks } from '../tasks/index.js';
import { atRiskUntil, ContentService } from './content.service.js';
import { ContentPlanner } from './content-planner.js';
import type { PostAccess } from './post-access.js';
import { PostNotices, toTimeOfDay } from './post-notices.js';
import { PostReviews } from './post-reviews.js';

/** F08B `post_at_risk`: open and not approved yet. */
const NOT_APPROVED: PostStatus[] = ['idea', 'in_production', 'internal_review', 'awaiting_client'];

/**
 * The post reminders of the `notifications.daily` job (spec F08, "Jobs"): the publish day, and a
 * publish date that passed without publishing. Each is sent once per post and publish date; a
 * new date starts again.
 */
@Injectable()
export class PostReminders implements OnModuleInit {
  private readonly logger = new Logger(PostReminders.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly content: ContentService,
    private readonly notices: PostNotices,
    private readonly reminders: DailyReminders,
    private readonly timed: TimedNotifications,
    private readonly holidays: HolidayCalendar,
    private readonly users: UserDirectory,
    private readonly tasks: PostTasks,
    private readonly reviews: PostReviews,
    private readonly planner: ContentPlanner,
  ) {}

  onModuleInit(): void {
    this.reminders.register('content', (today) => this.remind(today));
    this.timed.register('content', (now) => this.publishShortly(now));
  }

  /**
   * F16 rule B13: `post_publish_shortly` two hours before the publish time of an approved post
   * not yet scheduled (F08B: a scheduled post needs no hand), once per post and publish time;
   * work days do not apply.
   */
  async publishShortly(now: Date): Promise<number> {
    const { from, to } = timedReminderWindow('post_publish_shortly', now);
    const filters = [
      eq(contentPosts.status, 'approved'),
      isNotNull(contentPosts.publishTime),
      between(contentPosts.publishDate, businessDate(from), businessDate(to)),
    ];
    const candidates = await this.db
      .select({ id: contentPosts.id })
      .from(contentPosts)
      .where(this.eligible(filters))
      .orderBy(asc(contentPosts.id));
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Post publish-shortly reminder ${id}`,
      async ({ id }) => {
        const recorded = await this.db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(contentPosts)
            .where(and(eq(contentPosts.id, id), this.eligible(filters)))
            .for('update', { of: contentPosts });
          const client = row && (await this.clients.summary(row.clientId, tx));
          const time = row && toTimeOfDay(row.publishTime);
          if (!row || !client || !time) return false;
          const occursAt = businessInstant(row.publishDate, time);
          // The moment is in the window: not passed (edge case 15), not yet two hours away.
          if (occursAt <= from || occursAt > to) return false;
          const post = { ...row, client };
          return this.timed.remindOnce(
            tx,
            { kind: 'post_publish_shortly', subjectId: id, occursAt },
            this.notices.notice(post, 'post_publish_shortly', [post.responsibleId], null),
          );
        });
        if (recorded) sent += 1;
      },
    );
    return sent;
  }

  /** F17 rule B1: public holidays are not work days. */
  async remind(today: CalendarDate): Promise<number> {
    const holidays = await this.holidays.from(today);
    if (!isWorkDay(today, holidays)) return 0;
    let sent = 0;
    // The two kinds run independently: one failing does not hold back the other.
    const kinds: [string, () => Promise<number>][] = [
      ['Publish-today reminders', () => this.publishToday(today, holidays)],
      ['Publish-overdue reminders', () => this.publishOverdue(today)],
      ['At-risk reminders', () => this.atRisk(today, holidays)],
      ['Weekly content check', () => this.weekCheck(today, holidays)],
    ];
    await runEach(
      kinds,
      this.logger,
      ([name]) => name,
      async ([, run]) => {
        sent += await run();
      },
    );
    return sent;
  }

  /** Posts to publish today, or on a later day before the next work day (Friday, on Thursday). */
  private publishToday(today: CalendarDate, holidays: readonly HolidayRange[]): Promise<number> {
    const filters = [
      gte(contentPosts.publishDate, today),
      lt(contentPosts.publishDate, nextWorkDay(today, holidays)),
    ];
    return this.send(today, 'post_publish_today', filters, (post) =>
      this.notices.notice(post, 'post_publish_today', [post.responsibleId], null),
    );
  }

  /** Posts whose publish date passed: the responsible person and the client's account manager. */
  private publishOverdue(today: CalendarDate): Promise<number> {
    return this.send(today, 'post_publish_overdue', [lt(contentPosts.publishDate, today)], (post) =>
      this.notices.notice(
        post,
        'post_publish_overdue',
        [post.responsibleId, post.client.accountManagerId],
        null,
      ),
    );
  }

  /**
   * F08B: an open post not yet approved whose publish date is within two work days, to its
   * responsible and the account manager, once per post and publish date, with what it waits on.
   */
  private atRisk(today: CalendarDate, holidays: readonly HolidayRange[]): Promise<number> {
    const filters = [between(contentPosts.publishDate, today, atRiskUntil(today, holidays))];
    return this.send(
      today,
      'post_at_risk',
      filters,
      async (post, tx) => {
        let waitingOn: PostRiskWait = 'production';
        let taskNames: string[] = [];
        let clientSince: CalendarDate | null = null;
        if (post.status === 'internal_review') {
          waitingOn = post.reviewStage === 'medical' ? 'medical_review' : 'internal_review';
        } else if (post.status === 'awaiting_client') {
          waitingOn = 'client';
          clientSince = businessDate((await this.reviews.clearedPass(tx, post)).createdAt);
        } else {
          const open = ((await this.tasks.linked([post.id], tx)).get(post.id) ?? []).filter(
            (task) => task.status !== 'approved',
          );
          if (open.length > 0) {
            waitingOn = 'tasks';
            taskNames = open.slice(0, 5).map((task) => task.title);
          }
        }
        return this.notices.notice(
          post,
          'post_at_risk',
          [post.responsibleId, post.client.accountManagerId],
          null,
          { waitingOn, tasks: taskNames, clientSince },
        );
      },
      NOT_APPROVED,
    );
  }

  /**
   * F08B rule C10: on the week's first work day (Saturday, or the next work day after a
   * holiday), one notice to every member of Content Management listing the clients with planning
   * issues in the next 14 days; once per week.
   */
  private async weekCheck(today: CalendarDate, holidays: readonly HolidayRange[]): Promise<number> {
    if (nthWorkDay(weekOf(today).from, 1, holidays) !== today) return 0;
    const members = await this.users.functionMembers(['content_management']);
    const notice = await this.planner.weekCheck(
      today,
      members.map((member) => member.id),
    );
    if (!notice) return 0;
    const sent = await this.db.transaction((tx) =>
      this.reminders.remindOnce(
        tx,
        { kind: 'content_week_check', subjectId: contentWeekSubjectId(today), occurrence: today },
        today,
        notice,
      ),
    );
    return sent ? 1 : 0;
  }

  /** Posts shown in calendars (not archived) in `statuses` matching `filters`. */
  private eligible(
    filters: SQL[],
    statuses: readonly PostStatus[] = ['approved', 'scheduled'],
  ): SQL {
    return and(
      inArray(contentPosts.status, [...statuses]),
      this.content.visibleSql(),
      ...filters,
    ) as SQL;
  }

  /**
   * One transaction per reminder (F14 rule 8). The post is locked and checked again inside it,
   * so a post published or re-dated since the candidates were read gets no stale notice; the
   * reminder is recorded first and sent only if this run recorded it.
   */
  private async send(
    today: CalendarDate,
    kind: Extract<NotificationReminderKind, `post_${string}`>,
    filters: SQL[],
    build: (post: PostAccess, tx: Transaction) => Notice | Promise<Notice>,
    statuses?: readonly PostStatus[],
  ): Promise<number> {
    const candidates = await this.db
      .select({ id: contentPosts.id })
      .from(contentPosts)
      .where(this.eligible(filters, statuses))
      .orderBy(asc(contentPosts.id));
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Post ${kind} reminder ${id}`,
      async ({ id }) => {
        const recorded = await this.db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(contentPosts)
            .where(and(eq(contentPosts.id, id), this.eligible(filters, statuses)))
            .for('update', { of: contentPosts });
          const client = row && (await this.clients.summary(row.clientId, tx));
          if (!row || !client) return false;
          const key = { kind, subjectId: row.id, occurrence: row.publishDate };
          return this.reminders.remindOnce(tx, key, today, await build({ ...row, client }, tx));
        });
        if (recorded) sent += 1;
      },
    );
    return sent;
  }
}
