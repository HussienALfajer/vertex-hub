import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AuditAction,
  businessDate,
  type CompleteMilestone,
  type CreateMilestone,
  type Milestone,
  type MilestoneListResponse,
  type MilestoneOrder,
  type MilestoneStatus,
  PROJECT_LIMITS,
  type UpdateMilestone,
} from '@vertex-hub/contracts';
import { type Database, projectMilestones, type Transaction } from '@vertex-hub/db';
import { and, asc, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import {
  actorOf,
  assertCanEditMoney,
  type ProjectAccess,
  readableProject,
  seesMoney,
  workableProject,
} from './project-access.js';
import { NO_TASKS, WorkProgress } from './work-progress.js';

type Executor = Database | Transaction;

const milestoneColumns = {
  id: projectMilestones.id,
  projectId: projectMilestones.projectId,
  name: projectMilestones.name,
  position: projectMilestones.position,
  dueDate: projectMilestones.dueDate,
  status: projectMilestones.status,
  doneAt: projectMilestones.doneAt,
  doneById: projectMilestones.doneById,
  installmentMinor: projectMilestones.installmentMinor,
};

export interface MilestoneRow {
  id: string;
  projectId: string;
  name: string;
  position: number;
  dueDate: string | null;
  status: MilestoneStatus;
  doneAt: Date | null;
  doneById: string | null;
  installmentMinor: number | null;
}

/** Milestones of a project (F05 rules 8 and 10): ordered, completed by hand, paid by installment. */
@Injectable()
export class ProjectMilestonesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly progress: WorkProgress,
  ) {}

  /** Non-archived milestones of the projects, by position. */
  rows(projectIds: string[], executor: Executor = this.db): Promise<MilestoneRow[]> {
    if (projectIds.length === 0) return Promise.resolve([]);
    return executor
      .select(milestoneColumns)
      .from(projectMilestones)
      .where(
        and(inArray(projectMilestones.projectId, projectIds), isNull(projectMilestones.archivedAt)),
      )
      .orderBy(asc(projectMilestones.position), asc(projectMilestones.id));
  }

  /** Milestones as the API returns them; money only when `withMoney`. */
  async present(rows: MilestoneRow[], withMoney: boolean): Promise<Milestone[]> {
    const [people, counts] = await Promise.all([
      this.users.summaries(rows.flatMap((row) => (row.doneById ? [row.doneById] : []))),
      this.progress.milestones(rows.map((row) => row.id)),
    ]);
    const today = businessDate();
    return rows.map((row) => {
      const doneBy = row.doneById ? people.get(row.doneById) : undefined;
      return {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        position: row.position,
        dueDate: row.dueDate,
        status: row.status,
        overdue: row.status === 'pending' && row.dueDate !== null && row.dueDate < today,
        doneAt: row.doneAt?.toISOString() ?? null,
        doneBy: row.doneById ? { id: row.doneById, name: doneBy?.name ?? '' } : null,
        tasks: counts.get(row.id) ?? NO_TASKS,
        ...(withMoney && { money: { installmentMinor: row.installmentMinor } }),
      };
    });
  }

  async create(
    actor: CurrentUserInfo,
    projectId: string,
    input: CreateMilestone,
  ): Promise<Milestone> {
    const id = await this.db.transaction(async (tx) => {
      const project = await workableProject(tx, this.clients, actor, projectId);
      if (input.installmentMinor !== undefined) assertCanEditMoney(actor, project.client);
      const [existing] = await tx
        .select({ value: count() })
        .from(projectMilestones)
        .where(
          and(eq(projectMilestones.projectId, projectId), isNull(projectMilestones.archivedAt)),
        );
      const position = (existing?.value ?? 0) + 1;
      if (position > PROJECT_LIMITS.milestones) {
        throw new CodedException(409, 'LIMIT_REACHED', 'A project holds at most 30 milestones');
      }
      const values = {
        name: input.name,
        dueDate: input.dueDate ?? null,
        installmentMinor: input.installmentMinor ?? null,
      };
      const [created] = await tx
        .insert(projectMilestones)
        .values({ projectId, position, ...values })
        .returning({ id: projectMilestones.id });
      if (!created) throw new Error('Milestone insert returned no row');
      await this.audit(tx, actor, 'project_milestone.created', created.id, project, {
        after: { ...values, position },
      });
      return created.id;
    });
    return this.one(actor, projectId, id);
  }

  async update(
    actor: CurrentUserInfo,
    projectId: string,
    milestoneId: string,
    input: UpdateMilestone,
  ): Promise<Milestone> {
    await this.db.transaction(async (tx) => {
      const project = await workableProject(tx, this.clients, actor, projectId);
      if (input.installmentMinor !== undefined) assertCanEditMoney(actor, project.client);
      const current = await this.milestone(tx, projectId, milestoneId, { forUpdate: true });
      const change = changedFields(
        {
          name: current.name,
          dueDate: current.dueDate,
          installmentMinor: current.installmentMinor,
        },
        input,
      );
      if (!change) return;
      await tx
        .update(projectMilestones)
        .set(change.after)
        .where(eq(projectMilestones.id, milestoneId));
      await this.audit(tx, actor, 'project_milestone.updated', milestoneId, project, change);
    });
    return this.one(actor, projectId, milestoneId);
  }

  /** Rewrites positions from the given order; every non-archived milestone once. */
  async reorder(
    actor: CurrentUserInfo,
    projectId: string,
    order: MilestoneOrder,
  ): Promise<MilestoneListResponse> {
    await this.db.transaction(async (tx) => {
      const project = await workableProject(tx, this.clients, actor, projectId);
      const current = await this.rows([projectId], tx);
      const known = new Set(current.map((row) => row.id));
      const complete =
        order.ids.length === current.length &&
        new Set(order.ids).size === order.ids.length &&
        order.ids.every((id) => known.has(id));
      if (!complete) {
        throw new CodedException(
          409,
          'INVALID_ORDER',
          'The order must list every milestone of the project once',
        );
      }
      const positions = new Map(current.map((row) => [row.id, row.position]));
      for (const [index, id] of order.ids.entries()) {
        const position = index + 1;
        const before = positions.get(id);
        if (before === position) continue;
        await tx.update(projectMilestones).set({ position }).where(eq(projectMilestones.id, id));
        await this.audit(tx, actor, 'project_milestone.reordered', id, project, {
          before: { position: before },
          after: { position },
        });
      }
    });
    const project = await readableProject(this.db, this.clients, actor, projectId);
    return {
      items: await this.present(await this.rows([projectId]), seesMoney(actor, project.client)),
    };
  }

  /** Rule 8: open tasks need the caller's confirmation. */
  async complete(
    actor: CurrentUserInfo,
    projectId: string,
    milestoneId: string,
    input: CompleteMilestone,
  ): Promise<Milestone> {
    await this.db.transaction(async (tx) => {
      const project = await workableProject(tx, this.clients, actor, projectId);
      const current = await this.milestone(tx, projectId, milestoneId, { forUpdate: true });
      if (current.status === 'done') {
        throw new CodedException(409, 'MILESTONE_DONE', 'The milestone is already done');
      }
      const openTasks =
        (await this.progress.milestones([milestoneId], tx)).get(milestoneId)?.open ?? 0;
      if (openTasks > 0 && !input.confirmOpenTasks) {
        throw new CodedException(
          409,
          'MILESTONE_HAS_OPEN_TASKS',
          'The milestone has open tasks; confirm to complete it anyway',
          { openTasks },
        );
      }
      await tx
        .update(projectMilestones)
        .set({ status: 'done', doneAt: new Date(), doneById: actor.id })
        .where(eq(projectMilestones.id, milestoneId));
      await this.audit(tx, actor, 'project_milestone.completed', milestoneId, project, {
        before: { status: 'pending' },
        after: { status: 'done', ...(openTasks > 0 && { openTasks }) },
      });
    });
    return this.one(actor, projectId, milestoneId);
  }

  async reopen(actor: CurrentUserInfo, projectId: string, milestoneId: string): Promise<Milestone> {
    await this.db.transaction(async (tx) => {
      const project = await workableProject(tx, this.clients, actor, projectId);
      const current = await this.milestone(tx, projectId, milestoneId, { forUpdate: true });
      if (current.status !== 'done') {
        throw new CodedException(409, 'MILESTONE_NOT_DONE', 'The milestone is not done');
      }
      await tx
        .update(projectMilestones)
        .set({ status: 'pending', doneAt: null, doneById: null })
        .where(eq(projectMilestones.id, milestoneId));
      await this.audit(tx, actor, 'project_milestone.reopened', milestoneId, project, {
        before: { status: 'done' },
        after: { status: 'pending' },
      });
    });
    return this.one(actor, projectId, milestoneId);
  }

  /** Removes a pending milestone and closes the gap in the order (rule 8). */
  async archive(actor: CurrentUserInfo, projectId: string, milestoneId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const project = await workableProject(tx, this.clients, actor, projectId);
      const current = await this.milestone(tx, projectId, milestoneId, { forUpdate: true });
      if (current.status === 'done') {
        throw new CodedException(409, 'MILESTONE_DONE', 'Only a pending milestone can be removed');
      }
      await tx
        .update(projectMilestones)
        .set({ archivedAt: new Date() })
        .where(eq(projectMilestones.id, milestoneId));
      await tx
        .update(projectMilestones)
        .set({ position: sql`${projectMilestones.position} - 1` })
        .where(
          and(
            eq(projectMilestones.projectId, projectId),
            isNull(projectMilestones.archivedAt),
            gt(projectMilestones.position, current.position),
          ),
        );
      await this.audit(tx, actor, 'project_milestone.archived', milestoneId, project, {
        before: { archived: false },
        after: { archived: true },
      });
    });
  }

  private async one(actor: CurrentUserInfo, projectId: string, id: string): Promise<Milestone> {
    const project = await readableProject(this.db, this.clients, actor, projectId);
    const row = await this.milestone(this.db, projectId, id);
    const [milestone] = await this.present([row], seesMoney(actor, project.client));
    if (!milestone) throw new NotFoundException();
    return milestone;
  }

  /** A non-archived milestone of the project, else 404. */
  private async milestone(
    executor: Executor,
    projectId: string,
    id: string,
    options: { forUpdate?: boolean } = {},
  ) {
    const query = executor
      .select(milestoneColumns)
      .from(projectMilestones)
      .where(
        and(
          eq(projectMilestones.id, id),
          eq(projectMilestones.projectId, projectId),
          isNull(projectMilestones.archivedAt),
        ),
      );
    const [row] = options.forUpdate ? await query.for('update') : await query;
    if (!row) throw new NotFoundException();
    return row;
  }

  /** Milestone entries carry the project, so the audit log links them to its page. */
  private audit(
    tx: Transaction,
    actor: CurrentUserInfo,
    action: AuditAction,
    milestoneId: string,
    project: ProjectAccess,
    change: { before?: Record<string, unknown>; after: Record<string, unknown> },
  ) {
    return recordAudit(tx, {
      actor: actorOf(actor),
      action,
      entityType: 'project_milestone',
      entityId: milestoneId,
      before: change.before ?? null,
      after: { ...change.after, projectId: project.id },
    });
  }
}
