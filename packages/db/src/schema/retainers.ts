import {
  CYCLE_STATUSES,
  DELIVERABLE_KINDS,
  EXTRA_WORK_BILLING,
  RETAINER_CHARGE_KINDS,
  RETAINER_CHARGE_STATUSES,
  RETAINER_STATUSES,
  TERM_END_ACTIONS,
  TERM_STATUSES,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
import { clientContacts, clients } from './clients.js';
import { archivedAt, id, minorAmount, timestamps } from './columns.js';
import { currencyEnum, projects } from './projects.js';

/*
 * Retainers, their monthly cycles, their terms and charges (F05B) and the extra work log of projects and retainers (F05), owned
 * by the api `projects` module. Dates without a time are calendar days in Asia/Damascus.
 */

export const retainerStatusEnum = pgEnum('retainer_status', RETAINER_STATUSES);

export const deliverableKindEnum = pgEnum('deliverable_kind', DELIVERABLE_KINDS);

export const cycleStatusEnum = pgEnum('cycle_status', CYCLE_STATUSES);

export const extraWorkBillingEnum = pgEnum('extra_work_billing', EXTRA_WORK_BILLING);

export const retainerChargeKindEnum = pgEnum('retainer_charge_kind', RETAINER_CHARGE_KINDS);

export const retainerChargeStatusEnum = pgEnum('retainer_charge_status', RETAINER_CHARGE_STATUSES);

export const termEndActionEnum = pgEnum('term_end_action', TERM_END_ACTIONS);

export const termStatusEnum = pgEnum('term_status', TERM_STATUSES);

export const retainers = pgTable(
  'retainers',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    name: text('name').notNull(),
    departments: departmentCodeEnum('departments').array().notNull(),
    status: retainerStatusEnum('status').notNull().default('active'),
    /** Editable only while the retainer has no cycle. */
    startDate: date('start_date', { mode: 'string' }).notNull(),
    /** A reminder only (R6). */
    renewalDate: date('renewal_date', { mode: 'string' }),
    endedOn: date('ended_on', { mode: 'string' }),
    /** The currency of the fee and of extra work estimates. */
    currency: currencyEnum('currency').notNull().default('USD'),
    monthlyFeeMinor: minorAmount('monthly_fee_minor'),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('retainers_client_name_idx')
      .on(table.clientId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
    index('retainers_client_id_idx').on(table.clientId),
    index('retainers_status_idx').on(table.status),
    index('retainers_departments_idx').using('gin', table.departments),
    check('retainers_renewal_date_check', sql`${table.renewalDate} > ${table.startDate}`),
    check('retainers_monthly_fee_check', sql`${table.monthlyFeeMinor} >= 0`),
  ],
);

/** The retainer's standing lines; each new cycle copies the non-archived ones (R4). */
export const retainerDeliverables = pgTable(
  'retainer_deliverables',
  {
    id: id(),
    retainerId: uuid('retainer_id')
      .notNull()
      .references(() => retainers.id),
    kind: deliverableKindEnum('kind').notNull(),
    label: text('label'),
    monthlyQuantity: integer('monthly_quantity').notNull(),
    /** The revision rounds of the line's generated tasks (F04); null: the template step's. */
    revisionLimit: integer('revision_limit'),
    position: integer('position').notNull(),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('retainer_deliverables_retainer_id_idx').on(table.retainerId, table.position),
    uniqueIndex('retainer_deliverables_kind_label_idx')
      .on(table.retainerId, table.kind, sql`lower(coalesce(${table.label}, ''))`)
      .where(sql`${table.archivedAt} is null`),
    check('retainer_deliverables_quantity_check', sql`${table.monthlyQuantity} between 1 and 999`),
    check(
      'retainer_deliverables_revision_limit_check',
      sql`${table.revisionLimit} between 0 and 20`,
    ),
    check(
      'retainer_deliverables_label_check',
      sql`${table.kind} <> 'other' or ${table.label} is not null`,
    ),
  ],
);

/** One calendar month of a retainer; never archived, it goes with its retainer. */
export const retainerCycles = pgTable(
  'retainer_cycles',
  {
    id: id(),
    retainerId: uuid('retainer_id')
      .notNull()
      .references(() => retainers.id),
    /** The first day of the calendar month. */
    month: date('month', { mode: 'string' }).notNull(),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    status: cycleStatusEnum('status').notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    // One cycle per retainer and month keeps the job and the API from creating two (edge case 2).
    uniqueIndex('retainer_cycles_retainer_month_idx').on(table.retainerId, table.month),
    index('retainer_cycles_status_idx').on(table.status),
    check('retainer_cycles_period_check', sql`${table.periodEnd} >= ${table.periodStart}`),
  ],
);

/** A cycle's lines, copied from the retainer so later edits never rewrite history. */
export const retainerCycleLines = pgTable(
  'retainer_cycle_lines',
  {
    id: id(),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => retainerCycles.id),
    /** Null for a line added to this cycle only. */
    deliverableId: uuid('deliverable_id').references(() => retainerDeliverables.id),
    kind: deliverableKindEnum('kind').notNull(),
    label: text('label'),
    committedQuantity: integer('committed_quantity').notNull(),
    /** Copied from the standing line (F04); null: the template step's. */
    revisionLimit: integer('revision_limit'),
    /** Frozen when the cycle closes (R8). */
    deliveredAtClose: integer('delivered_at_close'),
    position: integer('position').notNull(),
    ...timestamps(),
  },
  (table) => [
    index('retainer_cycle_lines_cycle_id_idx').on(table.cycleId, table.position),
    index('retainer_cycle_lines_deliverable_id_idx').on(table.deliverableId),
    uniqueIndex('retainer_cycle_lines_kind_label_idx').on(
      table.cycleId,
      table.kind,
      sql`lower(coalesce(${table.label}, ''))`,
    ),
    check('retainer_cycle_lines_quantity_check', sql`${table.committedQuantity} between 0 and 999`),
    check(
      'retainer_cycle_lines_revision_limit_check',
      sql`${table.revisionLimit} between 0 and 20`,
    ),
    check(
      'retainer_cycle_lines_delivered_check',
      sql`${table.deliveredAtClose} is null or ${table.deliveredAtClose} >= 0`,
    ),
  ],
);

/** Corrections of a line's delivered count; append-only (R7). */
export const retainerCycleAdjustments = pgTable(
  'retainer_cycle_adjustments',
  {
    id: id(),
    lineId: uuid('line_id')
      .notNull()
      .references(() => retainerCycleLines.id),
    delta: integer('delta').notNull(),
    reason: text('reason').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('retainer_cycle_adjustments_line_id_idx').on(table.lineId),
    index('retainer_cycle_adjustments_author_id_idx').on(table.authorId),
    check(
      'retainer_cycle_adjustments_delta_check',
      sql`${table.delta} <> 0 and ${table.delta} between -999 and 999`,
    ),
  ],
);

/**
 * A fixed agreement of a retainer (F05B T1–T12): months, the agreed total and an end action; its
 * schedule is its `monthly` charges. Never archived; it goes with its retainer. Terms of a
 * retainer never overlap (checked by the service under the retainer lock).
 */
export const retainerTerms = pgTable(
  'retainer_terms',
  {
    id: id(),
    retainerId: uuid('retainer_id')
      .notNull()
      .references(() => retainers.id),
    /** 1, 2, 3… per retainer. */
    number: integer('number').notNull(),
    /** The first day of its first month. */
    startMonth: date('start_month', { mode: 'string' }).notNull(),
    months: integer('months').notNull(),
    /** The first day of its last month, `start_month` + `months` − 1, set by the service. */
    endMonth: date('end_month', { mode: 'string' }).notNull(),
    /** Frozen when the term is created, editable while it is scheduled; a money field. */
    agreedTotalMinor: minorAmount('agreed_total_minor').notNull(),
    endAction: termEndActionEnum('end_action').notNull().default('renew'),
    status: termStatusEnum('status').notNull(),
    /** The term this one renews automatically (T7). */
    renewedFromId: uuid('renewed_from_id').references((): AnyPgColumn => retainerTerms.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('retainer_terms_retainer_number_idx').on(table.retainerId, table.number),
    // At most one active and one scheduled term per retainer.
    uniqueIndex('retainer_terms_active_idx')
      .on(table.retainerId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('retainer_terms_scheduled_idx')
      .on(table.retainerId)
      .where(sql`${table.status} = 'scheduled'`),
    index('retainer_terms_renewed_from_id_idx').on(table.renewedFromId),
    check('retainer_terms_months_check', sql`${table.months} between 1 and 36`),
    check('retainer_terms_agreed_total_check', sql`${table.agreedTotalMinor} >= 0`),
    check('retainer_terms_start_month_check', sql`extract(day from ${table.startMonth}) = 1`),
    check('retainer_terms_end_month_check', sql`${table.endMonth} >= ${table.startMonth}`),
  ],
);

/**
 * A billable amount of a retainer in its currency (F05B, ADR 0029): invoices bill charges. Never
 * archived or deleted; cancelled or settled through its status.
 */
export const retainerCharges = pgTable(
  'retainer_charges',
  {
    id: id(),
    retainerId: uuid('retainer_id')
      .notNull()
      .references(() => retainers.id),
    /** The first day of the calendar month the charge belongs to. */
    month: date('month', { mode: 'string' }).notNull(),
    kind: retainerChargeKindEnum('kind').notNull(),
    /** Negative for a credit. */
    amountMinor: minorAmount('amount_minor').notNull(),
    status: retainerChargeStatusEnum('status').notNull().default('pending'),
    /** A term month's `monthly` charge; null for open-ended months and other kinds. */
    termId: uuid('term_id').references(() => retainerTerms.id),
    /**
     * A term month's `monthly` charge only: the schedule amount plus onward amendments, without
     * one-month ones (what a renewal copies, T7); a money field.
     */
    baseAmountMinor: minorAmount('base_amount_minor'),
    /** Set once, when the charge became due and its due hooks ran (C3). */
    dueAt: timestamp('due_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index('retainer_charges_retainer_month_idx').on(table.retainerId, table.month),
    index('retainer_charges_status_idx').on(table.status),
    index('retainer_charges_term_id_idx').on(table.termId),
    // One live monthly charge per retainer and month keeps the job and the API from creating two.
    uniqueIndex('retainer_charges_monthly_idx')
      .on(table.retainerId, table.month)
      .where(sql`${table.kind} = 'monthly' and ${table.status} <> 'cancelled'`),
    check(
      'retainer_charges_amount_check',
      sql`case when ${table.kind} = 'credit' then ${table.amountMinor} < 0 else ${table.amountMinor} >= 0 end`,
    ),
    check('retainer_charges_month_check', sql`extract(day from ${table.month}) = 1`),
    check(
      'retainer_charges_term_check',
      sql`(${table.termId} is null and ${table.baseAmountMinor} is null) or (${table.kind} = 'monthly' and ${table.baseAmountMinor} >= 0)`,
    ),
  ],
);

/** Out-of-scope work on a project or a retainer, for separate billing (M3). */
export const extraWorkItems = pgTable(
  'extra_work_items',
  {
    id: id(),
    projectId: uuid('project_id').references(() => projects.id),
    retainerId: uuid('retainer_id').references(() => retainers.id),
    title: text('title').notNull(),
    description: text('description'),
    requestedOn: date('requested_on', { mode: 'string' }).notNull(),
    requestedByContactId: uuid('requested_by_contact_id').references(() => clientContacts.id),
    /** In the project's or retainer's currency; a money field. */
    estimateMinor: minorAmount('estimate_minor'),
    billingStatus: extraWorkBillingEnum('billing_status').notNull().default('unbilled'),
    billingNote: text('billing_note'),
    loggedById: uuid('logged_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('extra_work_items_project_id_idx').on(table.projectId),
    index('extra_work_items_retainer_id_idx').on(table.retainerId),
    index('extra_work_items_requested_by_contact_id_idx').on(table.requestedByContactId),
    index('extra_work_items_logged_by_id_idx').on(table.loggedById),
    check(
      'extra_work_items_owner_check',
      sql`(${table.projectId} is null) <> (${table.retainerId} is null)`,
    ),
    check('extra_work_items_estimate_check', sql`${table.estimateMinor} >= 0`),
  ],
);
