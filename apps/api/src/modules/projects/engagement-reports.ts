import { Inject, Injectable } from '@nestjs/common';
import {
  businessDate,
  type CalendarDate,
  type ClientMonthlyReport,
  deliveryRate,
  OPEN_PROJECT_STATUSES,
  type ProjectStatus,
  type ReportClients,
  type ReportPeriod,
} from '@vertex-hub/contracts';
import { type Database, projectMilestones, projects, retainers } from '@vertex-hub/db';
import { and, asc, count, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { businessDateSql, inBusinessPeriod } from '../../core/database/business-date.js';
import { DATABASE } from '../../core/database/database.module.js';
import { ClientDirectory } from '../clients/index.js';
import { RetainerCyclesService } from './retainer-cycles.service.js';
import { NO_TASKS, WorkProgress } from './work-progress.js';

/** This month's cycle of an active retainer (F15 rules 1, 4 and 6). */
export interface RetainerProgress {
  clientId: string;
  retainer: { id: string; name: string };
  cycleId: string;
  /** R13, whole percent; null when nothing is committed. */
  completion: number | null;
  linesBehind: number;
}

/**
 * Read-only figures of projects and retainers for dashboards and reports (F15, ADR 0027): only
 * non-archived engagements of non-archived clients. Callers check the scope.
 */
@Injectable()
export class EngagementReports {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly cycles: RetainerCyclesService,
    private readonly progress: WorkProgress,
  ) {}

  /** Rule 1: open projects by status and active retainers. */
  async activeCounts(): Promise<{
    projects: { status: ProjectStatus; count: number }[];
    retainers: number;
  }> {
    const [byStatus, [active]] = await Promise.all([
      this.db
        .select({ status: projects.status, count: count() })
        .from(projects)
        .where(
          and(
            inArray(projects.status, [...OPEN_PROJECT_STATUSES]),
            isNull(projects.archivedAt),
            this.clients.isLive(projects.clientId),
          ),
        )
        .groupBy(projects.status),
      this.db.select({ value: count() }).from(retainers).where(this.activeRetainers('all')),
    ]);
    const counts = new Map(byStatus.map((row) => [row.status, row.count]));
    return {
      projects: OPEN_PROJECT_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 })),
      retainers: active?.value ?? 0,
    };
  }

  /** Open projects per client. */
  async openProjects(clientIds: readonly string[]): Promise<Map<string, number>> {
    if (clientIds.length === 0) return new Map();
    const rows = await this.db
      .select({ clientId: projects.clientId, count: count() })
      .from(projects)
      .where(
        and(
          inArray(projects.clientId, [...clientIds]),
          inArray(projects.status, [...OPEN_PROJECT_STATUSES]),
          isNull(projects.archivedAt),
        ),
      )
      .groupBy(projects.clientId);
    return new Map(rows.map((row) => [row.clientId, row.count]));
  }

  /** Rules 1, 4 and 6: the open cycle of each active retainer, with its completion and lines behind. */
  async retainerProgress(
    clients: ReportClients,
    today: CalendarDate = businessDate(),
  ): Promise<RetainerProgress[]> {
    const rows = await this.db
      .select({ id: retainers.id, name: retainers.name, clientId: retainers.clientId })
      .from(retainers)
      .where(this.activeRetainers(clients))
      .orderBy(asc(retainers.name));
    const cycles = await this.cycles.openOf(
      rows.map((row) => row.id),
      today,
    );
    const byRetainer = new Map(cycles.map((cycle) => [cycle.retainerId, cycle]));
    return rows.flatMap((row) => {
      const cycle = byRetainer.get(row.id);
      if (!cycle) return [];
      return [
        {
          clientId: row.clientId,
          retainer: { id: row.id, name: row.name },
          cycleId: cycle.id,
          completion: cycle.deliveryRate,
          linesBehind: cycle.lines.filter((line) => line.behind).length,
        },
      ];
    });
  }

  /**
   * F15 rule 18.2: the client's non-archived retainers with a cycle in the month, by name, each
   * line with its committed and delivered counts (frozen for a closed cycle).
   */
  async clientRetainers(
    clientId: string,
    period: ReportPeriod,
  ): Promise<ClientMonthlyReport['retainers']> {
    const rows = await this.db
      .select({ id: retainers.id, name: retainers.name, status: retainers.status })
      .from(retainers)
      .where(and(eq(retainers.clientId, clientId), isNull(retainers.archivedAt)))
      .orderBy(asc(retainers.name), asc(retainers.id));
    const cycles = await this.cycles.ofMonth(
      new Map(rows.map((row) => [row.id, row.status])),
      period.from,
    );
    const byRetainer = new Map(cycles.map((cycle) => [cycle.retainerId, cycle]));
    return rows.flatMap((row) => {
      const cycle = byRetainer.get(row.id);
      if (!cycle) return [];
      return [
        {
          retainer: { id: row.id, name: row.name },
          status: cycle.status,
          lines: cycle.lines.map((line) => ({
            kind: line.kind,
            label: line.label,
            committed: line.committed,
            delivered: line.delivered,
            percent: deliveryRate([line]),
          })),
          completion: cycle.deliveryRate,
        },
      ];
    });
  }

  /**
   * F15 rule 18.3: the client's non-archived projects open at some point in the period (started
   * by its end, not completed or cancelled before it), by name, with their task progress and the
   * milestones done in the period.
   */
  async clientProjects(
    clientId: string,
    period: ReportPeriod,
  ): Promise<ClientMonthlyReport['projects']> {
    const rows = await this.db
      .select({ id: projects.id, name: projects.name, status: projects.status })
      .from(projects)
      .where(
        and(
          eq(projects.clientId, clientId),
          isNull(projects.archivedAt),
          lte(projects.startDate, period.to),
          or(isNull(projects.completedAt), gte(businessDateSql(projects.completedAt), period.from)),
          or(isNull(projects.cancelledAt), gte(businessDateSql(projects.cancelledAt), period.from)),
        ),
      )
      .orderBy(asc(projects.name), asc(projects.id));
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return [];
    const [counts, milestones] = await Promise.all([
      this.progress.projects(ids),
      this.db
        .select({
          projectId: projectMilestones.projectId,
          name: projectMilestones.name,
          doneAt: projectMilestones.doneAt,
        })
        .from(projectMilestones)
        .where(
          and(
            inArray(projectMilestones.projectId, ids),
            eq(projectMilestones.status, 'done'),
            isNull(projectMilestones.archivedAt),
            inBusinessPeriod(projectMilestones.doneAt, period),
          ),
        )
        .orderBy(asc(projectMilestones.doneAt), asc(projectMilestones.position)),
    ]);
    return rows.map((row) => {
      const tasks = counts.get(row.id) ?? NO_TASKS;
      return {
        project: { id: row.id, name: row.name },
        status: row.status,
        deliveredTasks: tasks.delivered,
        totalTasks: tasks.total,
        milestonesDone: milestones.flatMap((milestone) =>
          milestone.projectId === row.id && milestone.doneAt
            ? [{ name: milestone.name, doneOn: businessDate(milestone.doneAt) }]
            : [],
        ),
      };
    });
  }

  private activeRetainers(clients: ReportClients) {
    return and(
      eq(retainers.status, 'active'),
      isNull(retainers.archivedAt),
      this.clients.isLive(retainers.clientId),
      clients === 'all'
        ? undefined
        : clients.length === 0
          ? sql`false`
          : inArray(retainers.clientId, [...clients]),
    );
  }
}
