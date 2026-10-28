import { TEMPLATE_KINDS, TEMPLATE_RUN_TRIGGERS } from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { departments, users } from './auth.js';
import { archivedAt, id, timestamps } from './columns.js';
import { deliverableKindEnum } from './deliverables.js';
import { projects } from './projects.js';
import { retainerCycleLines, retainerCycles, retainers } from './retainers.js';
import { subtaskRunModeEnum, taskPriorityEnum, tasks } from './tasks.js';

/*
 * Work templates and their runs (F07, ADR 0017), owned by the api `templates` module. Stages,
 * steps, their dependencies and default assignees are parts of the template document: saving the
 * template replaces them.
 */

export const templateKindEnum = pgEnum('template_kind', TEMPLATE_KINDS);

export const templateRunTriggerEnum = pgEnum('template_run_trigger', TEMPLATE_RUN_TRIGGERS);

export const workTemplates = pgTable(
  'work_templates',
  {
    id: id(),
    name: text('name').notNull(),
    kind: templateKindEnum('kind').notNull(),
    description: text('description'),
    /** `task` templates only (F06B part D): how the sub-steps run. */
    runMode: subtaskRunModeEnum('run_mode'),
    /** Null for the seed templates. */
    createdById: uuid('created_by_id').references(() => users.id),
    /** `task` templates saved from a task (F06B rule D1): "Saved from …". */
    sourceTaskId: uuid('source_task_id').references(() => tasks.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('work_templates_name_idx')
      .on(sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
    index('work_templates_kind_idx').on(table.kind),
    index('work_templates_created_by_id_idx').on(table.createdById),
    index('work_templates_source_task_id_idx').on(table.sourceTaskId),
    // The kind is compared as text: the enum value is added in the same migration.
    check(
      'work_templates_run_mode_check',
      sql`(${table.kind}::text = 'task') = (${table.runMode} is not null)`,
    ),
  ],
);

/**
 * A stage of a project template, which becomes a project milestone when applied, or of a `task`
 * template, which becomes a stage of the task (F06B).
 */
export const workTemplateStages = pgTable(
  'work_template_stages',
  {
    id: id(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => workTemplates.id),
    name: text('name').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [index('work_template_stages_template_id_idx').on(table.templateId, table.position)],
);

export const workTemplateSteps = pgTable(
  'work_template_steps',
  {
    id: id(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => workTemplates.id),
    /** Project templates: null = a task without a milestone; `task` templates: sub-steps by stages. */
    stageId: uuid('stage_id').references(() => workTemplateStages.id),
    /** `task` templates: the root step, on each sub-step (F06B part D). */
    parentStepId: uuid('parent_step_id').references((): AnyPgColumn => workTemplateSteps.id),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    brief: text('brief'),
    department: text('department')
      .notNull()
      .references(() => departments.code),
    /** Work day the task is due from the run's start; null for repeated steps. */
    dueDay: integer('due_day'),
    priority: taskPriorityEnum('priority').notNull().default('normal'),
    needsClientApproval: boolean('needs_client_approval').notNull().default(true),
    revisionLimit: integer('revision_limit').notNull().default(2),
    checklist: text('checklist').array().notNull().default(sql`'{}'::text[]`),
    /** Monthly templates: one task per committed unit of the cycle line of this kind. */
    repeatKind: deliverableKindEnum('repeat_kind'),
    repeatLabel: text('repeat_label'),
    spreadFromDay: integer('spread_from_day'),
    /** `task` templates only (F06B rules C1, C6–C8). */
    briefDoc: jsonb('brief_doc'),
    briefFields: jsonb('brief_fields'),
    estimateMinutes: integer('estimate_minutes'),
    criteria: text('criteria').array().notNull().default(sql`'{}'::text[]`),
  },
  (table) => [
    index('work_template_steps_template_id_idx').on(table.templateId, table.position),
    index('work_template_steps_stage_id_idx').on(table.stageId),
    index('work_template_steps_parent_step_id_idx').on(table.parentStepId),
    index('work_template_steps_department_idx').on(table.department),
    check(
      'work_template_steps_estimate_check',
      sql`${table.estimateMinutes} between 30 and 12000 and ${table.estimateMinutes} % 30 = 0`,
    ),
    check('work_template_steps_criteria_check', sql`cardinality(${table.criteria}) <= 15`),
    check('work_template_steps_revision_limit_check', sql`${table.revisionLimit} between 0 and 20`),
    check(
      'work_template_steps_timing_check',
      sql`case when ${table.repeatKind} is null
        then ${table.dueDay} is not null and ${table.spreadFromDay} is null and ${table.repeatLabel} is null
        else ${table.dueDay} is null and ${table.spreadFromDay} is not null
          and (${table.repeatKind} = 'other') = (${table.repeatLabel} is not null) end`,
    ),
  ],
);

/** A step waiting on an earlier step of the same template. */
export const workTemplateStepDependencies = pgTable(
  'work_template_step_dependencies',
  {
    stepId: uuid('step_id')
      .notNull()
      .references(() => workTemplateSteps.id),
    dependsOnStepId: uuid('depends_on_step_id')
      .notNull()
      .references(() => workTemplateSteps.id),
  },
  (table) => [
    primaryKey({ columns: [table.stepId, table.dependsOnStepId] }),
    index('work_template_step_dependencies_depends_on_step_id_idx').on(table.dependsOnStepId),
    check(
      'work_template_step_dependencies_self_check',
      sql`${table.stepId} <> ${table.dependsOnStepId}`,
    ),
  ],
);

/** The default assignee of a department's steps; a department without a row goes to its queue. */
export const workTemplateAssignees = pgTable(
  'work_template_assignees',
  {
    templateId: uuid('template_id')
      .notNull()
      .references(() => workTemplates.id),
    department: text('department')
      .notNull()
      .references(() => departments.code),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    primaryKey({ columns: [table.templateId, table.department] }),
    index('work_template_assignees_user_id_idx').on(table.userId),
    index('work_template_assignees_department_idx').on(table.department),
  ],
);

/** The monthly template linked to a retainer; unlinking deletes the row (audited on the retainer). */
export const retainerTemplates = pgTable(
  'retainer_templates',
  {
    retainerId: uuid('retainer_id')
      .primaryKey()
      .references(() => retainers.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => workTemplates.id),
    /** Null: linked by the daily job, applying a quote renewal (F05B Q2). */
    linkedById: uuid('linked_by_id').references(() => users.id),
    ...timestamps(),
  },
  (table) => [
    index('retainer_templates_template_id_idx').on(table.templateId),
    index('retainer_templates_linked_by_id_idx').on(table.linkedById),
  ],
);

/** One application of a template; append-only. */
export const templateRuns = pgTable(
  'template_runs',
  {
    id: id(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => workTemplates.id),
    trigger: templateRunTriggerEnum('trigger').notNull(),
    projectId: uuid('project_id').references(() => projects.id),
    retainerCycleId: uuid('retainer_cycle_id').references(() => retainerCycles.id),
    /** `missing_tasks` runs only. */
    cycleLineId: uuid('cycle_line_id').references(() => retainerCycleLines.id),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    taskCount: integer('task_count').notNull(),
    milestonesCreated: integer('milestones_created').notNull().default(0),
    /** Null for automatic runs of the daily job. */
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('template_runs_template_id_idx').on(table.templateId),
    index('template_runs_project_id_idx').on(table.projectId),
    index('template_runs_retainer_cycle_id_idx').on(table.retainerCycleId),
    index('template_runs_cycle_line_id_idx').on(table.cycleLineId),
    index('template_runs_created_by_id_idx').on(table.createdById),
    // A cycle gets at most one full run (rule 17); it also makes the automatic run idempotent.
    uniqueIndex('template_runs_one_full_run_idx')
      .on(table.retainerCycleId)
      .where(
        sql`${table.trigger} in ('manual', 'cycle_opened') and ${table.retainerCycleId} is not null`,
      ),
    // A `task` template's run (F06B rule D2) is manual and has neither a project nor a cycle.
    check(
      'template_runs_target_check',
      sql`((${table.projectId} is null) <> (${table.retainerCycleId} is null)
          or (${table.trigger} = 'manual' and ${table.projectId} is null))
        and (${table.cycleLineId} is not null) = (${table.trigger} = 'missing_tasks')
        and (${table.trigger} <> 'cycle_opened' or ${table.retainerCycleId} is not null)
        and (${table.trigger} <> 'missing_tasks' or ${table.retainerCycleId} is not null)`,
    ),
  ],
);

/** The tasks a run created; `step_id` is no foreign key, the step may be edited away later. */
export const templateRunTasks = pgTable(
  'template_run_tasks',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => templateRuns.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    stepId: uuid('step_id').notNull(),
    /** Repeated steps: the instance number (1…n). */
    instance: integer('instance'),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.taskId] }),
    index('template_run_tasks_task_id_idx').on(table.taskId),
  ],
);
