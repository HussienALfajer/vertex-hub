import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  businessDate,
  type CalendarDate,
  type DepartmentCode,
  type NotificationData,
  type PlanTarget,
  planTemplateRun,
  type RetainerTemplate,
  repeatedStepFor,
  type SetRetainerTemplate,
  type TemplateKind,
  type TemplateRun,
  type TemplateRunInput,
  type TemplateRunListQuery,
  type TemplateRunPage,
  type TemplateRunPlan,
  type TemplateRunTrigger,
} from '@vertex-hub/contracts';
import {
  type Database,
  newId,
  retainerTemplates,
  type Transaction,
  templateRuns,
  templateRunTasks,
  workTemplates,
} from '@vertex-hub/db';
import { and, count, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, lockAccessChanges, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { type Notice, NotificationCenter } from '../notifications/index.js';
import {
  type CycleLink,
  type CycleOpened,
  CycleOpenedHooks,
  EngagementDirectory,
  type ProjectLink,
} from '../projects/index.js';
import { TaskGenerator } from '../tasks/index.js';
import { type TemplateForRun, TemplatesService } from './templates.service.js';

type Executor = Database | Transaction;

type RunRow = typeof templateRuns.$inferSelect;

/** What a run targets once its checks passed. */
type RunTarget =
  | { type: 'project'; project: ProjectLink }
  | { type: 'cycle'; cycle: CycleLink; lineId: string | null };

interface PreparedRun {
  template: TemplateForRun;
  target: RunTarget;
  plan: TemplateRunPlan;
}

const later = (a: CalendarDate, b: CalendarDate) => (a > b ? a : b);

const toActor = (actor: CurrentUserInfo): AuditActor => ({ id: actor.id, name: actor.name });

/**
 * Applying templates (spec F07, rules 6–19): the preview and the run on a project or a cycle, the
 * automatic run when a cycle opens, missing tasks for a cycle line, a retainer's monthly template
 * and the run history.
 */
@Injectable()
export class TemplateRunsService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly generator: TaskGenerator,
    private readonly openedHooks: CycleOpenedHooks,
    private readonly templates: TemplatesService,
    private readonly clients: ClientDirectory,
    private readonly notifications: NotificationCenter,
  ) {}

  onModuleInit(): void {
    this.openedHooks.register((tx, event) => this.onCycleOpened(tx, event));
  }

  /** The plan a run would create; nothing is written. */
  async preview(
    actor: CurrentUserInfo,
    templateId: string,
    input: TemplateRunInput,
  ): Promise<TemplateRunPlan> {
    return this.db.transaction(async (tx) => {
      const { plan } = await this.prepare(tx, actor, templateId, input);
      return plan;
    });
  }

  async apply(
    actor: CurrentUserInfo,
    templateId: string,
    input: TemplateRunInput,
  ): Promise<TemplateRun> {
    const runId = await this.db.transaction(async (tx) => {
      // Serialized with archiving users: the assignees must stay active (F01 change).
      await lockAccessChanges(tx);
      const prepared = await this.prepare(tx, actor, templateId, input);
      return this.create(tx, prepared, 'manual', toActor(actor));
    });
    return this.one(runId);
  }

  /** Rule 18: instances of the repeated step for what a line of the open cycle is missing. */
  async generateMissing(
    actor: CurrentUserInfo,
    retainerId: string,
    cycleId: string,
    lineId: string,
  ): Promise<TemplateRun> {
    const runId = await this.db.transaction(async (tx) => {
      await lockAccessChanges(tx);
      await this.engagements.workableRetainer(tx, actor, retainerId);
      await this.engagements.lockCycle(tx, cycleId);
      const cycle = (await this.engagements.cycles([cycleId], tx)).get(cycleId);
      if (!cycle || cycle.retainerId !== retainerId) throw new NotFoundException();
      if (cycle.status !== 'open') {
        throw new CodedException(409, 'CYCLE_CLOSED', 'The retainer cycle is closed');
      }
      const line = (await this.engagements.cycleLineSummaries([cycleId], tx)).find(
        (candidate) => candidate.id === lineId,
      );
      if (!line) throw new NotFoundException();
      const template = await this.linkedTemplate(tx, retainerId);
      if (!template) throw new CodedException(409, 'NO_TEMPLATE', 'No monthly template is linked');
      assertTemplate(template, 'retainer_cycle');
      if (!repeatedStepFor(template.steps, line)) {
        throw new CodedException(
          409,
          'NO_REPEATED_STEP',
          'The template has no repeated step for this line',
        );
      }
      const missing = line.committed - line.tasks;
      if (missing <= 0) {
        throw new CodedException(409, 'NOTHING_MISSING', 'The line has a task for every unit');
      }
      const plan = await this.plan(tx, template, [], {
        type: 'missing',
        startDate: later(cycle.periodStart, businessDate()),
        periodEnd: cycle.periodEnd,
        line,
        existing: line.tasks,
        missing,
      });
      const target: RunTarget = { type: 'cycle', cycle, lineId };
      return this.create(tx, { template, target, plan }, 'missing_tasks', toActor(actor));
    });
    return this.one(runId);
  }

  /** Rule 16: a cycle of a retainer with a linked, non-archived monthly template gets its tasks. */
  private async onCycleOpened(tx: Transaction, event: CycleOpened): Promise<void> {
    const template = await this.linkedTemplate(tx, event.retainerId);
    if (!template || template.archivedAt || template.kind !== 'retainer_cycle') return;
    const cycle = (await this.engagements.cycles([event.cycleId], tx)).get(event.cycleId);
    if (!cycle || (await this.fullRun(tx, cycle.id))) return;
    const plan = await this.plan(tx, template, [], {
      type: 'cycle',
      startDate: later(cycle.periodStart, event.today),
      periodEnd: cycle.periodEnd,
      lines: await this.engagements.cycleLineSummaries([cycle.id], tx),
    });
    const target: RunTarget = { type: 'cycle', cycle, lineId: null };
    await this.create(tx, { template, target, plan }, 'cycle_opened', event.actor);
  }

  /**
   * Checks a manual run (rules 6, 15 and 17) in the order access, target state, template, then
   * plans it. Access is checked before state, so a caller without access learns nothing.
   */
  private async prepare(
    tx: Transaction,
    actor: CurrentUserInfo,
    templateId: string,
    input: TemplateRunInput,
  ): Promise<PreparedRun> {
    const template = await this.templates.forRun(tx, templateId);
    if (!template) throw new NotFoundException();
    const today = businessDate();

    if (input.projectId) {
      const project = await this.engagements.workableProject(tx, actor, input.projectId);
      assertTemplate(template, 'project');
      const startDate = input.startDate ?? later(project.startDate, today);
      if (startDate < today) {
        throw new CodedException(400, 'INVALID_DATES', 'The start date is in the past');
      }
      const milestones = await this.engagements.projectMilestones(project.id, tx);
      const [earlier] = await tx
        .select({ value: count() })
        .from(templateRuns)
        .where(
          and(eq(templateRuns.templateId, templateId), eq(templateRuns.projectId, project.id)),
        );
      const plan = await this.plan(tx, template, input.assignees, {
        type: 'project',
        startDate,
        dueDate: project.dueDate,
        milestones,
        earlierRuns: earlier?.value ?? 0,
      });
      return { template, target: { type: 'project', project }, plan };
    }

    const cycleId = input.retainerCycleId as string;
    const found = (await this.engagements.cycles([cycleId], tx)).get(cycleId);
    if (!found) throw new NotFoundException();
    await this.engagements.workableRetainer(tx, actor, found.retainerId);
    await this.engagements.lockCycle(tx, cycleId);
    // Read again under the locks: the daily job closes cycles under the retainer lock.
    const cycle = (await this.engagements.cycles([cycleId], tx)).get(cycleId) as CycleLink;
    if (cycle.status !== 'open') {
      throw new CodedException(409, 'CYCLE_CLOSED', 'The retainer cycle is closed');
    }
    const [link] = await tx
      .select({ templateId: retainerTemplates.templateId })
      .from(retainerTemplates)
      .where(eq(retainerTemplates.retainerId, cycle.retainerId));
    if (!link) throw new CodedException(409, 'NO_TEMPLATE', 'No monthly template is linked');
    if (link.templateId !== templateId) {
      throw new CodedException(409, 'TEMPLATE_NOT_LINKED', 'Another template is linked');
    }
    assertTemplate(template, 'retainer_cycle');
    if (await this.fullRun(tx, cycle.id)) {
      throw new CodedException(409, 'ALREADY_GENERATED', "The cycle's tasks were generated");
    }
    const plan = await this.plan(tx, template, input.assignees, {
      type: 'cycle',
      startDate: later(cycle.periodStart, today),
      periodEnd: cycle.periodEnd,
      lines: await this.engagements.cycleLineSummaries([cycle.id], tx),
    });
    return { template, target: { type: 'cycle', cycle, lineId: null }, plan };
  }

  /**
   * Plans with the chosen assignees over the template's defaults (rule 10). A chosen user other
   * than the default must be an active member of the department (`INVALID_ASSIGNEE`); a default
   * that became invalid is replaced by the queue in the plan. A project run that would pass 30
   * milestones is refused (`LIMIT_REACHED`, rule 13).
   */
  private async plan(
    tx: Transaction,
    template: TemplateForRun,
    chosen: TemplateRunInput['assignees'],
    target: PlanTarget,
  ): Promise<TemplateRunPlan> {
    const defaults = new Map(template.assignees.map((a) => [a.department, a.userId]));
    const assigned = new Map<DepartmentCode, string | null>(defaults);
    for (const { department, userId } of chosen) {
      if (userId && userId !== defaults.get(department)) {
        if (!(await this.users.activeMember(userId, department, tx))) {
          throw new CodedException(
            400,
            'INVALID_ASSIGNEE',
            'The assignee must be an active member of the department',
            { department },
          );
        }
      }
      assigned.set(department, userId);
    }
    const departments = [...new Set(template.steps.map((step) => step.department))];
    const userIds = [...assigned.values()].filter((id): id is string => !!id);
    const members = await this.users.activeMembers(departments, tx);
    const people = await this.users.summaries(userIds, tx);
    const pairs = new Set(members.flatMap((m) => m.departments.map((code) => `${m.id}:${code}`)));
    const plan = planTemplateRun({
      template,
      target,
      assignees: [...assigned].map(([department, userId]) => ({
        department,
        user: userId ? { id: userId, name: people.get(userId)?.name ?? '' } : null,
      })),
      isMember: (userId, department) => pairs.has(`${userId}:${department}`),
    });
    if (target.type === 'project') {
      const total = target.milestones.length + plan.milestonesToCreate.length;
      if (plan.milestonesToCreate.length > 0 && total > 30) {
        throw new CodedException(409, 'LIMIT_REACHED', 'A project holds at most 30 milestones', {
          stages: plan.milestonesToCreate.map((milestone) => milestone.name),
        });
      }
    }
    return plan;
  }

  /** Writes a planned run: milestones, the run, its tasks and the audit entries (one transaction). */
  private async create(
    tx: Transaction,
    { template, target, plan }: PreparedRun,
    trigger: TemplateRunTrigger,
    actor: AuditActor | null,
  ): Promise<string> {
    const project = target.type === 'project' ? target.project : null;
    const cycle = target.type === 'cycle' ? target.cycle : null;
    const milestoneIds = project
      ? await this.engagements.createMilestones(tx, project.id, plan.milestonesToCreate, actor)
      : [];
    // Stage names are unique within a template (rule 13).
    const newMilestones = new Map(
      plan.milestonesToCreate.map((m, i) => [m.name, milestoneIds[i] as string]),
    );
    const runId = newId();
    const run = {
      templateId: template.id,
      trigger,
      projectId: project?.id ?? null,
      retainerCycleId: cycle?.id ?? null,
      cycleLineId: target.type === 'cycle' ? target.lineId : null,
      startDate: plan.startDate,
      taskCount: plan.taskCount,
      milestonesCreated: newMilestones.size,
    };
    await tx.insert(templateRuns).values({ id: runId, ...run, createdById: actor?.id ?? null });

    const ids = await this.generator.createMany(
      tx,
      plan.tasks.map((task) => ({
        key: task.key,
        title: task.title,
        brief: task.brief,
        department: task.department,
        assigneeId: task.assignee?.id ?? null,
        priority: task.priority,
        dueDate: task.dueDate,
        clientId: (project?.clientId ?? cycle?.clientId) as string,
        projectId: project?.id ?? null,
        milestoneId: task.milestone
          ? (task.milestone.existingId ?? newMilestones.get(task.milestone.name) ?? null)
          : null,
        retainerCycleId: cycle?.id ?? null,
        cycleLineId: task.cycleLineId,
        needsClientApproval: task.needsClientApproval,
        revisionLimit: task.revisionLimit,
        checklist: task.checklist,
        dependsOn: task.dependsOn,
      })),
      actor,
      runId,
    );
    if (plan.tasks.length > 0) {
      await tx.insert(templateRunTasks).values(
        plan.tasks.map((task) => ({
          runId,
          taskId: ids.get(task.key) as string,
          stepId: task.stepId,
          instance: task.instance,
        })),
      );
    }
    await recordAudit(tx, {
      actor,
      action: 'template_run.created',
      entityType: 'template_run',
      entityId: runId,
      after: {
        ...run,
        template: template.name,
        ...(cycle && { retainerId: cycle.retainerId }),
      },
    });
    await this.notifyRun(tx, runId, template, target, plan, actor);
    return runId;
  }

  /**
   * F14 rule 6: one `tasks_generated` per assignee with their count, and one per department with
   * unassigned tasks to its managers; the run's tasks send no `task_assigned` or `task_requested`.
   */
  private async notifyRun(
    tx: Transaction,
    runId: string,
    template: TemplateForRun,
    target: RunTarget,
    plan: TemplateRunPlan,
    actor: AuditActor | null,
  ): Promise<void> {
    if (plan.tasks.length === 0) return;
    const clientId = target.type === 'project' ? target.project.clientId : target.cycle.clientId;
    const client = await this.clients.summary(clientId, tx);
    const context = {
      template: template.name,
      client: client?.name ?? null,
      project: target.type === 'project' ? target.project.name : null,
      retainer: target.type === 'cycle' ? target.cycle.retainerName : null,
    };
    // Per assignee (their first department names the notice) and per department's queue.
    const assigned = new Map<string, { department: DepartmentCode; count: number }>();
    const queued = new Map<DepartmentCode, number>();
    for (const { assignee, department } of plan.tasks) {
      if (assignee) {
        const group = assigned.get(assignee.id) ?? { department, count: 0 };
        assigned.set(assignee.id, { ...group, count: group.count + 1 });
      } else {
        queued.set(department, (queued.get(department) ?? 0) + 1);
      }
    }
    const managers = await this.users.departmentManagers([...queued.keys()], tx);
    const notice = (recipients: string[], data: NotificationData<'tasks_generated'>): Notice => ({
      type: 'tasks_generated',
      recipients,
      actorId: actor?.id ?? null,
      subjectId: runId,
      data,
    });
    const notices: Notice[] = [
      ...[...assigned].map(([userId, { department, count }]) =>
        notice([userId], { ...context, count, department, unassigned: false }),
      ),
      ...[...queued].map(([department, count]) =>
        notice(managers.get(department) ?? [], { ...context, count, department, unassigned: true }),
      ),
    ];
    await this.notifications.notify(tx, notices);
  }

  /** The monthly template linked to the retainer, or null. */
  private async linkedTemplate(executor: Executor, retainerId: string) {
    const [link] = await executor
      .select({ templateId: retainerTemplates.templateId })
      .from(retainerTemplates)
      .where(eq(retainerTemplates.retainerId, retainerId));
    return link ? this.templates.forRun(executor, link.templateId) : null;
  }

  /** The cycle's full run (`manual` or `cycle_opened`), or undefined. */
  private async fullRun(executor: Executor, cycleId: string): Promise<RunRow | undefined> {
    const [row] = await executor
      .select()
      .from(templateRuns)
      .where(
        and(
          eq(templateRuns.retainerCycleId, cycleId),
          inArray(templateRuns.trigger, ['manual', 'cycle_opened']),
        ),
      );
    return row;
  }

  // Run history

  async list(actor: CurrentUserInfo, query: TemplateRunListQuery): Promise<TemplateRunPage> {
    const filters = [query.projectId, query.retainerId, query.taskId].filter(Boolean);
    if (filters.length !== 1) {
      throw new BadRequestException('Give exactly one of projectId, retainerId and taskId');
    }
    let where: SQL;
    if (query.projectId) {
      await this.engagements.readableProject(actor, query.projectId);
      where = eq(templateRuns.projectId, query.projectId);
    } else if (query.retainerId) {
      await this.engagements.readableRetainer(actor, query.retainerId);
      where = this.engagements.cycleOf(templateRuns.retainerCycleId, query.retainerId);
    } else {
      await this.generator.assertReadable(actor, query.taskId as string);
      where = sql`${templateRuns.id} in (select ${templateRunTasks.runId} from ${templateRunTasks}
        where ${templateRunTasks.taskId} = ${query.taskId})`;
    }
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(templateRuns)
        .where(where)
        .orderBy(desc(templateRuns.createdAt), desc(templateRuns.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(templateRuns).where(where),
    ]);
    return {
      items: await this.present(rows, query.include === 'tasks'),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private async one(id: string): Promise<TemplateRun> {
    const rows = await this.db.select().from(templateRuns).where(eq(templateRuns.id, id));
    const [run] = await this.present(rows, false);
    if (!run) throw new NotFoundException();
    return run;
  }

  private async present(rows: RunRow[], withTasks: boolean): Promise<TemplateRun[]> {
    if (rows.length === 0) return [];
    const runIds = rows.map((row) => row.id);
    const [templates, projects, cycles, lines, people, runTasks] = await Promise.all([
      this.db
        .select({
          id: workTemplates.id,
          name: workTemplates.name,
          archivedAt: workTemplates.archivedAt,
        })
        .from(workTemplates)
        .where(
          inArray(
            workTemplates.id,
            rows.map((row) => row.templateId),
          ),
        ),
      this.engagements.projects(rows.flatMap((row) => (row.projectId ? [row.projectId] : []))),
      this.engagements.cycles(
        rows.flatMap((row) => (row.retainerCycleId ? [row.retainerCycleId] : [])),
      ),
      this.engagements.cycleLines(
        rows.flatMap((row) => (row.cycleLineId ? [row.cycleLineId] : [])),
      ),
      this.users.summaries(rows.flatMap((row) => (row.createdById ? [row.createdById] : []))),
      withTasks
        ? this.db
            .select({ runId: templateRunTasks.runId, taskId: templateRunTasks.taskId })
            .from(templateRunTasks)
            .where(inArray(templateRunTasks.runId, runIds))
        : Promise.resolve([]),
    ]);
    const tasks = await this.generator.summaries(
      this.db,
      runTasks.map((row) => row.taskId),
    );
    const templateOf = new Map(templates.map((row) => [row.id, row]));
    return rows.map((row) => {
      const template = templateOf.get(row.templateId);
      const project = row.projectId ? projects.get(row.projectId) : undefined;
      const cycle = row.retainerCycleId ? cycles.get(row.retainerCycleId) : undefined;
      const line = row.cycleLineId ? lines.get(row.cycleLineId) : undefined;
      const creator = row.createdById ? people.get(row.createdById) : undefined;
      return {
        id: row.id,
        template: {
          id: row.templateId,
          name: template?.name ?? '',
          archived: !!template?.archivedAt,
        },
        trigger: row.trigger,
        project: project ? { id: project.id, name: project.name } : null,
        cycle: cycle
          ? {
              id: cycle.id,
              month: cycle.month,
              retainer: { id: cycle.retainerId, name: cycle.retainerName },
            }
          : null,
        cycleLine: line ? { id: line.id, kind: line.kind, label: line.label } : null,
        startDate: row.startDate,
        taskCount: row.taskCount,
        milestonesCreated: row.milestonesCreated,
        createdBy: creator ? { id: creator.id, name: creator.name } : null,
        createdAt: row.createdAt.toISOString(),
        ...(withTasks && {
          tasks: runTasks
            .filter((link) => link.runId === row.id)
            .flatMap((link) => {
              const task = tasks.get(link.taskId);
              return task && !task.archived
                ? [{ id: task.id, title: task.title, status: task.status }]
                : [];
            }),
        }),
      };
    });
  }

  // A retainer's monthly template (rules 17–19)

  async retainerTemplate(actor: CurrentUserInfo, retainerId: string): Promise<RetainerTemplate> {
    const retainer = await this.engagements.readableRetainer(actor, retainerId);
    const [template, cycle] = await Promise.all([
      this.linkedTemplate(this.db, retainerId),
      this.engagements.openCycle(retainerId),
    ]);
    const [run, lines] = cycle
      ? await Promise.all([
          this.fullRun(this.db, cycle.id),
          this.engagements.cycleLineSummaries([cycle.id]),
        ])
      : [undefined, []];
    const active = !!template && !template.archivedAt;
    return {
      template: template
        ? { id: template.id, name: template.name, archived: !!template.archivedAt }
        : null,
      cycle,
      run: run ? ((await this.present([run], false))[0] ?? null) : null,
      lines: lines.map((line) => ({
        id: line.id,
        kind: line.kind,
        label: line.label,
        committed: line.committed,
        tasks: line.tasks,
        missing: Math.max(0, line.committed - line.tasks),
        canGenerate: active && !!repeatedStepFor(template.steps, line),
      })),
      permissions: { canLink: retainer.canManage, canGenerate: retainer.canManage && active },
    };
  }

  /** Rule 19: links (or unlinks) a monthly template; it applies from the next cycle. */
  async setRetainerTemplate(
    actor: CurrentUserInfo,
    retainerId: string,
    input: SetRetainerTemplate,
  ): Promise<RetainerTemplate> {
    await this.db.transaction(async (tx) => {
      await this.engagements.workableRetainer(tx, actor, retainerId);
      const next = input.templateId ? await this.templates.forRun(tx, input.templateId) : null;
      if (input.templateId && !next) throw new NotFoundException();
      if (next) assertTemplate(next, 'retainer_cycle');
      const current = await this.linkedTemplate(tx, retainerId);
      if ((current?.id ?? null) === (next?.id ?? null)) return;
      if (next) {
        await tx
          .insert(retainerTemplates)
          .values({ retainerId, templateId: next.id, linkedById: actor.id })
          .onConflictDoUpdate({
            target: retainerTemplates.retainerId,
            set: { templateId: next.id, linkedById: actor.id, updatedAt: new Date() },
          });
      } else {
        await tx.delete(retainerTemplates).where(eq(retainerTemplates.retainerId, retainerId));
      }
      const summary = (t: TemplateForRun | null) => (t ? { id: t.id, name: t.name } : null);
      await recordAudit(tx, {
        actor: toActor(actor),
        action: 'retainer.template_changed',
        entityType: 'retainer',
        entityId: retainerId,
        before: { template: summary(current) },
        after: { template: summary(next) },
      });
    });
    return this.retainerTemplate(actor, retainerId);
  }
}

/** Only a non-archived template of the right kind is applied or linked. */
function assertTemplate(template: TemplateForRun, kind: TemplateKind): void {
  if (template.archivedAt) {
    throw new CodedException(409, 'TEMPLATE_ARCHIVED', 'The template is archived');
  }
  if (template.kind !== kind) {
    throw new CodedException(400, 'TEMPLATE_KIND_MISMATCH', 'The template is of another kind');
  }
}
