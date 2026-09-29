import { z } from 'zod';
import { type DepartmentCode, departmentCodeSchema } from './departments.js';
import { pageQuerySchema, pageSchema, queryBooleanSchema, sortOrderSchema } from './lists.js';
import { type DeliverableKind, deliverableKindSchema } from './retainers.js';
import {
  DEFAULT_REVISION_LIMIT,
  TASK_LIMITS,
  taskPrioritySchema,
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
      else if (kind === 'retainer_cycle' && !repeated && doc.steps[index]?.repeatKind)
        issue(['steps', i, 'dependsOn', j], 'A fixed step cannot wait on a repeated step');
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
