import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  addMonths,
  type CalendarDate,
  type CalendarIssue,
  type CalendarOccasion,
  type ClientPlanning,
  type ContentGrid,
  type ContentGridQuery,
  type ContentPlanning,
  type ContentPlanningQuery,
  commitmentsOf,
  contentWeekSubjectId,
  firstOfMonth,
  lastOfMonth,
  occasionYearKey,
  type PlannedPost,
  pillarBalance,
  planningIssues,
} from '@vertex-hub/contracts';
import { contentPosts, type Database, type Transaction } from '@vertex-hub/db';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory, clientRef } from '../clients/index.js';
import type { Notice } from '../notifications/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { ContentOccasionsService, type DatedOccasion } from './content-occasions.service.js';
import { type ClientPlanningSettings, ContentSettingsService } from './content-settings.service.js';
import { holdsAll } from './post-access.js';
import { PostMedia } from './post-media.js';
import { toTimeOfDay } from './post-notices.js';

type Executor = Database | Transaction;

type ContentCycle = Awaited<ReturnType<EngagementDirectory['openContentCycles']>>[number];

/** One client's planning check over a range. */
type ClientPlan = Omit<ClientPlanning, 'client'>;

/**
 * The planning aids read on demand (spec F08B rules C2, C4–C11): occasions and planning marks
 * for the calendar, the Planning check, the Instagram grid and the weekly notice. Nothing is
 * stored: the check is computed by `planningIssues` from the posts, settings, occasions and open
 * cycles (ADR 0042).
 */
@Injectable()
export class ContentPlanner {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly settings: ContentSettingsService,
    private readonly occasions: ContentOccasionsService,
    private readonly media: PostMedia,
  ) {}

  /** The calendar's occasions and marks for a range, of one client or of all (rule C10). */
  async calendarOverlays(
    from: CalendarDate,
    to: CalendarDate,
    clientId?: string,
  ): Promise<{ occasions: CalendarOccasion[]; issues: CalendarIssue[] }> {
    const plans = await this.plans(clientId ? [clientId] : null, from, to);
    const issues = [...plans.entries()].flatMap(([id, plan]) =>
      plan.issues.map((issue) => ({ ...issue, clientId: id })),
    );
    if (!clientId) {
      const dated = await this.occasions.inRange(from, to);
      return { occasions: this.calendarOccasions(dated, null), issues };
    }
    const client = await this.clients.summary(clientId);
    if (!client) return { occasions: [], issues };
    const settings = await this.settings.planningSettings(client);
    const applying = (await this.occasions.applying([{ id: client.id, settings }], from, to)).get(
      client.id,
    );
    const covered = (await this.coveredOccasions([client.id])).get(client.id) ?? new Set<string>();
    return {
      occasions: this.calendarOccasions(applying ?? [], { covered, settings }),
      issues,
    };
  }

  /** `GET /content/planning`: per eligible client, its issues, pillar balance and commitments. */
  async planning(actor: CurrentUserInfo, query: ContentPlanningQuery): Promise<ContentPlanning> {
    if (!holdsAll(actor, 'content.read')) throw new ForbiddenException();
    const plans = await this.plans(query.clientId ? [query.clientId] : null, query.from, query.to);
    const clients = await this.clients.summaries([...plans.keys()]);
    return {
      from: query.from,
      to: query.to,
      clients: [...plans.entries()]
        .map(([id, plan]) => ({ client: clientRef(clients, id), ...plan }))
        .sort((a, b) => a.client.name.localeCompare(b.client.name, 'ar')),
    };
  }

  /** Rule C11: the client's Instagram feed posts of the month and the two before, newest first. */
  async grid(actor: CurrentUserInfo, query: ContentGridQuery): Promise<ContentGrid> {
    if (!holdsAll(actor, 'content.read')) throw new ForbiddenException();
    const client = await this.clients.summary(query.clientId);
    if (!client || client.archived) throw new NotFoundException();
    const end = lastOfMonth(`${query.month}-01`);
    const start = firstOfMonth(addMonths(`${query.month}-01`, -2));
    const rows = await this.db
      .select()
      .from(contentPosts)
      .where(
        and(
          eq(contentPosts.clientId, client.id),
          this.plannedSql(),
          inArray(contentPosts.type, ['post', 'carousel', 'reel']),
          sqlHasInstagram(),
          gte(contentPosts.publishDate, start),
          lte(contentPosts.publishDate, end),
        ),
      )
      .orderBy(
        desc(contentPosts.publishDate),
        desc(contentPosts.publishTime),
        desc(contentPosts.id),
      );
    const work = await this.media.of(rows.map((row) => row.id));
    return {
      client: { id: client.id, name: client.name, imageId: client.imageId },
      month: query.month,
      tiles: rows.map((row) => ({
        postId: row.id,
        title: row.title,
        type: row.type,
        status: row.status,
        publishDate: row.publishDate,
        publishTime: toTimeOfDay(row.publishTime),
        // Its first slide, when it has a preview.
        thumbnailVersionId: (() => {
          const first = work.get(row.id)?.media[0];
          return first?.previewStatus === 'ready' ? first.id : null;
        })(),
      })),
    };
  }

  /**
   * Rule C10 and Part D: the weekly notice for Content Management, the clients with planning
   * issues in the 14 days from `from` (the week's first work day); null when there are none.
   */
  async weekCheck(
    from: CalendarDate,
    recipients: readonly string[],
    executor: Executor = this.db,
  ): Promise<Notice | null> {
    const to = addDays(from, 13);
    const plans = await this.plans(null, from, to, executor);
    const counted = [...plans.entries()].filter(([, plan]) => plan.issues.length > 0);
    if (counted.length === 0 || recipients.length === 0) return null;
    const clients = await this.clients.summaries(
      counted.map(([id]) => id),
      executor,
    );
    return {
      type: 'content_week_check',
      recipients: [...recipients],
      actorId: null,
      subjectId: contentWeekSubjectId(from),
      data: {
        from,
        to,
        clients: counted
          .map(([id, plan]) => ({ name: clients.get(id)?.name ?? '', issues: plan.issues.length }))
          .sort((a, b) => b.issues - a.issues || a.name.localeCompare(b.name, 'ar'))
          .slice(0, 50),
      },
    } as Notice;
  }

  /**
   * Rule C10: the clients the check applies to (an open cycle with a content line, or settings
   * saved), each with its plan over `[from, to]`. `clientIds` narrows them; null: every one.
   */
  private async plans(
    clientIds: readonly string[] | null,
    from: CalendarDate,
    to: CalendarDate,
    executor: Executor = this.db,
  ): Promise<Map<string, ClientPlan>> {
    const [cycles, withSettings] = await Promise.all([
      this.engagements.openContentCycles(clientIds, executor),
      this.settings.clientsWithSettings(executor),
    ]);
    const eligible = [
      ...new Set([
        ...cycles.map((cycle) => cycle.clientId),
        ...withSettings.filter((id) => !clientIds || clientIds.includes(id)),
      ]),
    ];
    const clients = [...(await this.clients.summaries(eligible, executor)).values()].filter(
      (client) => !client.archived,
    );
    if (clients.length === 0) return new Map();
    const settings = await this.settings.planningSettingsOf(clients, executor);
    const cyclesOf = (clientId: string) => cycles.filter((cycle) => cycle.clientId === clientId);
    // The posts the cycles, the month of `from` and the range need.
    const start =
      [firstOfMonth(from), ...cycles.map((cycle) => cycle.periodStart)].sort()[0] ?? from;
    const end =
      [to, lastOfMonth(from), ...cycles.map((cycle) => cycle.periodEnd)].sort().at(-1) ?? to;
    const [posts, applying, covered, pillars] = await Promise.all([
      this.plannedPosts(
        clients.map((client) => client.id),
        start,
        end,
        executor,
      ),
      this.occasions.applying(
        clients.map((client) => ({
          id: client.id,
          settings: settings.get(client.id) as ClientPlanningSettings,
        })),
        from,
        to,
        executor,
      ),
      this.coveredOccasions(
        clients.map((client) => client.id),
        executor,
      ),
      this.settings.pillars(executor),
    ]);
    const pillarIds = pillars.items.filter((pillar) => !pillar.archived).map((pillar) => pillar.id);
    return new Map(
      clients.map((client) => {
        const own = settings.get(client.id) as ClientPlanningSettings;
        const clientPosts = posts.get(client.id) ?? [];
        // Rule C6: a post of the occurrence's year outside the range covers it too.
        const coveredKeys = covered.get(client.id) ?? new Set<string>();
        const occasions = (applying.get(client.id) ?? []).flatMap((item) =>
          item.occurrences.map((occurrence) => ({
            id: item.row.id,
            start: occurrence.start,
            end: occurrence.end,
            leadDays: item.row.leadDays,
            skipped: own.skippedOccasions.some(
              (skip) => skip.occasionId === item.row.id && skip.year === occurrence.year,
            ),
          })),
        );
        const issues = planningIssues({
          from,
          to,
          maxGapDays: own.maxGapDays,
          posts: clientPosts,
          occasions,
          commitments: cyclesOf(client.id).map((cycle) => ({
            cycleId: cycle.cycleId,
            from: cycle.periodStart,
            to: cycle.periodEnd,
            lines: cycle.lines,
          })),
          pillarTargets: own.pillarTargets,
          pillarIds,
        }).filter(
          (issue) =>
            issue.kind !== 'occasion_uncovered' ||
            !coveredKeys.has(occasionYearKey(issue.occasionId ?? '', issue.date)),
        );
        const month = clientPosts.filter(
          (post) => firstOfMonth(from) <= post.publishDate && post.publishDate <= lastOfMonth(from),
        );
        return [
          client.id,
          {
            issues,
            pillarBalance: {
              month: from.slice(0, 7),
              posts: month.length,
              items: pillarBalance(month, own.pillarTargets, pillarIds),
            },
            commitments: cyclesOf(client.id).flatMap((cycle: ContentCycle) =>
              commitmentsOf(
                {
                  cycleId: cycle.cycleId,
                  from: cycle.periodStart,
                  to: cycle.periodEnd,
                  lines: cycle.lines,
                },
                clientPosts,
              ).map((line) => ({
                cycleId: cycle.cycleId,
                retainer: { id: cycle.retainerId, name: cycle.retainerName },
                from: cycle.periodStart,
                to: cycle.periodEnd,
                ...line,
              })),
            ),
          },
        ];
      }),
    );
  }

  /** The clients' planned posts in `[from, to]`: neither cancelled nor archived. */
  private async plannedPosts(
    clientIds: string[],
    from: CalendarDate,
    to: CalendarDate,
    executor: Executor,
  ): Promise<Map<string, PlannedPost[]>> {
    const rows = await executor
      .select()
      .from(contentPosts)
      .where(
        and(
          inArray(contentPosts.clientId, clientIds),
          this.plannedSql(),
          gte(contentPosts.publishDate, from),
          lte(contentPosts.publishDate, to),
        ),
      )
      .orderBy(asc(contentPosts.publishDate), asc(contentPosts.publishTime), asc(contentPosts.id));
    const posts = new Map<string, PlannedPost[]>();
    for (const row of rows) {
      posts.set(row.clientId, [
        ...(posts.get(row.clientId) ?? []),
        {
          id: row.id,
          type: row.type,
          platforms: row.platforms,
          publishDate: row.publishDate,
          publishTime: toTimeOfDay(row.publishTime),
          pillarId: row.pillarId,
          occasionId: row.occasionId,
        },
      ]);
    }
    return posts;
  }

  /**
   * Rule C6: the occasions a non-cancelled, non-archived post of each client carries, by the
   * year of its publish date (`occasionYearKey`).
   */
  private async coveredOccasions(
    ids: string[],
    executor: Executor = this.db,
  ): Promise<Map<string, Set<string>>> {
    const rows =
      ids.length === 0
        ? []
        : await executor
            .selectDistinct({
              clientId: contentPosts.clientId,
              occasionId: contentPosts.occasionId,
              year: sql<number>`extract(year from ${contentPosts.publishDate})::int`,
            })
            .from(contentPosts)
            .where(
              and(
                inArray(contentPosts.clientId, ids),
                this.plannedSql(),
                isNotNull(contentPosts.occasionId),
              ),
            );
    const covered = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
    for (const row of rows) {
      if (row.occasionId) covered.get(row.clientId)?.add(occasionYearKey(row.occasionId, row.year));
    }
    return covered;
  }

  private calendarOccasions(
    dated: readonly DatedOccasion[],
    client: { covered: Set<string>; settings: ClientPlanningSettings } | null,
  ): CalendarOccasion[] {
    return dated
      .flatMap((item) =>
        item.occurrences.map((occurrence) => ({
          id: item.row.id,
          name: item.row.name,
          category: item.row.category,
          clientId: item.row.clientId,
          startDate: occurrence.start,
          endDate: occurrence.end,
          leadDays: item.row.leadDays,
          confirmed: occurrence.confirmed,
          covered: client
            ? client.covered.has(occasionYearKey(item.row.id, occurrence.year))
            : null,
          skipped: client
            ? client.settings.skippedOccasions.some(
                (skip) => skip.occasionId === item.row.id && skip.year === occurrence.year,
              )
            : null,
        })),
      )
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name, 'ar'));
  }

  /** Neither cancelled nor archived, of a live client. */
  private plannedSql(): SQL {
    return and(
      ne(contentPosts.status, 'cancelled'),
      isNull(contentPosts.archivedAt),
      this.clients.isLive(contentPosts.clientId),
    ) as SQL;
  }
}

/** A post on Instagram. */
const sqlHasInstagram = (): SQL => sql`'instagram' = any(${contentPosts.platforms})`;
