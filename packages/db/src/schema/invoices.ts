import {
  INVOICE_ORIGINS,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  QUOTE_PDF_STATES,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
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
import { catalogServices } from './catalog.js';
import { clients } from './clients.js';
import { archivedAt, id, minorAmount, timestamps } from './columns.js';
import { fileItems } from './files.js';
import { currencyEnum, projectMilestones, projects } from './projects.js';
import { quotes } from './quotes.js';
import { extraWorkItems, retainerCycles, retainers } from './retainers.js';

/*
 * Invoices (F13, ADR 0024), owned by the api `invoices` module. Amounts are integer minor units
 * in the invoice's currency; exchange rates are SYP per 1 USD (ADR 0006).
 */

export const invoiceStatusEnum = pgEnum('invoice_status', INVOICE_STATUSES);

export const invoiceOriginEnum = pgEnum('invoice_origin', INVOICE_ORIGINS);

export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);

export const documentNumberKindEnum = pgEnum('document_number_kind', [
  'invoice',
  'receipt',
  'ad_deposit',
]);

/** The state of a rendered PDF (rules 15, 20 and 29), as a quote's (F04 rule 12). */
export const pdfStatusEnum = pgEnum('pdf_status', QUOTE_PDF_STATES);

/** An exchange rate column: SYP per 1 USD, read and written as a decimal string. */
export const exchangeRate = (name: string) => numeric(name, { precision: 12, scale: 4 });

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
    /** The PDF of the issued invoice (rule 15); null for drafts. */
    pdfStatus: pdfStatusEnum('pdf_status'),
    /** The document of the invoice that holds its PDF, once attached; a due date change adds a version. */
    pdfFileItemId: uuid('pdf_file_item_id').references((): AnyPgColumn => fileItems.id),
    /** The last draft preview, kept outside file items until the draft is issued or discarded. */
    draftPdfStatus: pdfStatusEnum('draft_pdf_status'),
    draftPdfRequestedHash: text('draft_pdf_requested_hash'),
    draftPdfObjectKey: text('draft_pdf_object_key'),
    draftPdfAt: timestamp('draft_pdf_at', { withTimezone: true }),
    draftPdfHash: text('draft_pdf_hash'),
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
    index('invoices_issued_on_idx').on(table.issuedOn),
    index('invoices_updated_at_idx').on(table.updatedAt),
    index('invoices_pdf_file_item_id_idx').on(table.pdfFileItemId),
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
    /** The catalog service billed, for revenue by service (F15); never printed. */
    serviceId: uuid('service_id').references(() => catalogServices.id),
    position: integer('position').notNull(),
  },
  (table) => [
    index('invoice_lines_invoice_id_idx').on(table.invoiceId, table.position),
    index('invoice_lines_milestone_id_idx').on(table.milestoneId),
    index('invoice_lines_retainer_cycle_id_idx').on(table.retainerCycleId),
    index('invoice_lines_extra_work_item_id_idx').on(table.extraWorkItemId),
    index('invoice_lines_service_id_idx').on(table.serviceId),
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

/**
 * A payment on an issued invoice (rules 16–22), with its receipt number. Voided by mistake,
 * never archived or edited.
 */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    /** The receipt number, assigned when recorded and kept by a void payment. */
    year: integer('year').notNull(),
    number: integer('number').notNull(),
    paidOn: date('paid_on', { mode: 'string' }).notNull(),
    /** In the payment's own currency. */
    amountMinor: minorAmount('amount_minor').notNull(),
    currency: currencyEnum('currency').notNull(),
    sypPerUsd: exchangeRate('syp_per_usd').notNull(),
    /** The amount in the invoice's currency (rule 19). */
    appliedMinor: minorAmount('applied_minor').notNull(),
    method: paymentMethodEnum('method').notNull(),
    reference: text('reference'),
    note: text('note'),
    /** The proof, a document of the invoice. */
    proofFileItemId: uuid('proof_file_item_id').references((): AnyPgColumn => fileItems.id),
    /** The frozen render payload of the receipt (`receiptSnapshotSchema`, rule 20). */
    receiptSnapshot: jsonb('receipt_snapshot'),
    /** Null for payments recorded before receipts were rendered. */
    receiptPdfStatus: pdfStatusEnum('receipt_pdf_status'),
    /** The receipt, a document of the invoice; archived with a void payment (rule 22). */
    receiptFileItemId: uuid('receipt_file_item_id').references((): AnyPgColumn => fileItems.id),
    recordedById: uuid('recorded_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedById: uuid('voided_by_id').references(() => users.id),
    voidReason: text('void_reason'),
  },
  (table) => [
    uniqueIndex('payments_number_idx').on(table.year, table.number),
    index('payments_invoice_id_idx').on(table.invoiceId),
    index('payments_paid_on_idx').on(table.paidOn),
    index('payments_proof_file_item_id_idx').on(table.proofFileItemId),
    index('payments_receipt_file_item_id_idx').on(table.receiptFileItemId),
    index('payments_recorded_by_id_idx').on(table.recordedById),
    index('payments_voided_by_id_idx').on(table.voidedById),
    check('payments_amounts_check', sql`${table.amountMinor} > 0 and ${table.appliedMinor} > 0`),
    check('payments_rate_check', sql`${table.sypPerUsd} > 0`),
    check('payments_reference_check', sql`char_length(${table.reference}) <= 200`),
    check('payments_note_check', sql`char_length(${table.note}) <= 500`),
    check(
      'payments_void_check',
      sql`(${table.voidedAt} is null) = (${table.voidReason} is null) and char_length(${table.voidReason}) <= 500`,
    ),
  ],
);

/**
 * A direct cost of a project (rule 26), in its own currency and at its own rate, for the project
 * margin (rule 27). Archived when entered by mistake.
 */
export const projectExpenses = pgTable(
  'project_expenses',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    spentOn: date('spent_on', { mode: 'string' }).notNull(),
    description: text('description').notNull(),
    /** In the expense's own currency, which may differ from the project's (ADR 0006). */
    amountMinor: minorAmount('amount_minor').notNull(),
    currency: currencyEnum('currency').notNull(),
    sypPerUsd: exchangeRate('syp_per_usd').notNull(),
    note: text('note'),
    loggedById: uuid('logged_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('project_expenses_project_id_idx').on(table.projectId),
    index('project_expenses_logged_by_id_idx').on(table.loggedById),
    check('project_expenses_amount_check', sql`${table.amountMinor} > 0`),
    check('project_expenses_rate_check', sql`${table.sypPerUsd} > 0`),
    check(
      'project_expenses_description_check',
      sql`char_length(${table.description}) between 1 and 200`,
    ),
    check('project_expenses_note_check', sql`char_length(${table.note}) <= 500`),
  ],
);

/**
 * A statement PDF rendered on request (rule 29): not a document, downloadable for 24 hours, then
 * deleted with its object by `files.purge-uploads`. One row per payload hash.
 */
export const statementPdfs = pgTable(
  'statement_pdfs',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    /** The render payload's hash: the same statement, the same PDF. */
    hash: text('hash').notNull(),
    status: pdfStatusEnum('status').notNull(),
    storageKey: text('storage_key'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    /** Asked for (or asked for again); the 24 hours count from here. */
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('statement_pdfs_hash_idx').on(table.hash),
    index('statement_pdfs_client_id_idx').on(table.clientId),
    index('statement_pdfs_requested_at_idx').on(table.requestedAt),
  ],
);
