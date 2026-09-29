import { Inject, Injectable } from '@nestjs/common';
import {
  type CycleStatus,
  type DeliverableKind,
  type ExtraWorkBilling,
  isProjectClosed,
  type MilestoneStatus,
  PROJECT_LIMITS,
  type ProjectStatus,
  type RetainerStatus,
} from '@vertex-hub/contracts';
import {
  type Database,
  extraWorkItems,
  projectMilestones,
  projects,
  retainerCycleLines,
  retainerCycles,
  retainers,
  type Transaction,
} from '@vertex-hub/db';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableName,
  inArray,
  isNull,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { assertClientTakesWork, readableProject, workableProject } from './project-access.js';
import { readableRetainer, retainerPermissions, workableRetainer } from './retainer-access.js';
import { NO_TASKS, WorkProgress } from './work-progress.js';

type Executor = Database | Transaction;

export interface ProjectLink {
  id: string;
  name: string;
  clientId: string;
  projectManagerId: string;
  status: ProjectStatus;
  startDate: string;
  dueDate: string;
  archived: boolean;
}

export interface MilestoneLink {
  id: string;
  projectId: string;
  name: string;
  status: MilestoneStatus;
  archived: boolean;
}

export interface RetainerLink {
  id: string;
  name: string;
  clientId: string;
  status: RetainerStatus;
  archived: boolean;
}

export interface CycleLink {
  id: string;
  retainerId: string;
  retainerName: string;
  clientId: string;
  status: CycleStatus;
  month: string;
  periodStart: string;
  periodEnd: string;
  retainerArchived: boolean;
}

export interface CycleLineLink {
  id: string;
  cycleId: string;
  kind: DeliverableKind;
  label: string | null;
}

export interface ExtraWorkLink {
  id: string;
  title: string;
  billingStatus: ExtraWorkBilling;
  archived: boolean;
}

/** A cycle line with its committed quantity and its non-archived, non-cancelled tasks (F07). */
export interface CycleLineSummary extends CycleLineLink {
  committed: number;
  tasks: number;
}

/** A retainer the caller may read, with whether they may manage it (client scope, F05). */
export interface ReadableRetainer extends RetainerLink {
  canManage: boolean;
}

/** Extra work a task logs on its project or retainer (F06 rules 10 and 11). */
export interface ExtraWorkForTask {
  owner: { kind: 'project' | 'retainer'; id: string };
  title: string;
  description: string | null;
  requestedOn: string;
  requestedByContactId: string | null;
}

/** See `ClientDirectory`: a column of another module's table, qualified by hand. */
const qualified = (column: PgColumn) =>
  sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;

const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));

/**
 * Projects, milestones, retainer cycles and their lines as other modules may see them (F06):
 * summaries with their state, SQL filters over columns that hold their ids, and the extra work a
 * task creates or withdraws. Never the tables.
 */
@Injectable()
export class EngagementDirectory {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly progress: WorkProgress,
  ) {}

  /**
   * `lock` holds the project rows until the transaction ends, so a task linked to a project cannot
   * slip past a concurrent complete or cancel (F06 changes to F05).
   */
  async projects(
    ids: string[],
    executor: Executor = this.db,
    options: { lock?: boolean } = {},
  ): Promise<Map<string, ProjectLink>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const query = executor
      .select({
        id: projects.id,
        name: projects.name,
        clientId: projects.clientId,
        projectManagerId: projects.projectManagerId,
        status: projects.status,
        startDate: projects.startDate,
        dueDate: projects.dueDate,
        archivedAt: projects.archivedAt,
      })
      .from(projects)
      .where(inArray(projects.id, unique));
    const rows = options.lock ? await query.for('share') : await query;
    return byId(rows.map(({ archivedAt, ...row }) => ({ ...row, archived: !!archivedAt })));
  }

  async milestones(
    ids: string[],
    executor: Executor = this.db,
  ): Promise<Map<string, MilestoneLink>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await executor
      .select({
        id: projectMilestones.id,
        projectId: projectMilestones.projectId,
        name: projectMilestones.name,
        status: projectMilestones.status,
        archivedAt: projectMilestones.archivedAt,
      })
      .from(projectMilestones)
      .where(inArray(projectMilestones.id, unique));
    return byId(rows.map(({ archivedAt, ...row }) => ({ ...row, archived: !!archivedAt })));
  }

  async retainers(ids: string[], executor: Executor = this.db): Promise<Map<string, RetainerLink>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await executor
      .select({
        id: retainers.id,
        name: retainers.name,
        clientId: retainers.clientId,
        status: retainers.status,
        archivedAt: retainers.archivedAt,
      })
      .from(retainers)
      .where(inArray(retainers.id, unique));
    return byId(rows.map(({ archivedAt, ...row }) => ({ ...row, archived: !!archivedAt })));
  }

  async cycles(ids: string[], executor: Executor = this.db): Promise<Map<string, CycleLink>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await executor
      .select({
        id: retainerCycles.id,
        retainerId: retainerCycles.retainerId,
        retainerName: retainers.name,
        clientId: retainers.clientId,
        status: retainerCycles.status,
        month: retainerCycles.month,
        periodStart: retainerCycles.periodStart,
        periodEnd: retainerCycles.periodEnd,
        retainerArchivedAt: retainers.archivedAt,
      })
      .from(retainerCycles)
      .innerJoin(retainers, eq(retainers.id, retainerCycles.retainerId))
      .where(inArray(retainerCycles.id, unique));
    return byId(
      rows.map(({ retainerArchivedAt, ...row }) => ({
        ...row,
        retainerArchived: !!retainerArchivedAt,
      })),
    );
  }

  async cycleLines(
    ids: string[],
    executor: Executor = this.db,
  ): Promise<Map<string, CycleLineLink>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await executor
      .select({
        id: retainerCycleLines.id,
        cycleId: retainerCycleLines.cycleId,
        kind: retainerCycleLines.kind,
        label: retainerCycleLines.label,
      })
      .from(retainerCycleLines)
      .where(inArray(retainerCycleLines.id, unique));
    return byId(rows);
  }

  /**
   * The lines of the cycles by position, with their task counts. Counts are read outside the
   * transaction: lines created in it count 0.
   */
  async cycleLineSummaries(
    cycleIds: string[],
    executor: Executor = this.db,
  ): Promise<CycleLineSummary[]> {
    if (cycleIds.length === 0) return [];
    const rows = await executor
      .select({
        id: retainerCycleLines.id,
        cycleId: retainerCycleLines.cycleId,
        kind: retainerCycleLines.kind,
        label: retainerCycleLines.label,
        committed: retainerCycleLines.committedQuantity,
      })
      .from(retainerCycleLines)
      .where(inArray(retainerCycleLines.cycleId, cycleIds))
      .orderBy(asc(retainerCycleLines.position), asc(retainerCycleLines.id));
    const counts = await this.progress.cycleLines(rows.map((row) => row.id));
    return rows.map((row) => ({ ...row, tasks: (counts.get(row.id) ?? NO_TASKS).total }));
  }

  /** The retainer's newest open cycle, or null. */
  async openCycle(
    retainerId: string,
    executor: Executor = this.db,
  ): Promise<{ id: string; month: string; periodStart: string; periodEnd: string } | null> {
    const [row] = await executor
      .select({
        id: retainerCycles.id,
        month: retainerCycles.month,
        periodStart: retainerCycles.periodStart,
        periodEnd: retainerCycles.periodEnd,
      })
      .from(retainerCycles)
      .where(and(eq(retainerCycles.retainerId, retainerId), eq(retainerCycles.status, 'open')))
      .orderBy(desc(retainerCycles.month))
      .limit(1);
    return row ?? null;
  }

  /** Locks a cycle row until the transaction ends, so line changes wait (F07 rule 18). */
  async lockCycle(tx: Transaction, cycleId: string): Promise<void> {
    await tx
      .select({ id: retainerCycles.id })
      .from(retainerCycles)
      .where(eq(retainerCycles.id, cycleId))
      .for('update');
  }

  /** Non-archived milestones of the project, by position. */
  async projectMilestones(
    projectId: string,
    executor: Executor = this.db,
  ): Promise<{ id: string; name: string; status: MilestoneStatus; position: number }[]> {
    return executor
      .select({
        id: projectMilestones.id,
        name: projectMilestones.name,
        status: projectMilestones.status,
        position: projectMilestones.position,
      })
      .from(projectMilestones)
      .where(and(eq(projectMilestones.projectId, projectId), isNull(projectMilestones.archivedAt)))
      .orderBy(asc(projectMilestones.position), asc(projectMilestones.id));
  }

  /**
   * Appends milestones to the project in order, each audited as F05's `project_milestone.created`;
   * `LIMIT_REACHED` past 30, naming them (F07 rule 13, edge case 5). Returns their ids in order.
   */
  async createMilestones(
    tx: Transaction,
    projectId: string,
    milestones: { name: string; dueDate: string }[],
    actor: AuditActor | null,
  ): Promise<string[]> {
    if (milestones.length === 0) return [];
    const [existing] = await tx
      .select({ value: count() })
      .from(projectMilestones)
      .where(and(eq(projectMilestones.projectId, projectId), isNull(projectMilestones.archivedAt)));
    const first = (existing?.value ?? 0) + 1;
    if (first - 1 + milestones.length > PROJECT_LIMITS.milestones) {
      throw new CodedException(409, 'LIMIT_REACHED', 'A project holds at most 30 milestones', {
        stages: milestones.map((milestone) => milestone.name),
      });
    }
    const ids: string[] = [];
    for (const [index, milestone] of milestones.entries()) {
      const values = { name: milestone.name, dueDate: milestone.dueDate, installmentMinor: null };
      const position = first + index;
      const [created] = await tx
        .insert(projectMilestones)
        .values({ projectId, position, ...values })
        .returning({ id: projectMilestones.id });
      if (!created) throw new Error('Milestone insert returned no row');
      await recordAudit(tx, {
        actor,
        action: 'project_milestone.created',
        entityType: 'project_milestone',
        entityId: created.id,
        after: { ...values, position, projectId },
      });
      ids.push(created.id);
    }
    return ids;
  }

  /**
   * Locks a project the actor may manage (client scope or project manager) that takes new work
   * (F07 rule 15): 404 when unreadable, 403 without access, then `PROJECT_ARCHIVED`,
   * `CLIENT_ARCHIVED`, `PROJECT_CLOSED` and `CLIENT_ENDED`.
   */
  async workableProject(tx: Transaction, actor: CurrentUserInfo, id: string): Promise<ProjectLink> {
    const project = await workableProject(tx, this.clients, actor, id);
    assertClientTakesWork(project.client);
    return (await this.projects([id], tx)).get(id) as ProjectLink;
  }

  /**
   * A project the actor may read, else 404 (archived ones, or of an archived client, for
   * scope-all holders only).
   */
  async readableProject(actor: CurrentUserInfo, id: string): Promise<void> {
    await readableProject(this.db, this.clients, actor, id);
  }

  /**
   * A retainer the actor may read, else 404 (archived ones, or of an archived client, for
   * scope-all holders only), with whether they may manage it.
   */
  async readableRetainer(
    actor: CurrentUserInfo,
    id: string,
    executor: Executor = this.db,
  ): Promise<ReadableRetainer> {
    const retainer = await readableRetainer(executor, this.clients, actor, id);
    return {
      id: retainer.id,
      name: retainer.name,
      clientId: retainer.clientId,
      status: retainer.status,
      archived: !!retainer.archivedAt,
      canManage: retainerPermissions(actor, retainer).canManage,
    };
  }

  /**
   * Locks a retainer the actor manages (client scope) that is writable: 404, 403, then
   * `RETAINER_ARCHIVED`, `CLIENT_ARCHIVED` and `RETAINER_ENDED`.
   */
  async workableRetainer(
    tx: Transaction,
    actor: CurrentUserInfo,
    id: string,
  ): Promise<RetainerLink> {
    const retainer = await workableRetainer(tx, this.clients, actor, id);
    return {
      id: retainer.id,
      name: retainer.name,
      clientId: retainer.clientId,
      status: retainer.status,
      archived: false,
    };
  }

  async extraWork(
    ids: string[],
    executor: Executor = this.db,
  ): Promise<Map<string, ExtraWorkLink>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await executor
      .select({
        id: extraWorkItems.id,
        title: extraWorkItems.title,
        billingStatus: extraWorkItems.billingStatus,
        archivedAt: extraWorkItems.archivedAt,
      })
      .from(extraWorkItems)
      .where(inArray(extraWorkItems.id, unique));
    return byId(rows.map(({ archivedAt, ...row }) => ({ ...row, archived: !!archivedAt })));
  }

  /**
   * `projectColumn` and `cycleColumn` hold nothing, or a non-archived project and a cycle of a
   * non-archived retainer (F06 rule 17).
   */
  isLive(projectColumn: PgColumn, cycleColumn: PgColumn): SQL {
    return sql`(${qualified(projectColumn)} is null or ${qualified(projectColumn)} in (
        select ${projects.id} from ${projects} where ${projects.archivedAt} is null))
      and (${qualified(cycleColumn)} is null or ${qualified(cycleColumn)} in (
        select ${retainerCycles.id} from ${retainerCycles}
        inner join ${retainers} on ${retainers.id} = ${retainerCycles.retainerId}
        where ${retainers.archivedAt} is null))`;
  }

  /** `projectColumn` holds a project whose project manager is `userId`. */
  projectManagedBy(projectColumn: PgColumn, userId: string): SQL {
    return sql`${qualified(projectColumn)} in (select ${projects.id} from ${projects}
      where ${projects.projectManagerId} = ${userId})`;
  }

  /** `cycleColumn` holds a cycle of the retainer. */
  cycleOf(cycleColumn: PgColumn, retainerId: string): SQL {
    return sql`${qualified(cycleColumn)} in (select ${retainerCycles.id} from ${retainerCycles}
      where ${retainerCycles.retainerId} = ${retainerId})`;
  }

  /** Logs extra work for a task, audited as F05's `extra_work.created`. */
  async createExtraWork(
    tx: Transaction,
    input: ExtraWorkForTask,
    actor: AuditActor,
  ): Promise<ExtraWorkLink> {
    await this.assertTakesExtraWork(tx, input.owner);
    const values = {
      title: input.title.slice(0, 160),
      description: input.description?.slice(0, 2000) ?? null,
      requestedOn: input.requestedOn,
      requestedByContactId: input.requestedByContactId,
    };
    const [created] = await tx
      .insert(extraWorkItems)
      .values({
        ...values,
        projectId: input.owner.kind === 'project' ? input.owner.id : null,
        retainerId: input.owner.kind === 'retainer' ? input.owner.id : null,
        loggedById: actor.id,
      })
      .returning({ id: extraWorkItems.id, billingStatus: extraWorkItems.billingStatus });
    if (!created) throw new Error('Extra work insert returned no row');
    await recordAudit(tx, {
      actor,
      action: 'extra_work.created',
      entityType: 'extra_work',
      entityId: created.id,
      after: { ...values, ...ownerField(input.owner) },
    });
    return { ...created, title: values.title, archived: false };
  }

  /**
   * M3: extra work is logged on an open, non-archived project or a running, non-archived retainer.
   * Share-locks the owner row, so a concurrent status change waits (it locks for update).
   */
  private async assertTakesExtraWork(
    tx: Transaction,
    owner: ExtraWorkForTask['owner'],
  ): Promise<void> {
    if (owner.kind === 'project') {
      const [project] = await tx
        .select({ status: projects.status, archivedAt: projects.archivedAt })
        .from(projects)
        .where(eq(projects.id, owner.id))
        .for('share');
      if (project?.archivedAt) {
        throw new CodedException(409, 'PROJECT_ARCHIVED', 'The project is archived');
      }
      if (!project || isProjectClosed(project.status)) {
        throw new CodedException(409, 'PROJECT_CLOSED', 'The project is completed or cancelled');
      }
      return;
    }
    const [retainer] = await tx
      .select({ status: retainers.status, archivedAt: retainers.archivedAt })
      .from(retainers)
      .where(eq(retainers.id, owner.id))
      .for('share');
    if (retainer?.archivedAt) {
      throw new CodedException(409, 'RETAINER_ARCHIVED', 'The retainer is archived');
    }
    if (!retainer || retainer.status === 'ended') {
      throw new CodedException(409, 'RETAINER_ENDED', 'The retainer has ended');
    }
  }

  /**
   * Withdraws the extra work of a task while it is unbilled (F06 rule 11, edge case 10);
   * `EXTRA_WORK_BILLED` once billed or waived.
   */
  async archiveExtraWork(tx: Transaction, id: string, actor: AuditActor): Promise<void> {
    const [item] = await tx
      .select({
        billingStatus: extraWorkItems.billingStatus,
        projectId: extraWorkItems.projectId,
        retainerId: extraWorkItems.retainerId,
        archivedAt: extraWorkItems.archivedAt,
      })
      .from(extraWorkItems)
      .where(eq(extraWorkItems.id, id))
      .for('update');
    if (!item || item.archivedAt) return;
    if (item.billingStatus !== 'unbilled') {
      throw new CodedException(
        409,
        'EXTRA_WORK_BILLED',
        'The extra work is billed or waived and stays',
      );
    }
    await tx
      .update(extraWorkItems)
      .set({ archivedAt: new Date() })
      .where(eq(extraWorkItems.id, id));
    await recordAudit(tx, {
      actor,
      action: 'extra_work.archived',
      entityType: 'extra_work',
      entityId: id,
      before: { archived: false },
      after: {
        archived: true,
        ...(item.projectId ? { projectId: item.projectId } : { retainerId: item.retainerId }),
      },
    });
  }
}

/** Extra work entries carry their project or retainer, so the audit log links them. */
const ownerField = (owner: ExtraWorkForTask['owner']) =>
  owner.kind === 'project' ? { projectId: owner.id } : { retainerId: owner.id };
