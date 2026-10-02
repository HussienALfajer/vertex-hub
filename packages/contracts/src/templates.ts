import { z } from 'zod';
import {
  addDays,
  type CalendarDate,
  calendarDateSchema,
  isWorkDay,
  nthWorkDay,
  workDaysBetween,
} from './dates.js';
import { type DepartmentCode, departmentCodeSchema } from './departments.js';
import { pageQuerySchema, pageSchema, queryBooleanSchema, sortOrderSchema } from './lists.js';
import { type DeliverableKind, deliverableKindSchema } from './retainers.js';
import {
  DEFAULT_REVISION_LIMIT,
  TASK_LIMITS,
  type TaskPriority,
  taskPrioritySchema,
  taskStatusSchema,
  taskTitleSchema,
} from './tasks.js';
import { optionalText } from './text.js';

/*
 * Work templates (spec F07, ADR 0017): an ordered set of task steps that generates a project's
 * tasks and milestones, or each month of a retainer.
 */

export const TEMPLATE_KINDS = ['project', 'retainer_cycle'] as const;

export const templateKindSchema = z.enum(TEMPLATE_KINDS).meta({ id: 'TemplateKind' });

export type TemplateKind = z.infer<typeof templateKindSchema>;

export const TEMPLATE_RUN_TRIGGERS = ['manual', 'cycle_opened', 'missing_tasks'] as const;

export const templateRunTriggerSchema = z
  .enum(TEMPLATE_RUN_TRIGGERS)
  .meta({ id: 'TemplateRunTrigger' });

export type TemplateRunTrigger = z.infer<typeof templateRunTriggerSchema>;

/** Limits of what one template holds (spec F07, "Data"). */
export const TEMPLATE_LIMITS = {
  stages: 30,
  steps: 60,
  dependencies: TASK_LIMITS.dependencies,
  checklist: TASK_LIMITS.checklist,
  /** Last due day of a project step, about a year of work days. */
  projectDueDay: 260,
  /** Last due day or spread start of a monthly step. */
  cycleDueDay: 27,
  /** Tasks one run creates at most (rule 14). */
  runTasks: 300,
} as const;

// Inputs

/** A client key for a new stage or step, or the id of an existing one to keep it (PUT). */
const templateKeySchema = z.string().trim().min(1).max(64);

const templateStageInputSchema = z.object({
  key: templateKeySchema,
  name: z.string().trim().min(1).max(80),
});

const templateStepInputSchema = z.object({
  key: templateKeySchema,
  /** Project templates: the stage's key, or null for a step without a stage. */
  stageKey: templateKeySchema.nullable().default(null),
  title: taskTitleSchema,
  brief: optionalText(5000).default(null),
  department: departmentCodeSchema,
  /** Work day the task is due, from the run's start; null for repeated steps only. */
  dueDay: z.number().int().min(1).max(TEMPLATE_LIMITS.projectDueDay).nullable().default(null),
  priority: taskPrioritySchema.default('normal'),
  needsClientApproval: z.boolean().default(true),
  revisionLimit: z
    .number()
    .int()
    .min(0)
    .max(TASK_LIMITS.revisionLimit)
    .default(DEFAULT_REVISION_LIMIT),
  checklist: z.array(z.string().trim().min(1).max(200)).max(TEMPLATE_LIMITS.checklist).default([]),
  /** Monthly templates: one task per committed unit of the cycle line of this kind. */
  repeatKind: deliverableKindSchema.nullable().default(null),
  /** Required with `repeatKind` `other`: matches the line label, case-insensitively. */
  repeatLabel: optionalText(60).default(null),
  /** Repeated steps: the first work day instances may fall on; 1 when left out. */
  spreadFromDay: z.number().int().min(1).max(TEMPLATE_LIMITS.cycleDueDay).nullable().default(null),
  /** Keys of earlier steps. */
  dependsOn: z
    .array(templateKeySchema)
    .max(TEMPLATE_LIMITS.dependencies)
    .transform((keys) => [...new Set(keys)])
    .default([]),
});

const templateAssigneeInputSchema = z.object({
  department: departmentCodeSchema,
  userId: z.uuid(),
});

const templateDocumentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: optionalText(1000).default(null),
  /** Order is the position. */
  stages: z.array(templateStageInputSchema).max(TEMPLATE_LIMITS.stages).default([]),
  /** Order is the position; at least one step (rule 3). */
  steps: z.array(templateStepInputSchema).min(1).max(TEMPLATE_LIMITS.steps),
  /** Default assignee per department; a department without one defaults to its queue. */
  assignees: z.array(templateAssigneeInputSchema).default([]),
});

export type TemplateDocument = z.infer<typeof templateDocumentSchema>;

export type TemplateIssue = { path: (string | number)[]; message: string };

const repeatKey = (step: { repeatKind: DeliverableKind | null; repeatLabel: string | null }) =>
  `${step.repeatKind}:${step.repeatKind === 'other' ? (step.repeatLabel?.toLocaleLowerCase('ar') ?? '') : ''}`;

/**
 * Rules 1–3 that depend on the kind, checked on a whole template: fields per kind, stage and
 * dependency keys, earlier-steps-only dependencies, one repeated step per line kind and default
 * assignees for departments the steps use. The create schema runs it; the API runs it on a PUT
 * with the stored kind.
 */
export function templateIssues(kind: TemplateKind, doc: TemplateDocument): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const issue = (path: (string | number)[], message: string) => issues.push({ path, message });

  const stageKeys = new Set<string>();
  const stageNames = new Set<string>();
  doc.stages.forEach((stage, i) => {
    if (kind !== 'project') issue(['stages', i], 'Only project templates have stages');
    if (stageKeys.has(stage.key)) issue(['stages', i, 'key'], 'Duplicate key');
    const name = stage.name.toLocaleLowerCase('ar');
    if (stageNames.has(name)) issue(['stages', i, 'name'], 'Duplicate stage name');
    stageKeys.add(stage.key);
    stageNames.add(name);
  });

  const stepIndex = new Map<string, number>();
  const repeatKeys = new Set<string>();
  doc.steps.forEach((step, i) => {
    const path = (field: string) => ['steps', i, field];
    if (stepIndex.has(step.key)) issue(path('key'), 'Duplicate key');
    if (step.stageKey !== null && (kind !== 'project' || !stageKeys.has(step.stageKey)))
      issue(path('stageKey'), 'Unknown stage');

    const repeated = step.repeatKind !== null;
    if (kind === 'project') {
      if (repeated) issue(path('repeatKind'), 'Only monthly templates repeat steps');
      if (step.spreadFromDay !== null) issue(path('spreadFromDay'), 'Only for repeated steps');
      if (step.dueDay === null) issue(path('dueDay'), 'Required');
    } else if (repeated) {
      if (step.dueDay !== null) issue(path('dueDay'), 'Repeated steps are spread instead');
      if ((step.repeatKind === 'other') !== (step.repeatLabel !== null))
        issue(path('repeatLabel'), 'A label goes with the kind "other" only');
      const key = repeatKey(step);
      if (repeatKeys.has(key)) issue(path('repeatKind'), 'One repeated step per deliverable');
      repeatKeys.add(key);
    } else {
      if (step.dueDay === null) issue(path('dueDay'), 'Required');
      else if (step.dueDay > TEMPLATE_LIMITS.cycleDueDay) issue(path('dueDay'), 'At most 27');
      if (step.spreadFromDay !== null) issue(path('spreadFromDay'), 'Only for repeated steps');
    }
    if (!repeated && step.repeatLabel !== null)
      issue(path('repeatLabel'), 'Only for repeated steps');

    step.dependsOn.forEach((key, j) => {
      const index = stepIndex.get(key);
      if (index === undefined) issue(['steps', i, 'dependsOn', j], 'Not an earlier step');
      // A step waiting on a repeated step would wait on up to 999 tasks, or on keys that
      // match no single task (rule 2).
      else if (kind === 'retainer_cycle' && doc.steps[index]?.repeatKind)
        issue(['steps', i, 'dependsOn', j], 'No step can wait on a repeated step');
    });
    stepIndex.set(step.key, i);
  });

  const used = new Set<DepartmentCode>(doc.steps.map((step) => step.department));
  const assigned = new Set<DepartmentCode>();
  doc.assignees.forEach((assignee, i) => {
    if (!used.has(assignee.department) || assigned.has(assignee.department))
      issue(['assignees', i, 'department'], 'Not a department of the steps, or repeated');
    assigned.add(assignee.department);
  });
  return issues;
}

/**
 * A new template. The API checks what needs the database: the name is free
 * (`TEMPLATE_NAME_TAKEN`) and default assignees are members (`INVALID_ASSIGNEE`).
 */
export const createTemplateSchema = templateDocumentSchema
  .extend({ kind: templateKindSchema })
  .superRefine((template, ctx) => {
    for (const { path, message } of templateIssues(template.kind, template))
      ctx.addIssue({ code: 'custom', path, message });
  })
  .meta({ id: 'CreateTemplate' });

export type CreateTemplate = z.infer<typeof createTemplateSchema>;

export type CreateTemplateInput = z.input<typeof createTemplateSchema>;

/**
 * The whole template again, without the kind: stages and steps are replaced, a `key` equal to an
 * existing id keeps that row. The API runs `templateIssues` with the stored kind.
 */
export const updateTemplateSchema = templateDocumentSchema.meta({ id: 'UpdateTemplate' });

export type UpdateTemplate = z.infer<typeof updateTemplateSchema>;

export type UpdateTemplateInput = z.input<typeof updateTemplateSchema>;

// Responses

const personSchema = z.object({ id: z.uuid(), name: z.string() });

export const templateStageSchema = z
  .object({ id: z.uuid(), name: z.string(), position: z.number().int().min(1) })
  .meta({ id: 'TemplateStage' });

export const templateStepSchema = z
  .object({
    id: z.uuid(),
    stageId: z.uuid().nullable(),
    position: z.number().int().min(1),
    title: z.string(),
    brief: z.string().nullable(),
    department: departmentCodeSchema,
    dueDay: z.number().int().nullable(),
    priority: taskPrioritySchema,
    needsClientApproval: z.boolean(),
    revisionLimit: z.number().int().min(0),
    checklist: z.array(z.string()),
    repeatKind: deliverableKindSchema.nullable(),
    repeatLabel: z.string().nullable(),
    spreadFromDay: z.number().int().nullable(),
    /** Ids of earlier steps. */
    dependsOn: z.array(z.uuid()),
  })
  .meta({ id: 'TemplateStep' });

export type TemplateStep = z.infer<typeof templateStepSchema>;

export const templateAssigneeSchema = z
  .object({
    department: departmentCodeSchema,
    user: personSchema.extend({ archived: z.boolean() }),
    /** False once the user is archived or left the department: runs leave those tasks unassigned. */
    valid: z.boolean(),
  })
  .meta({ id: 'TemplateAssignee' });

export type TemplateAssignee = z.infer<typeof templateAssigneeSchema>;

export const templatePermissionsSchema = z
  .object({ canEdit: z.boolean(), canArchive: z.boolean() })
  .meta({ id: 'TemplatePermissions' });

export const templateDetailSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: templateKindSchema,
    description: z.string().nullable(),
    stages: z.array(templateStageSchema),
    steps: z.array(templateStepSchema),
    assignees: z.array(templateAssigneeSchema),
    /** Departments whose default assignee is no longer valid (rule 4). */
    warnings: z.array(
      z.object({ type: z.literal('invalid_assignee'), department: departmentCodeSchema }),
    ),
    /** Monthly templates: the non-archived retainers linked to it. */
    linkedRetainers: z.array(personSchema.extend({ client: personSchema })),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
    permissions: templatePermissionsSchema,
  })
  .meta({ id: 'TemplateDetail' });

export type TemplateDetail = z.infer<typeof templateDetailSchema>;

export const templateListItemSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: templateKindSchema,
    description: z.string().nullable(),
    stepCount: z.number().int().min(0),
    departments: z.array(departmentCodeSchema),
    warningCount: z.number().int().min(0),
    linkedRetainerCount: z.number().int().min(0),
    updatedAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'TemplateListItem' });

export type TemplateListItem = z.infer<typeof templateListItemSchema>;

export const TEMPLATE_SORTS = ['name', 'updatedAt'] as const;

export const templateListQuerySchema = pageQuerySchema.extend({
  /** Matches the template name. */
  search: z.string().trim().min(1).max(100).optional(),
  kind: templateKindSchema.optional(),
  /** `true` lists archived templates only; needs `templates.manage`. */
  archived: queryBooleanSchema.default(false),
  sort: z.enum(TEMPLATE_SORTS).default('name'),
  order: sortOrderSchema.default('asc'),
});

export type TemplateListQuery = z.infer<typeof templateListQuerySchema>;

export const templatePageSchema = pageSchema(templateListItemSchema).meta({
  id: 'TemplatePage',
  description: 'Work templates',
});

export type TemplatePage = z.infer<typeof templatePageSchema>;
// Runs (rules 6–19)

export const templateRunInputSchema = z
  .object({
    /** A project run; exactly one of `projectId` and `retainerCycleId`. */
    projectId: z.uuid().optional(),
    /** A run on the retainer's open current cycle. */
    retainerCycleId: z.uuid().optional(),
    /** Project runs only: default the later of the project's start date and today (rule 6). */
    startDate: calendarDateSchema.optional(),
    /** Project runs only: replaces every step's revision limit (F04 A4). */
    revisionLimit: z.number().int().min(0).max(TASK_LIMITS.revisionLimit).optional(),
    /** Per department: a user, or null for its queue; others get the template's default. */
    assignees: z
      .array(z.object({ department: departmentCodeSchema, userId: z.uuid().nullable() }))
      .max(20)
      .default([]),
  })
  .superRefine((input, ctx) => {
    if (!input.projectId === !input.retainerCycleId) {
      ctx.addIssue({ code: 'custom', path: ['projectId'], message: 'A project or a cycle' });
    }
    if (input.startDate && !input.projectId) {
      ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'Project runs only' });
    }
    if (input.revisionLimit !== undefined && !input.projectId) {
      ctx.addIssue({ code: 'custom', path: ['revisionLimit'], message: 'Project runs only' });
    }
    const departments = input.assignees.map((a) => a.department);
    if (new Set(departments).size !== departments.length) {
      ctx.addIssue({ code: 'custom', path: ['assignees'], message: 'One entry per department' });
    }
  })
  .meta({ id: 'TemplateRunInput' });

export type TemplateRunInput = z.infer<typeof templateRunInputSchema>;

export type TemplateRunInputBody = z.input<typeof templateRunInputSchema>;

export const TEMPLATE_RUN_WARNINGS = [
  /** Tasks due after the project's due date (rule 7). */
  'due_after_project',
  /** The template was applied to the project before (rule 15). */
  'applied_before',
  /** A department's assignee is no longer a member: its tasks go to the queue (rule 10). */
  'assignee_replaced',
  /** Repeated instances left out at the task cap (rule 14). */
  'over_cap',
] as const;

export const templateRunWarningSchema = z
  .object({
    type: z.enum(TEMPLATE_RUN_WARNINGS),
    /** `assignee_replaced` only. */
    department: departmentCodeSchema.nullable(),
    /** The tasks it concerns; for `applied_before`, the earlier runs. */
    count: z.number().int().min(1),
  })
  .meta({ id: 'TemplateRunWarning' });

export type TemplateRunWarning = z.infer<typeof templateRunWarningSchema>;

export const templatePlannedTaskSchema = z
  .object({
    /** The step id, with `:<instance>` for a repeated step. */
    key: z.string(),
    title: z.string(),
    department: departmentCodeSchema,
    /** Null: the department's queue. */
    assignee: personSchema.nullable(),
    /** The chosen assignee is no longer a member of the department (rule 10). */
    assigneeReplaced: z.boolean(),
    dueDate: calendarDateSchema,
    /** Project runs: the milestone of the step's stage; `existingId` null for a new one. */
    milestone: z.object({ existingId: z.uuid().nullable(), name: z.string() }).nullable(),
    /** Cycle runs: the line a repeated instance counts for. */
    cycleLineId: z.uuid().nullable(),
    /** Keys of the tasks of this run it waits on. */
    dependsOn: z.array(z.string()),
  })
  .meta({ id: 'TemplatePlannedTask' });

export const templateRunPlanSchema = z
  .object({
    startDate: calendarDateSchema,
    tasks: z.array(templatePlannedTaskSchema),
    /** New milestones in the order they are appended (rule 13). */
    milestonesToCreate: z.array(z.object({ name: z.string(), dueDate: calendarDateSchema })),
    warnings: z.array(templateRunWarningSchema),
    taskCount: z.number().int().min(0),
  })
  .meta({ id: 'TemplateRunPlan' });

export type TemplateRunPlanResponse = z.infer<typeof templateRunPlanSchema>;

/** A planned task with the fields the run copies from its step (rule 11). */
export type PlannedTask = z.infer<typeof templatePlannedTaskSchema> & {
  stepId: string;
  /** Repeated steps: the instance number. */
  instance: number | null;
  brief: string | null;
  priority: TaskPriority;
  needsClientApproval: boolean;
  revisionLimit: number;
  checklist: string[];
};

export type TemplateRunPlan = Omit<TemplateRunPlanResponse, 'tasks'> & { tasks: PlannedTask[] };

/** A line of the cycle a run generates for. */
export interface PlanCycleLine {
  id: string;
  kind: DeliverableKind;
  label: string | null;
  committed: number;
  /** Replaces the repeated step's revision limit when set (F04). */
  revisionLimit: number | null;
}

export type PlanTarget =
  | {
      type: 'project';
      startDate: CalendarDate;
      /** The project's due date, for the `due_after_project` warning. */
      dueDate: CalendarDate;
      /** The project's non-archived milestones. */
      milestones: { id: string; name: string; position: number; status: 'pending' | 'done' }[];
      /** Earlier runs of this template on the project. */
      earlierRuns: number;
    }
  | { type: 'cycle'; startDate: CalendarDate; periodEnd: CalendarDate; lines: PlanCycleLine[] }
  | {
      /** Rule 18: `missing` more instances for one line, numbered after its `existing` tasks. */
      type: 'missing';
      startDate: CalendarDate;
      periodEnd: CalendarDate;
      line: PlanCycleLine;
      existing: number;
      missing: number;
    };

export interface PlanInput {
  template: { stages: { id: string; name: string; position: number }[]; steps: TemplateStep[] };
  target: PlanTarget;
  /** The assignee per department; a department left out goes to its queue. */
  assignees: { department: DepartmentCode; user: { id: string; name: string } | null }[];
  /** Whether the user is a non-archived member of the department at run time (rule 10). */
  isMember: (userId: string, department: DepartmentCode) => boolean;
  /** Replaces every step's revision limit (F04 A4: project runs from an accepted quote). */
  revisionLimit?: number;
}

const sameName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase('ar') === b.trim().toLocaleLowerCase('ar');

/** The step that repeats for a cycle line: same kind, and same label for `other` (rule 9). */
export function repeatedStepFor<T extends Pick<TemplateStep, 'repeatKind' | 'repeatLabel'>>(
  steps: readonly T[],
  line: { kind: DeliverableKind; label: string | null },
): T | undefined {
  return steps.find(
    (step) =>
      step.repeatKind === line.kind &&
      (line.kind !== 'other' || sameName(step.repeatLabel ?? '', line.label ?? '')),
  );
}

/**
 * Rule 8: the last work day on or before the period end, or the period end when the run starts
 * after it; never before the start, so no task is due before the run.
 */
export function cycleLastWorkDay(start: CalendarDate, periodEnd: CalendarDate): CalendarDate {
  if (start > periodEnd) return start;
  let last = periodEnd;
  while (!isWorkDay(last) && last > start) last = addDays(last, -1);
  return isWorkDay(last) ? last : periodEnd;
}

/**
 * Rule 9: `n` due dates spread over the work days from `from` to `last` (or `last` alone when that
 * range is empty); instance i falls on D[⌈i·W/n⌉ − 1], so the last one is on `last`.
 */
export function spreadDueDates(from: CalendarDate, last: CalendarDate, n: number): CalendarDate[] {
  const range = workDaysBetween(from, last);
  const days = range.length > 0 ? range : [last];
  const w = days.length;
  return Array.from({ length: n }, (_, k) => days[Math.ceil(((k + 1) * w) / n) - 1] as string);
}

/** "<title> <i>", cut so it stays a valid task title. */
const instanceTitle = (title: string, i: number) => {
  const suffix = ` ${i}`;
  return `${title.slice(0, 160 - suffix.length)}${suffix}`;
};

type TaskFields = Pick<
  PlannedTask,
  'key' | 'title' | 'dueDate' | 'milestone' | 'cycleLineId' | 'instance' | 'dependsOn'
> & {
  /** The cycle line's revision limit, for its repeated instances (F04). */
  lineRevisionLimit?: number | null;
};

/**
 * Plans a run (rules 7–14 and 18) without side effects: the preview returns it and the apply
 * creates it. The caller checks the target (rules 15–18) and resolves the start date (rule 6).
 */
export function planTemplateRun(input: PlanInput): TemplateRunPlan {
  const { template, target } = input;
  const start = target.startDate;
  const replaced = new Map<DepartmentCode, number>();
  const chosen = new Map(input.assignees.map((a) => [a.department, a.user]));
  const taskOf = (
    step: TemplateStep,
    { lineRevisionLimit, ...fields }: TaskFields,
  ): PlannedTask => {
    const user = chosen.get(step.department) ?? null;
    const stale = !!user && !input.isMember(user.id, step.department);
    if (stale) replaced.set(step.department, (replaced.get(step.department) ?? 0) + 1);
    return {
      ...fields,
      stepId: step.id,
      department: step.department,
      assignee: stale ? null : user,
      assigneeReplaced: stale,
      brief: step.brief,
      priority: step.priority,
      needsClientApproval: step.needsClientApproval,
      revisionLimit: input.revisionLimit ?? lineRevisionLimit ?? step.revisionLimit,
      checklist: step.checklist,
    };
  };

  const tasks: PlannedTask[] = [];
  const milestonesToCreate: { name: string; dueDate: CalendarDate }[] = [];
  const warnings: TemplateRunWarning[] = [];

  if (target.type === 'project') {
    const stages = [...template.stages].sort((a, b) => a.position - b.position);
    const pending = target.milestones
      .filter((m) => m.status === 'pending')
      .sort((a, b) => a.position - b.position);
    const milestoneOf = new Map(
      stages.map((stage) => [
        stage.id,
        {
          existingId: pending.find((m) => sameName(m.name, stage.name))?.id ?? null,
          name: stage.name,
        },
      ]),
    );
    for (const step of template.steps) {
      tasks.push(
        taskOf(step, {
          key: step.id,
          title: step.title,
          dueDate: nthWorkDay(start, step.dueDay ?? 1),
          milestone: step.stageId ? (milestoneOf.get(step.stageId) ?? null) : null,
          cycleLineId: null,
          instance: null,
          dependsOn: step.dependsOn,
        }),
      );
    }
    // Rule 13: each stage used by a step and matching no pending milestone, in stage order.
    for (const stage of stages) {
      if (milestoneOf.get(stage.id)?.existingId) continue;
      const dates = template.steps.flatMap((step, i) =>
        step.stageId === stage.id ? [tasks[i]?.dueDate as CalendarDate] : [],
      );
      if (dates.length === 0) continue;
      milestonesToCreate.push({ name: stage.name, dueDate: dates.sort().at(-1) as CalendarDate });
    }
    const late = tasks.filter((task) => task.dueDate > target.dueDate).length;
    if (late > 0) warnings.push({ type: 'due_after_project', department: null, count: late });
    if (target.earlierRuns > 0) {
      warnings.push({ type: 'applied_before', department: null, count: target.earlierRuns });
    }
  } else {
    const last = cycleLastWorkDay(start, target.periodEnd);
    let skipped = 0;
    /** Adds up to `n` instances of a repeated step within the cap (rule 14). */
    const addInstances = (
      step: TemplateStep,
      line: PlanCycleLine,
      n: number,
      from: CalendarDate,
      firstNumber: number,
      dependsOn: string[],
    ) => {
      const dates = spreadDueDates(from, last, n);
      const kept = Math.min(n, TEMPLATE_LIMITS.runTasks - tasks.length);
      skipped += n - kept;
      for (let k = 0; k < kept; k += 1) {
        const i = firstNumber + k;
        tasks.push(
          taskOf(step, {
            key: `${step.id}:${i}`,
            title: instanceTitle(step.title, i),
            dueDate: dates[k] as CalendarDate,
            milestone: null,
            cycleLineId: line.id,
            instance: i,
            dependsOn,
            lineRevisionLimit: line.revisionLimit,
          }),
        );
      }
    };

    if (target.type === 'cycle') {
      for (const step of template.steps.filter((s) => s.repeatKind === null)) {
        const due = nthWorkDay(start, step.dueDay ?? 1);
        tasks.push(
          taskOf(step, {
            key: step.id,
            title: step.title,
            dueDate: due < last ? due : last,
            milestone: null,
            cycleLineId: null,
            instance: null,
            dependsOn: step.dependsOn,
          }),
        );
      }
      for (const step of template.steps.filter((s) => s.repeatKind !== null)) {
        const line = target.lines.find((l) => repeatedStepFor([step], l));
        if (!line || line.committed <= 0) continue;
        const from = nthWorkDay(start, step.spreadFromDay ?? 1);
        addInstances(step, line, line.committed, from, 1, step.dependsOn);
      }
    } else {
      const step = repeatedStepFor(template.steps, target.line);
      // Rule 18: spread from the start over the remaining work days, without dependencies.
      if (step && target.missing > 0) {
        addInstances(step, target.line, target.missing, start, target.existing + 1, []);
      }
    }
    if (skipped > 0) warnings.push({ type: 'over_cap', department: null, count: skipped });
  }

  for (const [department, count] of replaced) {
    warnings.push({ type: 'assignee_replaced', department, count });
  }
  // Rule 12: only tasks of this run; a stored template never waits on a repeated step (rule 2).
  const planned = new Set(tasks.map((task) => task.key));
  for (const task of tasks) task.dependsOn = task.dependsOn.filter((key) => planned.has(key));
  return { startDate: start, tasks, milestonesToCreate, warnings, taskCount: tasks.length };
}

export const templateRunTaskSchema = z
  .object({ id: z.uuid(), title: z.string(), status: taskStatusSchema })
  .meta({ id: 'TemplateRunTask' });

export const templateRunSchema = z
  .object({
    id: z.uuid(),
    template: personSchema.extend({ archived: z.boolean() }),
    trigger: templateRunTriggerSchema,
    project: personSchema.nullable(),
    cycle: z.object({ id: z.uuid(), month: calendarDateSchema, retainer: personSchema }).nullable(),
    /** `missing_tasks` runs: the line they filled. */
    cycleLine: z
      .object({ id: z.uuid(), kind: deliverableKindSchema, label: z.string().nullable() })
      .nullable(),
    startDate: calendarDateSchema,
    taskCount: z.number().int().min(0),
    milestonesCreated: z.number().int().min(0),
    /** Null for automatic runs. */
    createdBy: personSchema.nullable(),
    createdAt: z.iso.datetime(),
    /** With `include=tasks`: the run's non-archived tasks. */
    tasks: z.array(templateRunTaskSchema).optional(),
  })
  .meta({ id: 'TemplateRun' });

export type TemplateRun = z.infer<typeof templateRunSchema>;

/** Exactly one of `projectId`, `retainerId` and `taskId`; the API answers 400 otherwise. */
export const templateRunListQuerySchema = pageQuerySchema.extend({
  projectId: z.uuid().optional(),
  retainerId: z.uuid().optional(),
  taskId: z.uuid().optional(),
  include: z.enum(['tasks']).optional(),
});

export type TemplateRunListQuery = z.infer<typeof templateRunListQuerySchema>;

export const templateRunPageSchema = pageSchema(templateRunSchema).meta({
  id: 'TemplateRunPage',
  description: 'Template runs, newest first',
});

export type TemplateRunPage = z.infer<typeof templateRunPageSchema>;

// A retainer's monthly template (rules 16–19)

export const setRetainerTemplateSchema = z
  .object({ templateId: z.uuid().nullable() })
  .meta({ id: 'SetRetainerTemplate' });

export type SetRetainerTemplate = z.infer<typeof setRetainerTemplateSchema>;

export const retainerTemplateLineSchema = z
  .object({
    id: z.uuid(),
    kind: deliverableKindSchema,
    label: z.string().nullable(),
    committed: z.number().int().min(0),
    /** The line's non-archived, non-cancelled tasks, any origin. */
    tasks: z.number().int().min(0),
    /** committed − tasks, at least 0 (rule 18). */
    missing: z.number().int().min(0),
    /** The linked template is not archived and has a repeated step for the line. */
    canGenerate: z.boolean(),
  })
  .meta({ id: 'RetainerTemplateLine' });

export const retainerTemplateSchema = z
  .object({
    template: personSchema.extend({ archived: z.boolean() }).nullable(),
    /** The open current cycle, or null. */
    cycle: z
      .object({
        id: z.uuid(),
        month: calendarDateSchema,
        periodStart: calendarDateSchema,
        periodEnd: calendarDateSchema,
      })
      .nullable(),
    /** The cycle's full run (`manual` or `cycle_opened`), or null. */
    run: templateRunSchema.nullable(),
    lines: z.array(retainerTemplateLineSchema),
    /** Link and generate need `projects.manage` over the client. */
    permissions: z.object({ canLink: z.boolean(), canGenerate: z.boolean() }),
  })
  .meta({ id: 'RetainerTemplate' });

export type RetainerTemplate = z.infer<typeof retainerTemplateSchema>;
