import {
  AMENDMENT_KINDS,
  AMENDMENT_SCOPES,
  AMENDMENT_STATUSES,
  CYCLE_STATUSES,
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
  jsonb,
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
import { deliverableKindEnum } from './deliverables.js';
import { currencyEnum, projects } from './projects.js';
import { quotes } from './quotes.js';
import { workTemplates } from './templates.js';

/*
 * Retainers, their monthly cycles, their terms and charges (F05B) and the extra work log of projects and retainers (F05), owned
 * by the api `projects` module. Dates without a time are calendar days in Asia/Damascus.
 */

export const retainerStatusEnum = pgEnum('retainer_status', RETAINER_STATUSES);

export const cycleStatusEnum = pgEnum('cycle_status', CYCLE_STATUSES);

export const extraWorkBillingEnum = pgEnum('extra_work_billing', EXTRA_WORK_BILLING);

export const retainerChargeKindEnum = pgEnum('retainer_charge_kind', RETAINER_CHARGE_KINDS);

export const retainerChargeStatusEnum = pgEnum('retainer_charge_status', RETAINER_CHARGE_STATUSES);

export const termEndActionEnum = pgEnum('term_end_action', TERM_END_ACTIONS);

export const termStatusEnum = pgEnum('term_status', TERM_STATUSES);

export const amendmentKindEnum = pgEnum('amendment_kind', AMENDMENT_KINDS);

export const amendmentScopeEnum = pgEnum('amendment_scope', AMENDMENT_SCOPES);

export const amendmentStatusEnum = pgEnum('amendment_status', AMENDMENT_STATUSES);

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
    /** The amendment that added or last changed the line in this cycle (F05B A2). */
    amendmentId: uuid('amendment_id').references((): AnyPgColumn => retainerAmendments.id),
    ...timestamps(),
  },
  (table) => [
    index('retainer_cycle_lines_cycle_id_idx').on(table.cycleId, table.position),
    index('retainer_cycle_lines_deliverable_id_idx').on(table.deliverableId),
    index('retainer_cycle_lines_amendment_id_idx').on(table.amendmentId),
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
    /** The accepted quote that created it (F04 Q1, Q2). */
    quoteId: uuid('quote_id').references((): AnyPgColumn => quotes.id),
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
    index('retainer_terms_quote_id_idx').on(table.quoteId),
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
    /** The amendment an `addition` or a `credit` comes from (C6). */
    amendmentId: uuid('amendment_id').references((): AnyPgColumn => retainerAmendments.id),
    /** Why a credit was settled outside the system; set with `settled_outside` (C9). */
    settleNote: text('settle_note'),
    /** A credit's remainder: the credit it was split from (C5). */
    splitFromId: uuid('split_from_id').references((): AnyPgColumn => retainerCharges.id),
    ...timestamps(),
  },
  (table) => [
    index('retainer_charges_retainer_month_idx').on(table.retainerId, table.month),
    index('retainer_charges_status_idx').on(table.status),
    index('retainer_charges_term_id_idx').on(table.termId),
    index('retainer_charges_amendment_id_idx').on(table.amendmentId),
    index('retainer_charges_split_from_id_idx').on(table.splitFromId),
    check(
      'retainer_charges_settle_note_check',
      sql`(${table.status} = 'settled_outside') = (${table.settleNote} is not null) and coalesce(char_length(${table.settleNote}), 0) <= 300`,
    ),
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

/**
 * A numbered change of a retainer's lines and amounts (F05B A1–A9): one month or onward, a
 * reschedule, or a quote renewal. Never archived or edited; a wrong one is corrected by another.
 */
export const retainerAmendments = pgTable(
  'retainer_amendments',
  {
    id: id(),
    retainerId: uuid('retainer_id')
      .notNull()
      .references(() => retainers.id),
    /** 1, 2, 3… per retainer. */
    number: integer('number').notNull(),
    kind: amendmentKindEnum('kind').notNull(),
    /** Required for `change`, `onward` for `quote_renewal`, null for `reschedule`. */
    scope: amendmentScopeEnum('scope'),
    /** The first day of the month it takes effect in. */
    effectiveMonth: date('effective_month', { mode: 'string' }).notNull(),
    /** `change`: the change to each affected month; a money field. */
    amountDeltaMinor: minorAmount('amount_delta_minor').notNull().default(0),
    /** `reschedule` only: `{ month, amountMinor }[]`, the new amounts; a money field. */
    schedule: jsonb('schedule').$type<{ month: string; amountMinor: number }[]>(),
    /** Σ of the change over the months it affects when created (A4); a money field. */
    moneyDeltaMinor: minorAmount('money_delta_minor').notNull().default(0),
    reason: text('reason').notNull(),
    status: amendmentStatusEnum('status').notNull(),
    /** Null for a system amendment (quote renewal). */
    createdById: uuid('created_by_id').references(() => users.id),
    decidedById: uuid('decided_by_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    /**
     * Per month what it did when applied (while pending or scheduled, its preview): the effect,
     * the invoice and the amounts before and after; money fields.
     */
    effects: jsonb('effects').$type<AmendmentEffectRow[]>().notNull().default([]),
    /** `quote_renewal` only: the accepted quote. */
    quoteId: uuid('quote_id').references((): AnyPgColumn => quotes.id),
    /**
     * `quote_renewal` only: the monthly fee (the open-ended rate) from its month, the quote's
     * monthly net; a money field.
     */
    feeMinor: minorAmount('fee_minor'),
    /** `quote_renewal` only: the monthly template the quote renewal links in its month. */
    templateId: uuid('template_id').references((): AnyPgColumn => workTemplates.id),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('retainer_amendments_retainer_number_idx').on(table.retainerId, table.number),
    index('retainer_amendments_status_idx').on(table.status),
    index('retainer_amendments_created_by_id_idx').on(table.createdById),
    index('retainer_amendments_decided_by_id_idx').on(table.decidedById),
    index('retainer_amendments_quote_id_idx').on(table.quoteId),
    index('retainer_amendments_template_id_idx').on(table.templateId),
    check(
      'retainer_amendments_effective_month_check',
      sql`extract(day from ${table.effectiveMonth}) = 1`,
    ),
    check(
      'retainer_amendments_scope_check',
      sql`case ${table.kind} when 'change' then ${table.scope} is not null when 'quote_renewal' then ${table.scope} = 'onward' else ${table.scope} is null end`,
    ),
    check(
      'retainer_amendments_quote_check',
      sql`(${table.kind} = 'quote_renewal') = (${table.quoteId} is not null and ${table.feeMinor} is not null) and coalesce(${table.feeMinor}, 0) >= 0`,
    ),
    check(
      'retainer_amendments_template_check',
      sql`${table.templateId} is null or ${table.kind} = 'quote_renewal'`,
    ),
    check('retainer_amendments_reason_check', sql`char_length(${table.reason}) between 1 and 500`),
    check('retainer_amendments_note_check', sql`char_length(${table.decisionNote}) <= 500`),
  ],
);

/** A month an amendment changed, as stored in `retainer_amendments.effects`. */
export interface AmendmentEffectRow {
  month: string;
  effect: string;
  invoice: { id: string; displayNumber: string | null } | null;
  beforeMinor: number;
  afterMinor: number;
}

/** The line changes of an amendment (A2): at most 20, one per kind and label. */
export const retainerAmendmentLines = pgTable(
  'retainer_amendment_lines',
  {
    id: id(),
    amendmentId: uuid('amendment_id')
      .notNull()
      .references(() => retainerAmendments.id),
    kind: deliverableKindEnum('kind').notNull(),
    label: text('label'),
    /** `change`: the change to the line, non-zero. */
    quantityDelta: integer('quantity_delta'),
    /** `quote_renewal`: the line's new monthly quantity. */
    quantity: integer('quantity'),
    /** For a new line (F04); null: the template step's. */
    revisionLimit: integer('revision_limit'),
    position: integer('position').notNull(),
    ...timestamps(),
  },
  (table) => [
    index('retainer_amendment_lines_amendment_id_idx').on(table.amendmentId, table.position),
    uniqueIndex('retainer_amendment_lines_kind_label_idx').on(
      table.amendmentId,
      table.kind,
      sql`lower(coalesce(${table.label}, ''))`,
    ),
    check(
      'retainer_amendment_lines_delta_check',
      sql`${table.quantityDelta} <> 0 and ${table.quantityDelta} between -999 and 999`,
    ),
    check('retainer_amendment_lines_quantity_check', sql`${table.quantity} between 0 and 999`),
    check(
      'retainer_amendment_lines_revision_limit_check',
      sql`${table.revisionLimit} between 0 and 20`,
    ),
    check(
      'retainer_amendment_lines_label_check',
      sql`${table.kind} <> 'other' or ${table.label} is not null`,
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
