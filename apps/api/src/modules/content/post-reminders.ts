import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type CalendarDate,
  isWorkDay,
  type NotificationReminderKind,
  nextWorkDay,
} from '@vertex-hub/contracts';
import { contentPosts, type Database } from '@vertex-hub/db';
import { and, asc, eq, gte, inArray, lt, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { ClientDirectory } from '../clients/index.js';
import { DailyReminders, type Notice } from '../notifications/index.js';
import { ContentService } from './content.service.js';
import type { PostAccess } from './post-access.js';
import { PostNotices } from './post-notices.js';

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
  ) {}

  onModuleInit(): void {
    this.reminders.register('content', (today) => this.remind(today));
  }

  async remind(today: CalendarDate): Promise<number> {
    if (!isWorkDay(today)) return 0;
    let sent = 0;
    // The two kinds run independently: one failing does not hold back the other.
    const kinds: [string, () => Promise<number>][] = [
      ['Publish-today reminders', () => this.publishToday(today)],
      ['Publish-overdue reminders', () => this.publishOverdue(today)],
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
  private publishToday(today: CalendarDate): Promise<number> {
    const filters = [
      gte(contentPosts.publishDate, today),
      lt(contentPosts.publishDate, nextWorkDay(today)),
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

  /** Approved or scheduled posts shown in calendars (not archived) matching `filters`. */
  private eligible(filters: SQL[]): SQL {
    return and(
      inArray(contentPosts.status, ['approved', 'scheduled']),
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
    build: (post: PostAccess) => Notice,
  ): Promise<number> {
    const candidates = await this.db
      .select({ id: contentPosts.id })
      .from(contentPosts)
      .where(this.eligible(filters))
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
            .where(and(eq(contentPosts.id, id), this.eligible(filters)))
            .for('update', { of: contentPosts });
          const client = row && (await this.clients.summary(row.clientId, tx));
          if (!row || !client) return false;
          const key = { kind, subjectId: row.id, occurrence: row.publishDate };
          return this.reminders.remindOnce(tx, key, today, build({ ...row, client }));
        });
        if (recorded) sent += 1;
      },
    );
    return sent;
  }
}
