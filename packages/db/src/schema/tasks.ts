import {
  REQUEST_SCOPES,
  REVISION_DECISIONS,
  REVISION_SOURCES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { departmentCodeEnum, users } from './auth.js';
import { clientContacts, clients } from './clients.js';
import { archivedAt, id, timestamps } from './columns.js';
import { projectMilestones, projects } from './projects.js';
import { extraWorkItems, retainerCycleLines, retainerCycles } from './retainers.js';

/*
 * Tasks of every department (F06, ADR 0016), owned by the api `tasks` module. Dates without a
 * time are calendar days in Asia/Damascus, read and written as `YYYY-MM-DD`; `due_time` is a time
 * of day there.
 */

export const taskTypeEnum = pgEnum('task_type', TASK_TYPES);

export const taskStatusEnum = pgEnum('task_status', TASK_STATUSES);

export const taskPriorityEnum = pgEnum('task_priority', TASK_PRIORITIES);

export const requestScopeEnum = pgEnum('request_scope', REQUEST_SCOPES);

export const revisionSourceEnum = pgEnum('revision_source', REVISION_SOURCES);

export const revisionDecisionEnum = pgEnum('revision_decision', REVISION_DECISIONS);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    title: text('title').notNull(),
    brief: text('brief'),
    type: taskTypeEnum('type').notNull().default('work'),
    department: departmentCodeEnum('department').notNull(),
    /** Null while the task waits in its department's unassigned queue. */
    assigneeId: uuid('assignee_id').references(() => users.id),
    status: taskStatusEnum('status').notNull().default('new'),
    priority: taskPriorityEnum('priority').notNull().default('normal'),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    dueTime: time('due_time'),
    clientId: uuid('client_id').references(() => clients.id),
    projectId: uuid('project_id').references(() => projects.id),
    milestoneId: uuid('milestone_id').references(() => projectMilestones.id),
    retainerCycleId: uuid('retainer_cycle_id').references(() => retainerCycles.id),
    cycleLineId: uuid('cycle_line_id').references(() => retainerCycleLines.id),
    needsClientApproval: boolean('needs_client_approval').notNull(),
    revisionLimit: integer('revision_limit').notNull().default(2),
    requestedByContactId: uuid('requested_by_contact_id').references(() => clientContacts.id),
    requestedOn: date('requested_on', { mode: 'string' }),
    requestScope: requestScopeEnum('request_scope'),
    /** Set while an out-of-scope client request has its extra work item (rule 11). */
    extraWorkItemId: uuid('extra_work_item_id').references(() => extraWorkItems.id),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('tasks_department_idx').on(table.department),
    index('tasks_assignee_id_idx').on(table.assigneeId, table.status, table.dueDate),
    index('tasks_status_idx').on(table.status),
    index('tasks_due_date_idx').on(table.dueDate),
    index('tasks_client_id_idx').on(table.clientId),
    index('tasks_project_id_idx').on(table.projectId),
    index('tasks_milestone_id_idx').on(table.milestoneId),
    index('tasks_retainer_cycle_id_idx').on(table.retainerCycleId),
    index('tasks_cycle_line_id_idx').on(table.cycleLineId),
    index('tasks_requested_by_contact_id_idx').on(table.requestedByContactId),
    index('tasks_extra_work_item_id_idx').on(table.extraWorkItemId),
    index('tasks_created_by_id_idx').on(table.createdById),
    check(
      'tasks_engagement_check',
      sql`(${table.projectId} is null or ${table.retainerCycleId} is null)
        and ((${table.projectId} is null and ${table.retainerCycleId} is null) or ${table.clientId} is not null)
        and (${table.milestoneId} is null or ${table.projectId} is not null)
        and (${table.cycleLineId} is null or ${table.retainerCycleId} is not null)`,
    ),
    check(
      'tasks_client_approval_check',
      sql`${table.clientId} is not null or not ${table.needsClientApproval}`,
    ),
    check('tasks_revision_limit_check', sql`${table.revisionLimit} between 0 and 20`),
    check(
      'tasks_client_request_check',
      sql`case when ${table.type} = 'client_request'
        then ${table.clientId} is not null and ${table.requestedOn} is not null and ${table.requestScope} is not null
        else ${table.requestedOn} is null and ${table.requestScope} is null
          and ${table.requestedByContactId} is null and ${table.extraWorkItemId} is null end`,
    ),
    check(
      'tasks_cancel_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null and ${table.cancelReason} is not null)`,
    ),
  ],
);

/** A task waiting on another (rule 3); a link, removed by deleting the row. */
export const taskDependencies = pgTable(
  'task_dependencies',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    dependsOnId: uuid('depends_on_id')
      .notNull()
      .references(() => tasks.id),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.dependsOnId] }),
    index('task_dependencies_depends_on_id_idx').on(table.dependsOnId),
    index('task_dependencies_created_by_id_idx').on(table.createdById),
    check('task_dependencies_self_check', sql`${table.taskId} <> ${table.dependsOnId}`),
  ],
);

export const taskChecklistItems = pgTable(
  'task_checklist_items',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    text: text('text').notNull(),
    /** Order within the task, dense from 1 among non-archived items. */
    position: integer('position').notNull(),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneById: uuid('done_by_id').references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('task_checklist_items_task_id_idx').on(table.taskId, table.position),
    index('task_checklist_items_done_by_id_idx').on(table.doneById),
  ],
);

/** External links on a task: its attachments until F10. */
export const taskLinks = pgTable(
  'task_links',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    url: text('url').notNull(),
    label: text('label'),
    addedById: uuid('added_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('task_links_task_id_idx').on(table.taskId),
    index('task_links_added_by_id_idx').on(table.addedById),
  ],
);

/** Every return to `revisions` (rule 9); append-only, an over-limit decision is set once. */
export const taskRevisions = pgTable(
  'task_revisions',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    source: revisionSourceEnum('source').notNull(),
    /** Client revisions only: 1, 2, 3… per task. */
    number: integer('number'),
    note: text('note').notNull(),
    contactId: uuid('contact_id').references(() => clientContacts.id),
    overLimit: boolean('over_limit').notNull().default(false),
    decision: revisionDecisionEnum('decision'),
    decisionNote: text('decision_note'),
    extraWorkItemId: uuid('extra_work_item_id').references(() => extraWorkItems.id),
    decidedById: uuid('decided_by_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
  },
  (table) => [
    index('task_revisions_task_id_idx').on(table.taskId),
    index('task_revisions_contact_id_idx').on(table.contactId),
    index('task_revisions_extra_work_item_id_idx').on(table.extraWorkItemId),
    index('task_revisions_decided_by_id_idx').on(table.decidedById),
    index('task_revisions_author_id_idx').on(table.authorId),
    check(
      'task_revisions_source_check',
      sql`case when ${table.source} = 'client' then ${table.number} >= 1
        else ${table.number} is null and ${table.contactId} is null and not ${table.overLimit} end`,
    ),
    check(
      'task_revisions_decision_check',
      sql`(${table.decision} is null or ${table.overLimit})
        and (${table.decision} is null) = (${table.decidedAt} is null)
        and (${table.decision} <> 'free' or ${table.decisionNote} is not null)
        and ((${table.decision} = 'extra_work') = (${table.extraWorkItemId} is not null))`,
    ),
  ],
);
