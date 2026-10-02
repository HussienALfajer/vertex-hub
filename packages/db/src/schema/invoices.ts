import { INVOICE_ORIGINS, INVOICE_STATUSES } from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { clients } from './clients.js';
import { archivedAt, id, minorAmount, timestamps } from './columns.js';
import { currencyEnum, projectMilestones, projects } from './projects.js';
import { quotes } from './quotes.js';
import { extraWorkItems, retainerCycles, retainers } from './retainers.js';

/*
 * Invoices (F13, ADR 0024), owned by the api `invoices` module. Amounts are integer minor units
 * in the invoice's currency; exchange rates are SYP per 1 USD (ADR 0006).
 */

export const invoiceStatusEnum = pgEnum('invoice_status', INVOICE_STATUSES);

export const invoiceOriginEnum = pgEnum('invoice_origin', INVOICE_ORIGINS);

export const documentNumberKindEnum = pgEnum('document_number_kind', ['invoice', 'receipt']);

/** An exchange rate column: SYP per 1 USD, read and written as a decimal string. */
const exchangeRate = (name: string) => numeric(name, { precision: 12, scale: 4 });

/** The single row of invoice settings, seeded by its migration. */
export const invoiceSettings = pgTable(
  'invoice_settings',
  {
    /** Always true: the table holds one row. */
    singleton: boolean('singleton').primaryKey().default(true),
    /** The current rate offered on new documents; null until first set. */
    sypPerUsd: exchangeRate('syp_per_usd'),
    rateUpdatedAt: timestamp('rate_updated_at', { withTimezone: true }),
    rateUpdatedById: uuid('rate_updated_by_id').references(() => users.id),
    paymentTermsDays: integer('payment_terms_days').notNull().default(7),
    paymentDetails: text('payment_details').notNull().default(''),
    invoiceFooter: text('invoice_footer').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedById: uuid('updated_by_id').references(() => users.id),
  },
  (table) => [
    index('invoice_settings_rate_updated_by_id_idx').on(table.rateUpdatedById),
    index('invoice_settings_updated_by_id_idx').on(table.updatedById),
    check('invoice_settings_singleton_check', sql`${table.singleton}`),
    check('invoice_settings_rate_check', sql`${table.sypPerUsd} > 0`),
    check('invoice_settings_terms_check', sql`${table.paymentTermsDays} between 0 and 90`),
  ],
);

/** The last invoice and receipt number of each year; locked by the transaction taking one. */
export const documentNumbers = pgTable(
  'document_numbers',
  {
    kind: documentNumberKindEnum('kind').notNull(),
    year: integer('year').notNull(),
    lastNumber: integer('last_number').notNull(),
  },
  (table) => [primaryKey({ columns: [table.kind, table.year] })],
);

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    projectId: uuid('project_id').references(() => projects.id),
    retainerId: uuid('retainer_id').references(() => retainers.id),
    /** The accepted quote of an A01 draft. */
    quoteId: uuid('quote_id').references(() => quotes.id),
    origin: invoiceOriginEnum('origin').notNull(),
    /** Assigned on issue. */
    year: integer('year'),
    number: integer('number'),
    currency: currencyEnum('currency').notNull(),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    /** Drafts: proposes the due date on issue. */
    paymentTermsDays: integer('payment_terms_days').notNull(),
    issuedOn: date('issued_on', { mode: 'string' }),
    dueOn: date('due_on', { mode: 'string' }),
    /** The rate at issue (ADR 0006), also on USD invoices. */
    sypPerUsd: exchangeRate('syp_per_usd'),
    totalMinor: minorAmount('total_minor').notNull().default(0),
    /** Σ applied amounts of the invoice's non-void payments. */
    paidMinor: minorAmount('paid_minor').notNull().default(0),
    notes: text('notes'),
    /** The frozen render payload of an issued invoice (`invoiceSnapshotSchema`, rule 15). */
    snapshot: jsonb('snapshot'),
    issuedById: uuid('issued_by_id').references(() => users.id),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedById: uuid('voided_by_id').references(() => users.id),
    voidReason: text('void_reason'),
    /** Null for automatic drafts. */
    createdById: uuid('created_by_id').references(() => users.id),
    ...timestamps(),
    /** A discarded draft; issued invoices are voided, never archived. */
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('invoices_number_idx').on(table.year, table.number),
    index('invoices_client_id_idx').on(table.clientId),
    index('invoices_project_id_idx').on(table.projectId),
    index('invoices_retainer_id_idx').on(table.retainerId),
    index('invoices_quote_id_idx').on(table.quoteId),
    index('invoices_status_idx').on(table.status),
    index('invoices_due_on_idx').on(table.dueOn),
    index('invoices_updated_at_idx').on(table.updatedAt),
    index('invoices_issued_by_id_idx').on(table.issuedById),
    index('invoices_voided_by_id_idx').on(table.voidedById),
    index('invoices_created_by_id_idx').on(table.createdById),
    check(
      'invoices_engagement_check',
      sql`${table.projectId} is null or ${table.retainerId} is null`,
    ),
    check('invoices_number_check', sql`(${table.year} is null) = (${table.number} is null)`),
    check('invoices_terms_check', sql`${table.paymentTermsDays} between 0 and 90`),
    check('invoices_dates_check', sql`${table.dueOn} >= ${table.issuedOn}`),
    check('invoices_rate_check', sql`${table.sypPerUsd} > 0`),
    check(
      'invoices_amounts_check',
      sql`${table.totalMinor} >= 0 and ${table.paidMinor} between 0 and ${table.totalMinor}`,
    ),
  ],
);

/** A line of an invoice, optionally billing one source (rule 4). */
export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: id(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: minorAmount('unit_price_minor').notNull(),
    milestoneId: uuid('milestone_id').references(() => projectMilestones.id),
    retainerCycleId: uuid('retainer_cycle_id').references(() => retainerCycles.id),
    extraWorkItemId: uuid('extra_work_item_id').references(() => extraWorkItems.id),
    /** True while the invoice is neither void nor archived: the source is taken. */
    holdsSource: boolean('holds_source').notNull().default(true),
    position: integer('position').notNull(),
  },
  (table) => [
    index('invoice_lines_invoice_id_idx').on(table.invoiceId, table.position),
    index('invoice_lines_milestone_id_idx').on(table.milestoneId),
    index('invoice_lines_retainer_cycle_id_idx').on(table.retainerCycleId),
    index('invoice_lines_extra_work_item_id_idx').on(table.extraWorkItemId),
    uniqueIndex('invoice_lines_live_milestone_idx')
      .on(table.milestoneId)
      .where(sql`${table.holdsSource}`),
    uniqueIndex('invoice_lines_live_retainer_cycle_idx')
      .on(table.retainerCycleId)
      .where(sql`${table.holdsSource}`),
    uniqueIndex('invoice_lines_live_extra_work_item_idx')
      .on(table.extraWorkItemId)
      .where(sql`${table.holdsSource}`),
    check(
      'invoice_lines_source_check',
      sql`num_nonnulls(${table.milestoneId}, ${table.retainerCycleId}, ${table.extraWorkItemId}) <= 1`,
    ),
    check(
      'invoice_lines_description_check',
      sql`char_length(${table.description}) between 1 and 300`,
    ),
    check('invoice_lines_quantity_check', sql`${table.quantity} between 1 and 999`),
    check('invoice_lines_price_check', sql`${table.unitPriceMinor} >= 0`),
  ],
);
