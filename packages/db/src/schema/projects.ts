import { CURRENCIES, MILESTONE_STATUSES, PROJECT_STATUSES } from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { departmentCodeEnum, users } from './auth.js';
import { clients } from './clients.js';
import { archivedAt, id, minorAmount, timestamps } from './columns.js';

/*
 * Projects and retainers of clients (F05), owned by the api `projects` module. Dates without a
 * time are calendar days in Asia/Damascus, read and written as `YYYY-MM-DD`.
 */

export const currencyEnum = pgEnum('currency', CURRENCIES);

export const projectStatusEnum = pgEnum('project_status', PROJECT_STATUSES);

export const milestoneStatusEnum = pgEnum('milestone_status', MILESTONE_STATUSES);

export const projects = pgTable(
  'projects',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    name: text('name').notNull(),
    description: text('description'),
    projectManagerId: uuid('project_manager_id')
      .notNull()
      .references(() => users.id),
    departments: departmentCodeEnum('departments').array().notNull(),
    status: projectStatusEnum('status').notNull().default('planned'),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    /** The currency of every installment and extra work estimate on the project. */
    currency: currencyEnum('currency').notNull().default('USD'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('projects_client_name_idx')
      .on(table.clientId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
    index('projects_client_id_idx').on(table.clientId),
    index('projects_project_manager_id_idx').on(table.projectManagerId),
    index('projects_status_idx').on(table.status),
    index('projects_due_date_idx').on(table.dueDate),
    index('projects_departments_idx').using('gin', table.departments),
    check('projects_dates_check', sql`${table.dueDate} >= ${table.startDate}`),
  ],
);

export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    /** Order within the project, dense from 1 among non-archived milestones. */
    position: integer('position').notNull(),
    dueDate: date('due_date', { mode: 'string' }),
    status: milestoneStatusEnum('status').notNull().default('pending'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneById: uuid('done_by_id').references(() => users.id),
    /** In the project's currency; a money field. */
    installmentMinor: minorAmount('installment_minor'),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('project_milestones_project_id_idx').on(table.projectId, table.position),
    index('project_milestones_done_by_id_idx').on(table.doneById),
    check('project_milestones_installment_check', sql`${table.installmentMinor} >= 0`),
  ],
);
