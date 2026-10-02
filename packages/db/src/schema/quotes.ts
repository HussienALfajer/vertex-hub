import {
  DISCOUNT_APPROVALS,
  QUOTE_PDF_STATES,
  QUOTE_REJECTION_REASONS,
  QUOTE_SECTIONS,
  QUOTE_STATUSES,
} from '@vertex-hub/contracts';
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
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { departmentCodeEnum, users } from './auth.js';
import { catalogPackages, catalogServices } from './catalog.js';
import { clientContacts, clients } from './clients.js';
import { archivedAt, id, minorAmount, timestamps } from './columns.js';
import { fileItems } from './files.js';
import { currencyEnum, projects } from './projects.js';
import { deliverableKindEnum, retainers } from './retainers.js';
import { workTemplates } from './templates.js';

/*
 * Quotes (F04), owned by the api `quotes` module. One `quotes` row per version; its lines, items
 * and installments are replaced while it is a draft and frozen once it is sent. Amounts are
 * integer minor units in the quote's currency (ADR 0006).
 */

export const quoteStatusEnum = pgEnum('quote_status', QUOTE_STATUSES);

export const discountApprovalEnum = pgEnum('discount_approval', DISCOUNT_APPROVALS);

export const quoteSectionEnum = pgEnum('quote_section', QUOTE_SECTIONS);

export const quotePdfStatusEnum = pgEnum('quote_pdf_status', QUOTE_PDF_STATES);

export const quoteRejectionReasonEnum = pgEnum('quote_rejection_reason', QUOTE_REJECTION_REASONS);

/** The single row of quote settings, seeded by its migration. */
export const quoteSettings = pgTable(
  'quote_settings',
  {
    /** Always true: the table holds one row. */
    singleton: boolean('singleton').primaryKey().default(true),
    companyDetails: text('company_details').notNull().default(''),
    defaultTerms: text('default_terms').notNull().default(''),
    defaultValidityDays: integer('default_validity_days').notNull().default(14),
    discountThresholdPercent: integer('discount_threshold_percent').notNull().default(10),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedById: uuid('updated_by_id').references(() => users.id),
  },
  (table) => [
    index('quote_settings_updated_by_id_idx').on(table.updatedById),
    check('quote_settings_singleton_check', sql`${table.singleton}`),
    check('quote_settings_validity_check', sql`${table.defaultValidityDays} between 1 and 90`),
    check(
      'quote_settings_threshold_check',
      sql`${table.discountThresholdPercent} between 1 and 100`,
    ),
  ],
);

/** The last quote number of each year (rule 2); locked by the transaction creating version 1. */
export const quoteNumbers = pgTable('quote_numbers', {
  year: integer('year').primaryKey(),
  lastNumber: integer('last_number').notNull(),
});

export const quotes = pgTable(
  'quotes',
  {
    id: id(),
    year: integer('year').notNull(),
    number: integer('number').notNull(),
    version: integer('version').notNull().default(1),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    /** The addressee. */
    contactId: uuid('contact_id').references(() => clientContacts.id),
    title: text('title').notNull(),
    currency: currencyEnum('currency').notNull().default('USD'),
    status: quoteStatusEnum('status').notNull().default('draft'),
    discountApproval: discountApprovalEnum('discount_approval').notNull().default('none'),
    /** Who asked for the pending or last decided approval; told the decision. */
    discountRequestedById: uuid('discount_requested_by_id').references(() => users.id),
    discountDecidedById: uuid('discount_decided_by_id').references(() => users.id),
    discountDecidedAt: timestamp('discount_decided_at', { withTimezone: true }),
    discountNote: text('discount_note'),
    oneOffDiscountMinor: minorAmount('one_off_discount_minor').notNull().default(0),
    monthlyDiscountMinor: minorAmount('monthly_discount_minor').notNull().default(0),
    monthlyTermMonths: integer('monthly_term_months'),
    validityDays: integer('validity_days').notNull(),
    /** Set when sent: the sent day + `validity_days`; replaced on extend. */
    validUntil: date('valid_until', { mode: 'string' }),
    clientNotes: text('client_notes'),
    terms: text('terms'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    sentById: uuid('sent_by_id').references(() => users.id),
    respondedOn: date('responded_on', { mode: 'string' }),
    responseContactId: uuid('response_contact_id').references(() => clientContacts.id),
    responseNote: text('response_note'),
    respondedById: uuid('responded_by_id').references(() => users.id),
    rejectionReason: quoteRejectionReasonEnum('rejection_reason'),
    /** Set by A01: the project created and the retainer created or renewed. */
    projectId: uuid('project_id').references(() => projects.id),
    retainerId: uuid('retainer_id').references(() => retainers.id),
    /** The frozen render payload of a sent version (`quoteSnapshotSchema`, rule 12). */
    snapshot: jsonb('snapshot'),
    /** The PDF of a sent version (rule 12); null for drafts. */
    pdfStatus: quotePdfStatusEnum('pdf_status'),
    /** The document of the quote that holds the sent version's PDF, once attached. */
    pdfFileItemId: uuid('pdf_file_item_id').references((): AnyPgColumn => fileItems.id),
    /** The last draft preview (rule 13): asked for with this payload hash, then rendered. */
    draftPdfStatus: quotePdfStatusEnum('draft_pdf_status'),
    draftPdfRequestedHash: text('draft_pdf_requested_hash'),
    draftPdfObjectKey: text('draft_pdf_object_key'),
    draftPdfAt: timestamp('draft_pdf_at', { withTimezone: true }),
    draftPdfHash: text('draft_pdf_hash'),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    /** A discarded draft. */
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('quotes_number_idx').on(table.year, table.number, table.version),
    index('quotes_client_id_idx').on(table.clientId),
    index('quotes_status_idx').on(table.status),
    index('quotes_updated_at_idx').on(table.updatedAt),
    index('quotes_contact_id_idx').on(table.contactId),
    index('quotes_discount_requested_by_id_idx').on(table.discountRequestedById),
    index('quotes_discount_decided_by_id_idx').on(table.discountDecidedById),
    index('quotes_sent_by_id_idx').on(table.sentById),
    index('quotes_response_contact_id_idx').on(table.responseContactId),
    index('quotes_responded_by_id_idx').on(table.respondedById),
    index('quotes_created_by_id_idx').on(table.createdById),
    index('quotes_pdf_file_item_id_idx').on(table.pdfFileItemId),
    index('quotes_project_id_idx').on(table.projectId),
    index('quotes_retainer_id_idx').on(table.retainerId),
    check('quotes_title_check', sql`char_length(${table.title}) between 1 and 120`),
    check('quotes_version_check', sql`${table.version} >= 1`),
    check(
      'quotes_discounts_check',
      sql`${table.oneOffDiscountMinor} >= 0 and ${table.monthlyDiscountMinor} >= 0`,
    ),
    check('quotes_term_check', sql`${table.monthlyTermMonths} between 1 and 36`),
    check('quotes_validity_check', sql`${table.validityDays} between 1 and 90`),
  ],
);

/** A line of a quote version, from a service or a package of the catalog. */
export const quoteLines = pgTable(
  'quote_lines',
  {
    id: id(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id),
    section: quoteSectionEnum('section').notNull(),
    serviceId: uuid('service_id').references(() => catalogServices.id),
    packageId: uuid('package_id').references(() => catalogPackages.id),
    name: text('name').notNull(),
    description: text('description'),
    /** Service lines: the performing department. */
    department: departmentCodeEnum('department'),
    /** Always 1 on package lines. */
    quantity: integer('quantity').notNull(),
    unitPriceMinor: minorAmount('unit_price_minor').notNull(),
    /** The catalog price in the quote's currency; null when the catalog has none. */
    listUnitPriceMinor: minorAmount('list_unit_price_minor'),
    /** Service lines only. */
    revisionRounds: integer('revision_rounds'),
    deliverableKind: deliverableKindEnum('deliverable_kind'),
    deliverableLabel: text('deliverable_label'),
    templateId: uuid('template_id').references(() => workTemplates.id),
    position: integer('position').notNull(),
  },
  (table) => [
    index('quote_lines_quote_id_idx').on(table.quoteId, table.position),
    index('quote_lines_service_id_idx').on(table.serviceId),
    index('quote_lines_package_id_idx').on(table.packageId),
    index('quote_lines_template_id_idx').on(table.templateId),
    check(
      'quote_lines_item_check',
      sql`(${table.serviceId} is null) <> (${table.packageId} is null)`,
    ),
    check('quote_lines_quantity_check', sql`${table.quantity} between 1 and 999`),
    check('quote_lines_price_check', sql`${table.unitPriceMinor} >= 0`),
    check('quote_lines_list_price_check', sql`${table.listUnitPriceMinor} >= 0`),
    check('quote_lines_revision_rounds_check', sql`${table.revisionRounds} between 0 and 20`),
  ],
);

/** A service inside a package line, copied from the package when the line was added. */
export const quoteLineItems = pgTable(
  'quote_line_items',
  {
    id: id(),
    lineId: uuid('line_id')
      .notNull()
      .references(() => quoteLines.id),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => catalogServices.id),
    name: text('name').notNull(),
    department: departmentCodeEnum('department').notNull(),
    quantity: integer('quantity').notNull(),
    revisionRounds: integer('revision_rounds').notNull(),
    deliverableKind: deliverableKindEnum('deliverable_kind'),
    deliverableLabel: text('deliverable_label'),
    /** One-off items: the service's project template. */
    templateId: uuid('template_id').references(() => workTemplates.id),
    position: integer('position').notNull(),
  },
  (table) => [
    index('quote_line_items_line_id_idx').on(table.lineId, table.position),
    index('quote_line_items_service_id_idx').on(table.serviceId),
    index('quote_line_items_template_id_idx').on(table.templateId),
    check('quote_line_items_quantity_check', sql`${table.quantity} between 1 and 999`),
    check('quote_line_items_revision_rounds_check', sql`${table.revisionRounds} between 0 and 20`),
  ],
);

/** An installment of the one-off section (rule 5). */
export const quoteInstallments = pgTable(
  'quote_installments',
  {
    id: id(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id),
    name: text('name').notNull(),
    percent: integer('percent').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    index('quote_installments_quote_id_idx').on(table.quoteId, table.position),
    check('quote_installments_percent_check', sql`${table.percent} between 1 and 100`),
  ],
);
