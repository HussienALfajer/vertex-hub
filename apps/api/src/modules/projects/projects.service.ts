import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type AuditAction,
  businessDate,
  type CreateProject,
  canChangeProjectStatus,
  isProjectClosed,
  OPEN_PROJECT_STATUSES,
  PROJECT_LIMITS,
  type Project,
  type ProjectDetail,
  type ProjectListQuery,
  type ProjectPage,
  type ProjectStatus,
  type ProjectStatusChange,
  permissionScopes,
  type UpdateProject,
} from '@vertex-hub/contracts';
import { type Database, projectMilestones, projects, type Transaction } from '@vertex-hub/db';
import {
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import {
  type CurrentUserInfo,
  lockAccessChanges,
  ResponsibilityRegistry,
  UserDirectory,
  type UserSummary,
} from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import {
  actorOf,
  assertCanEditMoney,
  assertNotArchived,
  canWork,
  coversClient,
  holdsAll,
  projectPermissions,
  readableProject,
  seesMoney,
  workableProject,
} from './project-access.js';
import { type MilestoneRow, ProjectMilestonesService } from './project-milestones.service.js';
import { NO_TASKS, progressOf, WorkProgress } from './work-progress.js';

type Executor = Database | Transaction;

type Change = { before: Record<string, unknown>; after: Record<string, unknown> };

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

const summaryColumns = {
  id: projects.id,
  name: projects.name,
  clientId: projects.clientId,
  projectManagerId: projects.projectManagerId,
  departments: projects.departments,
  status: projects.status,
  startDate: projects.startDate,
  dueDate: projects.dueDate,
};

type SummaryRow = {
  id: string;
  name: string;
  clientId: string;
  projectManagerId: string;
  departments: Project['departments'];
  status: ProjectStatus;
  startDate: string;
  dueDate: string;
};

const isOpen = (status: ProjectStatus) =>
  (OPEN_PROJECT_STATUSES as readonly ProjectStatus[]).includes(status);

/** Projects of clients (F05): basics, project manager, status, archive and restore. */
@Injectable()
export class ProjectsService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly responsibilities: ResponsibilityRegistry,
    private readonly milestones: ProjectMilestonesService,
    private readonly progress: WorkProgress,
  ) {}

  /** Rule 4: a user cannot be archived while they manage an open project. */
  onModuleInit(): void {
    this.responsibilities.register({
      find: async (tx, userId) => {
        const managed = await tx
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(
            and(
              eq(projects.projectManagerId, userId),
              inArray(projects.status, [...OPEN_PROJECT_STATUSES]),
              isNull(projects.archivedAt),
            ),
          )
          .orderBy(asc(projects.name));
        return managed.map((project) => ({
          type: 'project_manager_of_project' as const,
          ...project,
        }));
      },
    });
  }

  async list(actor: CurrentUserInfo, query: ProjectListQuery): Promise<ProjectPage> {
    if (query.archived && !holdsAll(actor, 'projects.manage')) throw new ForbiddenException();
    const today = businessDate();
    const open = [...OPEN_PROJECT_STATUSES];

    const filters: (SQL | undefined)[] = [
      query.archived
        ? isNotNull(projects.archivedAt)
        : and(isNull(projects.archivedAt), this.clients.isLive(projects.clientId)),
      permissionScopes(actor.access, 'projects.read').includes('all') ? undefined : sql`false`,
      inArray(projects.status, query.status),
    ];
    if (query.search) {
      filters.push(
        or(
          ilike(projects.name, `%${escapeLike(query.search)}%`),
          this.clients.nameContains(projects.clientId, query.search),
        ),
      );
    }
    if (query.clientId) filters.push(eq(projects.clientId, query.clientId));
    if (query.projectManagerId) filters.push(eq(projects.projectManagerId, query.projectManagerId));
    if (query.department) filters.push(arrayContains(projects.departments, [query.department]));
    if (query.overdue === true) {
      filters.push(and(inArray(projects.status, open), lt(projects.dueDate, today)));
    }
    if (query.overdue === false) {
      filters.push(or(notInArray(projects.status, open), gte(projects.dueDate, today)));
    }
    const where = and(...filters);

    const sortColumn =
      query.sort === 'name'
        ? sql`lower(${projects.name})`
        : query.sort === 'createdAt'
          ? projects.createdAt
          : projects.dueDate;
    const order = query.order === 'desc' ? desc : asc;
    const [rows, [total]] = await Promise.all([
      this.db
        .select(summaryColumns)
        .from(projects)
        .where(where)
        .orderBy(order(sortColumn), asc(projects.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(projects).where(where),
    ]);
    const ids = rows.map((row) => row.id);
    const [people, clients, milestones, counts] = await Promise.all([
      this.users.summaries(rows.map((row) => row.projectManagerId)),
      this.clients.summaries(rows.map((row) => row.clientId)),
      this.milestones.rows(ids),
      this.progress.projects(ids),
    ]);
    return {
      items: rows.map((row) =>
        toProject(row, {
          people,
          clients,
          milestones: milestones.filter((milestone) => milestone.projectId === row.id),
          progress: progressOf(counts.get(row.id) ?? NO_TASKS),
          today,
        }),
      ),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(actor: CurrentUserInfo, id: string): Promise<ProjectDetail> {
    const access = await readableProject(this.db, this.clients, actor, id);
    const [[row], milestoneRows, counts] = await Promise.all([
      this.db
        .select({
          ...summaryColumns,
          description: projects.description,
          currency: projects.currency,
          completedAt: projects.completedAt,
          cancelledAt: projects.cancelledAt,
          cancelReason: projects.cancelReason,
          archivedAt: projects.archivedAt,
        })
        .from(projects)
        .where(eq(projects.id, id)),
      this.milestones.rows([id]),
      this.progress.projects([id]),
    ]);
    if (!row) throw new NotFoundException();
    const withMoney = seesMoney(actor, access.client);
    const [people, milestones] = await Promise.all([
      this.users.summaries([row.projectManagerId]),
      this.milestones.present(milestoneRows, withMoney),
    ]);
    const tasks = counts.get(id) ?? NO_TASKS;
    return {
      ...toProject(row, {
        people,
        clients: new Map([[access.client.id, access.client]]),
        milestones: milestoneRows,
        progress: progressOf(tasks),
        today: businessDate(),
      }),
      description: row.description,
      milestones,
      tasks,
      completedAt: row.completedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancelReason: row.cancelReason,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      ...(withMoney && {
        money: {
          currency: row.currency,
          totalMinor: milestoneRows.reduce((sum, m) => sum + (m.installmentMinor ?? 0), 0),
        },
      }),
      permissions: projectPermissions(actor, access),
    };
  }

  async create(actor: CurrentUserInfo, input: CreateProject): Promise<ProjectDetail> {
    const id = await this.db.transaction(async (tx) => {
      // Serialized with archiving users (rule 4).
      await lockAccessChanges(tx);
      const client = await this.clients.summary(input.clientId, tx, { forUpdate: true });
      if (!client) throw new NotFoundException();
      if (!coversClient(actor, client)) throw new ForbiddenException();
      assertClientTakesWork(client);
      const setsMoney =
        input.currency !== undefined ||
        input.milestones.some((milestone) => milestone.installmentMinor !== undefined);
      if (setsMoney) assertCanEditMoney(actor, client);
      if (input.milestones.length > PROJECT_LIMITS.milestones) {
        throw new CodedException(409, 'LIMIT_REACHED', 'A project holds at most 30 milestones');
      }
      assertDates(input.startDate, input.dueDate);
      const manager = await this.validProjectManager(tx, input.projectManagerId);
      await this.assertNameFree(tx, client.id, input.name);

      const values = {
        name: input.name,
        description: input.description ?? null,
        departments: input.departments,
        status: input.status,
        startDate: input.startDate,
        dueDate: input.dueDate,
        currency: input.currency ?? 'USD',
      };
      const [created] = await tx
        .insert(projects)
        .values({ ...values, clientId: client.id, projectManagerId: manager.id })
        .returning({ id: projects.id });
      if (!created) throw new Error('Project insert returned no row');
      const milestones = input.milestones.map((milestone, index) => ({
        name: milestone.name,
        dueDate: milestone.dueDate ?? null,
        installmentMinor: milestone.installmentMinor ?? null,
        position: index + 1,
      }));
      if (milestones.length > 0) {
        await tx
          .insert(projectMilestones)
          .values(milestones.map((milestone) => ({ ...milestone, projectId: created.id })));
      }
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'project.created',
        entityType: 'project',
        entityId: created.id,
        after: {
          ...values,
          client: { id: client.id, name: client.name },
          projectManager: { id: manager.id, name: manager.name },
          milestones,
        },
      });
      return created.id;
    });
    return this.detail(actor, id);
  }

  async update(actor: CurrentUserInfo, id: string, input: UpdateProject): Promise<ProjectDetail> {
    await this.db.transaction(async (tx) => {
      if (input.projectManagerId !== undefined) await lockAccessChanges(tx);
      const project = await workableProject(tx, this.clients, actor, id);
      const [current] = await tx
        .select({
          name: projects.name,
          description: projects.description,
          departments: projects.departments,
          startDate: projects.startDate,
          dueDate: projects.dueDate,
          currency: projects.currency,
          projectManagerId: projects.projectManagerId,
        })
        .from(projects)
        .where(eq(projects.id, id));
      if (!current) throw new NotFoundException();

      const managerChanges =
        input.projectManagerId !== undefined && input.projectManagerId !== current.projectManagerId;
      // Rule 2: only client scope hands a project to someone else.
      if (managerChanges && !coversClient(actor, project.client)) throw new ForbiddenException();
      if (input.currency !== undefined) assertCanEditMoney(actor, project.client);
      assertDates(input.startDate ?? current.startDate, input.dueDate ?? current.dueDate);
      if (input.name !== undefined && input.name.toLowerCase() !== current.name.toLowerCase()) {
        await this.assertNameFree(tx, project.clientId, input.name, id);
      }

      const basics = changedFields(
        {
          name: current.name,
          description: current.description,
          departments: current.departments,
          startDate: current.startDate,
          dueDate: current.dueDate,
        },
        {
          name: input.name,
          description: input.description,
          departments: input.departments,
          startDate: input.startDate,
          dueDate: input.dueDate,
        },
      );
      const money = changedFields({ currency: current.currency }, { currency: input.currency });
      if (money) await this.assertCurrencyFree(tx, id);
      let manager: UserSummary | undefined;
      let managerChange: Change | null = null;
      if (managerChanges && input.projectManagerId) {
        manager = await this.validProjectManager(tx, input.projectManagerId);
        const previous = (await this.users.summaries([current.projectManagerId], tx)).get(
          current.projectManagerId,
        );
        managerChange = {
          before: { projectManager: { id: current.projectManagerId, name: previous?.name ?? '' } },
          after: { projectManager: { id: manager.id, name: manager.name } },
        };
      }
      if (!basics && !money && !managerChange) return;

      await tx
        .update(projects)
        .set({
          ...basics?.after,
          ...money?.after,
          ...(manager && { projectManagerId: manager.id }),
        })
        .where(eq(projects.id, id));
      const audit = async (action: AuditAction, change: Change | null) => {
        if (!change) return;
        await recordAudit(tx, {
          actor: actorOf(actor),
          action,
          entityType: 'project',
          entityId: id,
          ...change,
        });
      };
      await audit('project.updated', basics);
      await audit('project.project_manager_changed', managerChange);
      await audit('project.money_updated', money);
    });
    return this.detail(actor, id);
  }

  /** Rule 6 and the status diagram: who may make each change is checked after it is allowed. */
  async changeStatus(
    actor: CurrentUserInfo,
    id: string,
    change: ProjectStatusChange,
  ): Promise<ProjectDetail> {
    await this.db.transaction(async (tx) => {
      // Reopening checks the project manager (edge case 8): take the access lock before the row
      // lock, in the same order as every other writer, so the two never deadlock.
      if (change.status === 'active') await lockAccessChanges(tx);
      const project = await readableProject(tx, this.clients, actor, id, { forUpdate: true });
      if (!canWork(actor, project)) throw new ForbiddenException();
      assertNotArchived(project);
      const to = change.status;
      if (!canChangeProjectStatus(project.status, to)) {
        throw new CodedException(
          409,
          'INVALID_TRANSITION',
          `A ${project.status} project cannot become ${to}`,
        );
      }
      const reopening = isProjectClosed(project.status);
      if (reopening && !holdsAll(actor, 'projects.manage')) throw new ForbiddenException();
      if (to === 'cancelled' && !coversClient(actor, project.client)) {
        throw new ForbiddenException();
      }
      if (!reopening && change.projectManagerId !== undefined) {
        throw new BadRequestException('A new project manager is accepted only when reopening');
      }
      const manager = reopening
        ? await this.validProjectManager(tx, change.projectManagerId ?? project.projectManagerId)
        : undefined;
      const managerChanges = !!manager && manager.id !== project.projectManagerId;
      if (to === 'completed') {
        const open = (await this.milestones.rows([id], tx)).filter(
          (milestone) => milestone.status !== 'done',
        );
        if (open.length > 0) {
          throw new CodedException(
            409,
            'MILESTONES_OPEN',
            'Every milestone must be done before the project completes',
            open.map((milestone) => ({ id: milestone.id, name: milestone.name })),
          );
        }
      }

      const now = new Date();
      await tx
        .update(projects)
        .set({
          status: to,
          ...(to === 'completed' && { completedAt: now }),
          ...(to === 'cancelled' && { cancelledAt: now, cancelReason: change.reason ?? null }),
          ...(reopening && { completedAt: null, cancelledAt: null, cancelReason: null }),
          ...(managerChanges && manager && { projectManagerId: manager.id }),
        })
        .where(eq(projects.id, id));
      if (managerChanges && manager) {
        const previous = (await this.users.summaries([project.projectManagerId], tx)).get(
          project.projectManagerId,
        );
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'project.project_manager_changed',
          entityType: 'project',
          entityId: id,
          before: { projectManager: { id: project.projectManagerId, name: previous?.name ?? '' } },
          after: { projectManager: { id: manager.id, name: manager.name } },
        });
      }
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'project.status_changed',
        entityType: 'project',
        entityId: id,
        before: { status: project.status },
        after: { status: to, ...(to === 'cancelled' && { reason: change.reason }) },
      });
    });
    return this.detail(actor, id);
  }

  async archive(actor: CurrentUserInfo, id: string): Promise<ProjectDetail> {
    if (!holdsAll(actor, 'projects.manage')) throw new ForbiddenException();
    await this.db.transaction(async (tx) => {
      const project = await readableProject(tx, this.clients, actor, id, { forUpdate: true });
      if (project.archivedAt) {
        throw new CodedException(409, 'PROJECT_ARCHIVED', 'The project is already archived');
      }
      await tx.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'project.archived',
        entityType: 'project',
        entityId: id,
        before: { archived: false },
        after: { archived: true },
      });
    });
    return this.detail(actor, id);
  }

  async restore(actor: CurrentUserInfo, id: string): Promise<ProjectDetail> {
    if (!holdsAll(actor, 'projects.manage')) throw new ForbiddenException();
    await this.db.transaction(async (tx) => {
      const project = await readableProject(tx, this.clients, actor, id, { forUpdate: true });
      if (!project.archivedAt) {
        throw new CodedException(409, 'PROJECT_NOT_ARCHIVED', 'The project is not archived');
      }
      if (project.client.archived) {
        throw new CodedException(409, 'CLIENT_ARCHIVED', 'Restore the client first');
      }
      await this.assertNameFree(tx, project.clientId, project.name, id);
      await tx.update(projects).set({ archivedAt: null }).where(eq(projects.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'project.restored',
        entityType: 'project',
        entityId: id,
        before: { archived: true },
        after: { archived: false },
      });
    });
    return this.detail(actor, id);
  }

  /** Rule 2: a non-archived user; an invited user qualifies. */
  private async validProjectManager(tx: Transaction, userId: string): Promise<UserSummary> {
    const manager = await this.users.activeUser(userId, tx);
    if (!manager) {
      throw new CodedException(
        400,
        'INVALID_PROJECT_MANAGER',
        'The project manager must be a non-archived user',
      );
    }
    return manager;
  }

  /** Unique case-insensitively per client among non-archived projects. */
  private async assertNameFree(
    executor: Executor,
    clientId: string,
    name: string,
    exceptId?: string,
  ) {
    const [taken] = await executor
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.clientId, clientId),
          sql`lower(${projects.name}) = lower(${name})`,
          isNull(projects.archivedAt),
          exceptId ? ne(projects.id, exceptId) : undefined,
        ),
      );
    if (taken) {
      throw new CodedException(
        409,
        'PROJECT_NAME_TAKEN',
        'The client has a project with this name',
      );
    }
  }

  /** M2: the currency changes only while no amount is set; amounts are never converted. */
  private async assertCurrencyFree(tx: Transaction, projectId: string) {
    const [priced] = await tx
      .select({ id: projectMilestones.id })
      .from(projectMilestones)
      .where(
        and(
          eq(projectMilestones.projectId, projectId),
          isNull(projectMilestones.archivedAt),
          isNotNull(projectMilestones.installmentMinor),
        ),
      )
      .limit(1);
    if (priced) {
      throw new CodedException(
        409,
        'CURRENCY_LOCKED',
        'The currency cannot change once amounts are set',
      );
    }
  }
}

/** Rule 1: work is added only for a non-archived client that is active or paused. */
function assertClientTakesWork(client: ClientSummary): void {
  if (client.archived) {
    throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
  }
  if (client.status === 'ended') {
    throw new CodedException(409, 'CLIENT_ENDED', 'Work is not added for an ended client');
  }
}

/** Rule 5. */
function assertDates(startDate: string, dueDate: string): void {
  if (dueDate < startDate) {
    throw new CodedException(400, 'INVALID_DATES', 'The due date is before the start date');
  }
}

function toProject(
  row: SummaryRow,
  context: {
    people: Map<string, UserSummary>;
    clients: Map<string, ClientSummary>;
    milestones: MilestoneRow[];
    progress: number | null;
    today: string;
  },
): Project {
  const manager = context.people.get(row.projectManagerId);
  return {
    id: row.id,
    name: row.name,
    client: { id: row.clientId, name: context.clients.get(row.clientId)?.name ?? '' },
    projectManager: {
      id: row.projectManagerId,
      name: manager?.name ?? '',
      archived: manager?.archived ?? false,
    },
    departments: row.departments,
    status: row.status,
    startDate: row.startDate,
    dueDate: row.dueDate,
    overdue: isOpen(row.status) && row.dueDate < context.today,
    milestoneProgress: {
      done: context.milestones.filter((milestone) => milestone.status === 'done').length,
      total: context.milestones.length,
    },
    progress: context.progress,
  };
}
