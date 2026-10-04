import { Inject, Injectable } from '@nestjs/common';
import {
  businessDate,
  type CalendarDate,
  OPEN_PROJECT_STATUSES,
  type ProjectStatus,
  type ReportClients,
} from '@vertex-hub/contracts';
import { type Database, projects, retainers } from '@vertex-hub/db';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { ClientDirectory } from '../clients/index.js';
import { RetainerCyclesService } from './retainer-cycles.service.js';

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
