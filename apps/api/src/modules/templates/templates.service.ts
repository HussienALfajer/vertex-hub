import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreateTemplate,
  type DepartmentCode,
  hasPermission,
  type TemplateDetail,
  type TemplateDocument,
  type TemplateKind,
  type TemplateListQuery,
  type TemplatePage,
  type TemplateStep,
  templateIssues,
  type UpdateTemplate,
} from '@vertex-hub/contracts';
import {
  type Database,
  newId,
  retainerTemplates,
  type Transaction,
  workTemplateAssignees,
  workTemplateStages,
  workTemplateStepDependencies,
  workTemplateSteps,
  workTemplates,
} from '@vertex-hub/db';
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { EngagementDirectory } from '../projects/index.js';

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

type Executor = Database | Transaction;

type AssigneeRow = { templateId: string; department: DepartmentCode; userId: string };

export interface TemplateForRun {
  id: string;
  name: string;
  kind: TemplateKind;
  archivedAt: Date | null;
  stages: { id: string; name: string; position: number }[];
  steps: TemplateStep[];
  /** Default assignees, valid or not (rule 10 replaces invalid ones). */
  assignees: AssigneeRow[];
}

type Person = { id: string; name: string };

type AssigneeChange = { department: DepartmentCode; before: Person | null; after: Person | null };

/** Drizzle leaves columns unqualified in single-table selects; inside a subquery `id` would bind there. */
const templateId = sql`${sql.identifier('work_templates')}.${sql.identifier('id')}`;

const stepCount = sql<number>`(
  select count(*)::int from ${workTemplateSteps}
  where ${workTemplateSteps.templateId} = ${templateId})`;

// Cast to text[]: node-postgres returns arrays of enum types unparsed.
const stepDepartments = sql<DepartmentCode[]>`array(
  select distinct ${workTemplateSteps.department} from ${workTemplateSteps}
  where ${workTemplateSteps.templateId} = ${templateId}
  order by 1)::text[]`;

/** The fields of a step that make it "changed" in the audit summary. */
const STEP_FIELDS = [
  'stageId',
  'position',
  'title',
  'brief',
  'department',
  'dueDay',
  'priority',
  'needsClientApproval',
  'revisionLimit',
  'checklist',
  'repeatKind',
  'repeatLabel',
  'spreadFromDay',
  'dependsOn',
] as const satisfies readonly (keyof TemplateStep)[];

/** Work templates (F07): list, read, and the whole document saved at once. */
@Injectable()
export class TemplatesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
  ) {}

  async list(actor: CurrentUserInfo, query: TemplateListQuery): Promise<TemplatePage> {
    if (query.archived && !hasPermission(actor.access, 'templates.manage')) {
      throw new ForbiddenException();
    }
    const where = and(
      query.archived ? isNotNull(workTemplates.archivedAt) : isNull(workTemplates.archivedAt),
      query.kind ? eq(workTemplates.kind, query.kind) : undefined,
      query.search ? ilike(workTemplates.name, `%${escapeLike(query.search)}%`) : undefined,
    );
    const sortColumn =
      query.sort === 'updatedAt' ? workTemplates.updatedAt : sql`lower(${workTemplates.name})`;
    const order = query.order === 'desc' ? desc : asc;
    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          id: workTemplates.id,
          name: workTemplates.name,
          kind: workTemplates.kind,
          description: workTemplates.description,
          stepCount,
          departments: stepDepartments,
          updatedAt: workTemplates.updatedAt,
          archivedAt: workTemplates.archivedAt,
        })
        .from(workTemplates)
        .where(where)
        .orderBy(order(sortColumn), asc(workTemplates.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(workTemplates).where(where),
    ]);
    const ids = rows.map((row) => row.id);
    const [assignees, links] = await Promise.all([
      this.assigneeRows(ids),
      this.linkedRetainers(ids),
    ]);
    const valid = await this.validAssignments(assignees);
    return {
      items: rows.map((row) => ({
        ...row,
        warningCount: assignees.filter((a) => a.templateId === row.id && !valid(a)).length,
        linkedRetainerCount: links.filter((link) => link.templateId === row.id).length,
        updatedAt: row.updatedAt.toISOString(),
        archivedAt: row.archivedAt?.toISOString() ?? null,
      })),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Archived templates are seen by `templates.manage` only; others get 404. */
  async detail(actor: CurrentUserInfo, id: string): Promise<TemplateDetail> {
    const manage = hasPermission(actor.access, 'templates.manage');
    const [row] = await this.db.select().from(workTemplates).where(eq(workTemplates.id, id));
    if (!row || (row.archivedAt && !manage)) throw new NotFoundException();
    const [stages, steps, assignees, links] = await Promise.all([
      this.db
        .select({
          id: workTemplateStages.id,
          name: workTemplateStages.name,
          position: workTemplateStages.position,
        })
        .from(workTemplateStages)
        .where(eq(workTemplateStages.templateId, id))
        .orderBy(asc(workTemplateStages.position)),
      this.steps(this.db, id),
      this.assigneeRows([id]),
      this.linkedRetainers([id]),
    ]);
    const [people, valid, clients] = await Promise.all([
      this.users.summaries(assignees.map((a) => a.userId)),
      this.validAssignments(assignees),
      this.clients.summaries(links.map((link) => link.clientId)),
    ]);
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      description: row.description,
      stages,
      steps,
      assignees: assignees.map((a) => ({
        department: a.department,
        user: people.get(a.userId) ?? { id: a.userId, name: '', archived: true },
        valid: valid(a),
      })),
      warnings: assignees
        .filter((a) => !valid(a))
        .map((a) => ({ type: 'invalid_assignee' as const, department: a.department })),
      linkedRetainers: links.map((link) => ({
        id: link.id,
        name: link.name,
        client: { id: link.clientId, name: clients.get(link.clientId)?.name ?? '' },
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
      permissions: { canEdit: manage && !row.archivedAt, canArchive: manage },
    };
  }

  async create(actor: CurrentUserInfo, input: CreateTemplate): Promise<TemplateDetail> {
    const id = newId();
    await this.db.transaction(async (tx) => {
      await this.assertNameFree(tx, input.name, null);
      await tx.insert(workTemplates).values({
        id,
        name: input.name,
        kind: input.kind,
        description: input.description,
        createdById: actor.id,
      });
      await this.saveDocument(tx, id, input, []);
      const assignees = await this.saveAssignees(tx, id, input.assignees, []);
      await recordAudit(tx, {
        actor: toActor(actor),
        action: 'template.created',
        entityType: 'template',
        entityId: id,
        after: {
          name: input.name,
          kind: input.kind,
          description: input.description,
          stages: input.stages.length,
          steps: input.steps.length,
        },
      });
      await auditAssignees(tx, actor, id, assignees);
    });
    return this.detail(actor, id);
  }

  async update(actor: CurrentUserInfo, id: string, input: UpdateTemplate): Promise<TemplateDetail> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(workTemplates)
        .where(eq(workTemplates.id, id))
        .for('update');
      if (!current) throw new NotFoundException();
      if (current.archivedAt) {
        throw new CodedException(409, 'TEMPLATE_ARCHIVED', 'The template is archived');
      }
      assertValid(current.kind, input);
      if (input.name.toLocaleLowerCase('ar') !== current.name.toLocaleLowerCase('ar')) {
        await this.assertNameFree(tx, input.name, id);
      }
      const before = await this.steps(tx, id);
      const beforeStages = await tx
        .select({
          id: workTemplateStages.id,
          name: workTemplateStages.name,
          position: workTemplateStages.position,
        })
        .from(workTemplateStages)
        .where(eq(workTemplateStages.templateId, id))
        .orderBy(asc(workTemplateStages.position));
      const summary = await this.saveDocument(tx, id, input, before, beforeStages);
      const currentAssignees = await this.assigneeRows([id], tx);
      const assignees = await this.saveAssignees(tx, id, input.assignees, currentAssignees);
      await tx
        .update(workTemplates)
        .set({ name: input.name, description: input.description, updatedAt: new Date() })
        .where(eq(workTemplates.id, id));

      const basics = { name: current.name, description: current.description };
      const changedBasics = (['name', 'description'] as const).filter(
        (key) => basics[key] !== input[key],
      );
      if (changedBasics.length > 0 || summary) {
        await recordAudit(tx, {
          actor: toActor(actor),
          action: 'template.updated',
          entityType: 'template',
          entityId: id,
          before: Object.fromEntries(changedBasics.map((key) => [key, basics[key]])),
          after: {
            ...Object.fromEntries(changedBasics.map((key) => [key, input[key]])),
            ...summary,
          },
        });
      }
      await auditAssignees(tx, actor, id, assignees);
    });
    return this.detail(actor, id);
  }

  async setArchived(actor: CurrentUserInfo, id: string, archive: boolean): Promise<TemplateDetail> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ name: workTemplates.name, archivedAt: workTemplates.archivedAt })
        .from(workTemplates)
        .where(eq(workTemplates.id, id))
        .for('update');
      if (!current) throw new NotFoundException();
      if (archive && current.archivedAt) {
        throw new CodedException(409, 'TEMPLATE_ARCHIVED', 'The template is archived');
      }
      if (!archive && !current.archivedAt) {
        throw new CodedException(409, 'TEMPLATE_NOT_ARCHIVED', 'The template is not archived');
      }
      if (!archive) await this.assertNameFree(tx, current.name, id);
      await tx
        .update(workTemplates)
        .set({ archivedAt: archive ? new Date() : null })
        .where(eq(workTemplates.id, id));
      await recordAudit(tx, {
        actor: toActor(actor),
        action: archive ? 'template.archived' : 'template.restored',
        entityType: 'template',
        entityId: id,
        before: { archived: !archive },
        after: { archived: archive },
      });
    });
    return this.detail(actor, id);
  }

  /**
   * A template with what a run plans from (rules 6–14), or null. Inside a transaction the share
   * lock on the template waits for an edit in progress (editors lock it for update), so stages,
   * steps and assignees are all read from one saved version.
   */
  async forRun(executor: Executor, id: string): Promise<TemplateForRun | null> {
    const [row] = await executor
      .select({
        id: workTemplates.id,
        name: workTemplates.name,
        kind: workTemplates.kind,
        archivedAt: workTemplates.archivedAt,
      })
      .from(workTemplates)
      .where(eq(workTemplates.id, id))
      .for('share');
    if (!row) return null;
    // One after another: a transaction's client runs one query at a time.
    const stages = await executor
      .select({
        id: workTemplateStages.id,
        name: workTemplateStages.name,
        position: workTemplateStages.position,
      })
      .from(workTemplateStages)
      .where(eq(workTemplateStages.templateId, id))
      .orderBy(asc(workTemplateStages.position));
    const steps = await this.steps(executor, id);
    const assignees = await this.assigneeRows([id], executor);
    return { ...row, stages, steps, assignees };
  }

  /** Unique among non-archived templates, case-insensitively. */
  private async assertNameFree(tx: Transaction, name: string, exceptId: string | null) {
    const [taken] = await tx
      .select({ id: workTemplates.id })
      .from(workTemplates)
      .where(
        and(
          sql`lower(${workTemplates.name}) = lower(${name})`,
          isNull(workTemplates.archivedAt),
          exceptId ? ne(workTemplates.id, exceptId) : undefined,
        ),
      );
    if (taken) {
      throw new CodedException(409, 'TEMPLATE_NAME_TAKEN', 'Another template has this name');
    }
  }

  private async steps(executor: Executor, templateId: string): Promise<TemplateStep[]> {
    const rows = await executor
      .select({
        id: workTemplateSteps.id,
        stageId: workTemplateSteps.stageId,
        position: workTemplateSteps.position,
        title: workTemplateSteps.title,
        brief: workTemplateSteps.brief,
        department: workTemplateSteps.department,
        dueDay: workTemplateSteps.dueDay,
        priority: workTemplateSteps.priority,
        needsClientApproval: workTemplateSteps.needsClientApproval,
        revisionLimit: workTemplateSteps.revisionLimit,
        checklist: workTemplateSteps.checklist,
        repeatKind: workTemplateSteps.repeatKind,
        repeatLabel: workTemplateSteps.repeatLabel,
        spreadFromDay: workTemplateSteps.spreadFromDay,
      })
      .from(workTemplateSteps)
      .where(eq(workTemplateSteps.templateId, templateId))
      .orderBy(asc(workTemplateSteps.position));
    const dependencies =
      rows.length === 0
        ? []
        : await executor
            .select()
            .from(workTemplateStepDependencies)
            .where(
              inArray(
                workTemplateStepDependencies.stepId,
                rows.map((row) => row.id),
              ),
            );
    const position = new Map(rows.map((row) => [row.id, row.position]));
    return rows.map((row) => ({
      ...row,
      dependsOn: dependencies
        .filter((d) => d.stepId === row.id)
        .map((d) => d.dependsOnStepId)
        .sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0)),
    }));
  }

  /**
   * Replaces stages, steps and dependencies: a key equal to an existing id of this template keeps
   * that row, other keys insert new rows, rows left out are removed. Returns the audit summary of
   * what changed, or null.
   */
  private async saveDocument(
    tx: Transaction,
    templateId: string,
    doc: TemplateDocument,
    beforeSteps: TemplateStep[],
    beforeStages: { id: string; name: string; position: number }[] = [],
  ): Promise<Record<string, unknown> | null> {
    const stageIds = new Map(
      doc.stages.map((stage) => [
        stage.key,
        beforeStages.some((s) => s.id === stage.key) ? stage.key : newId(),
      ]),
    );
    const stepIds = new Map(
      doc.steps.map((step) => [
        step.key,
        beforeSteps.some((s) => s.id === step.key) ? step.key : newId(),
      ]),
    );
    const keptStages = new Set(stageIds.values());
    const keptSteps = new Set(stepIds.values());
    const removedSteps = beforeSteps.filter((step) => !keptSteps.has(step.id));
    const removedStages = beforeStages.filter((stage) => !keptStages.has(stage.id));

    if (beforeSteps.length > 0) {
      await tx.delete(workTemplateStepDependencies).where(
        inArray(
          workTemplateStepDependencies.stepId,
          beforeSteps.map((step) => step.id),
        ),
      );
    }
    for (const [index, stage] of doc.stages.entries()) {
      const id = stageIds.get(stage.key) as string;
      await tx
        .insert(workTemplateStages)
        .values({ id, templateId, name: stage.name, position: index + 1 })
        .onConflictDoUpdate({
          target: workTemplateStages.id,
          set: { name: stage.name, position: index + 1 },
        });
    }
    const after: TemplateStep[] = doc.steps.map((step, index) => ({
      id: stepIds.get(step.key) as string,
      stageId: step.stageKey === null ? null : (stageIds.get(step.stageKey) ?? null),
      position: index + 1,
      title: step.title,
      brief: step.brief,
      department: step.department,
      dueDay: step.dueDay,
      priority: step.priority,
      needsClientApproval: step.needsClientApproval,
      revisionLimit: step.revisionLimit,
      checklist: step.checklist,
      repeatKind: step.repeatKind,
      repeatLabel: step.repeatKind === 'other' ? step.repeatLabel : null,
      spreadFromDay: step.repeatKind ? (step.spreadFromDay ?? 1) : null,
      dependsOn: step.dependsOn.map((key) => stepIds.get(key) as string),
    }));
    for (const { dependsOn, ...step } of after) {
      await tx
        .insert(workTemplateSteps)
        .values({ ...step, templateId })
        .onConflictDoUpdate({ target: workTemplateSteps.id, set: step });
    }
    if (removedSteps.length > 0) {
      await tx.delete(workTemplateSteps).where(
        inArray(
          workTemplateSteps.id,
          removedSteps.map((step) => step.id),
        ),
      );
    }
    if (removedStages.length > 0) {
      await tx.delete(workTemplateStages).where(
        inArray(
          workTemplateStages.id,
          removedStages.map((stage) => stage.id),
        ),
      );
    }
    const dependencies = after.flatMap((step) =>
      step.dependsOn.map((dependsOnStepId) => ({ stepId: step.id, dependsOnStepId })),
    );
    if (dependencies.length > 0) await tx.insert(workTemplateStepDependencies).values(dependencies);

    const beforeById = new Map(beforeSteps.map((step) => [step.id, step]));
    const summary = {
      stagesAdded: doc.stages
        .filter((s) => !beforeStages.some((b) => b.id === s.key))
        .map((s) => s.name),
      // Renamed or moved: the order is the order new milestones are appended in (rule 13).
      stagesChanged: doc.stages
        .filter((s, index) =>
          beforeStages.some(
            (b) => b.id === s.key && (b.name !== s.name || b.position !== index + 1),
          ),
        )
        .map((s) => s.name),
      stagesRemoved: removedStages.map((s) => s.name),
      stepsAdded: after.filter((s) => !beforeById.has(s.id)).map((s) => s.title),
      stepsChanged: after
        .filter((s) => {
          const old = beforeById.get(s.id);
          return old && STEP_FIELDS.some((f) => JSON.stringify(old[f]) !== JSON.stringify(s[f]));
        })
        .map((s) => s.title),
      stepsRemoved: removedSteps.map((s) => s.title),
    };
    const changed = Object.fromEntries(Object.entries(summary).filter(([, names]) => names.length));
    return Object.keys(changed).length > 0 ? changed : null;
  }

  /**
   * Replaces the default assignees. A new or changed default must be a non-archived member of the
   * department (rule 4, `INVALID_ASSIGNEE`); an unchanged one is kept even when it became invalid
   * (it stays a warning). Returns the changed departments with their users before and after.
   */
  private async saveAssignees(
    tx: Transaction,
    templateId: string,
    assignees: TemplateDocument['assignees'],
    current: AssigneeRow[],
  ): Promise<AssigneeChange[]> {
    const departments = [...new Set([...current, ...assignees].map((a) => a.department))];
    const beforeOf = new Map(current.map((a) => [a.department, a.userId]));
    const afterOf = new Map(assignees.map((a) => [a.department, a.userId]));
    const changed = departments.filter((d) => beforeOf.get(d) !== afterOf.get(d));
    if (changed.length === 0) return [];
    for (const department of changed) {
      const userId = afterOf.get(department);
      if (userId && !(await this.users.activeMember(userId, department, tx))) {
        throw new CodedException(
          400,
          'INVALID_ASSIGNEE',
          'A default assignee must be an active member of the department',
          { department },
        );
      }
    }
    await tx.delete(workTemplateAssignees).where(eq(workTemplateAssignees.templateId, templateId));
    if (assignees.length > 0) {
      await tx.insert(workTemplateAssignees).values(assignees.map((a) => ({ ...a, templateId })));
    }
    const people = await this.users.summaries(
      changed.flatMap((d) => [beforeOf.get(d), afterOf.get(d)]).filter((id) => id !== undefined),
      tx,
    );
    const person = (id: string | undefined) => {
      const user = id ? people.get(id) : undefined;
      return user ? { id: user.id, name: user.name } : null;
    };
    return changed.map((department) => ({
      department,
      before: person(beforeOf.get(department)),
      after: person(afterOf.get(department)),
    }));
  }

  private assigneeRows(templateIds: string[], executor: Executor = this.db) {
    if (templateIds.length === 0) return Promise.resolve([] as AssigneeRow[]);
    return executor
      .select({
        templateId: workTemplateAssignees.templateId,
        department: workTemplateAssignees.department,
        userId: workTemplateAssignees.userId,
      })
      .from(workTemplateAssignees)
      .where(inArray(workTemplateAssignees.templateId, templateIds))
      .orderBy(asc(workTemplateAssignees.department));
  }

  /** Whether each default assignee is still a non-archived member of their department. */
  private async validAssignments(assignees: AssigneeRow[]) {
    const members = await this.users.activeMembers([
      ...new Set(assignees.map((a) => a.department)),
    ]);
    const pairs = new Set(members.flatMap((m) => m.departments.map((code) => `${m.id}:${code}`)));
    return (a: { userId: string; department: DepartmentCode }) =>
      pairs.has(`${a.userId}:${a.department}`);
  }

  /**
   * The linked retainers still in use, by retainer name: not archived, nor under an archived
   * client (F05 G2 hides those from everyone below scope all, so the template shows none).
   */
  private async linkedRetainers(templateIds: string[]) {
    if (templateIds.length === 0) return [];
    const links = await this.db
      .select({
        retainerId: retainerTemplates.retainerId,
        templateId: retainerTemplates.templateId,
      })
      .from(retainerTemplates)
      .where(inArray(retainerTemplates.templateId, templateIds));
    const retainers = await this.engagements.retainers(links.map((link) => link.retainerId));
    const clients = await this.clients.summaries(
      [...retainers.values()].map((retainer) => retainer.clientId),
    );
    return links
      .flatMap((link) => {
        const retainer = retainers.get(link.retainerId);
        const live =
          retainer && !retainer.archived && clients.get(retainer.clientId)?.archived === false;
        return live ? [{ ...retainer, templateId: link.templateId }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }
}

const toActor = (actor: CurrentUserInfo): AuditActor => ({ id: actor.id, name: actor.name });

/** Rules 1–3 against the stored kind; the create schema checks them itself. */
function assertValid(kind: TemplateKind, doc: TemplateDocument): void {
  const issues = templateIssues(kind, doc);
  if (issues.length > 0) {
    throw new BadRequestException({
      statusCode: 400,
      message: 'The template does not match its kind',
      details: issues,
    });
  }
}

/** One `template.assignees_updated` entry per department whose default changed. */
async function auditAssignees(
  tx: Transaction,
  actor: CurrentUserInfo,
  templateId: string,
  changes: AssigneeChange[],
): Promise<void> {
  for (const { department, before, after } of changes) {
    await recordAudit(tx, {
      actor: toActor(actor),
      action: 'template.assignees_updated',
      entityType: 'template',
      entityId: templateId,
      before: { department, user: before },
      after: { department, user: after },
    });
  }
}
