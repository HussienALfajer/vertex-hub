import { CONTRACT_ANNEX_STATUSES, CONTRACT_KINDS, CONTRACT_STATUSES } from '@vertex-hub/contracts';
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
import { users } from './auth.js';
import { clientContacts } from './clients.js';
import { archivedAt, id, timestamps } from './columns.js';
import { fileItems } from './files.js';
import { pdfStatusEnum } from './invoices.js';
import { retainerAmendments, retainers, retainerTerms } from './retainers.js';

export const contractKindEnum = pgEnum('contract_kind', CONTRACT_KINDS);

export const contractStatusEnum = pgEnum('contract_status', CONTRACT_STATUSES);

export const contractAnnexStatusEnum = pgEnum('contract_annex_status', CONTRACT_ANNEX_STATUSES);

/** The single row of contract settings (F05C), seeded by its migration. */
export const contractSettings = pgTable(
  'contract_settings',
  {
    /** Always true: the table holds one row. */
    singleton: boolean('singleton').primaryKey().default(true),
    legalName: text('legal_name').notNull().default(''),
    tradeName: text('trade_name').notNull().default(''),
    companyType: text('company_type').notNull().default(''),
    registrationNumber: text('registration_number').notNull().default(''),
    address: text('address').notNull().default(''),
    phone: text('phone').notNull().default(''),
    email: text('email').notNull().default(''),
    website: text('website').notNull().default(''),
    representativeName: text('representative_name').notNull().default(''),
    representativeTitle: text('representative_title').notNull().default(''),
    slogan: text('slogan').notNull().default('نبدأ بفكرة، ونبني كياناً، ونصنع أثراً.'),
    numberPrefix: text('number_prefix').notNull().default('VM-CCS'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedById: uuid('updated_by_id').references(() => users.id),
  },
  (table) => [
    index('contract_settings_updated_by_id_idx').on(table.updatedById),
    check('contract_settings_singleton_check', sql`${table.singleton}`),
    check(
      'contract_settings_number_prefix_check',
      sql`${table.numberPrefix} ~ '^[A-Z0-9-]{2,20}$'`,
    ),
  ],
);

/** The default articles copied into each new contract draft (F05C); archived = removed. */
export const contractArticleTemplates = pgTable(
  'contract_article_templates',
  {
    id: id(),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('contract_article_templates_position_idx')
      .on(table.position)
      .where(sql`${table.archivedAt} is null`),
  ],
);

/**
 * A retainer contract (F05C K1–K9): one per term, or one per open-ended retainer from its
 * `start_cycle`. Drafts hold no number and are archived when discarded; issued contracts are
 * voided, never archived.
 */
export const retainerContracts = pgTable(
  'retainer_contracts',
  {
    id: id(),
    retainerId: uuid('retainer_id')
      .notNull()
      .references(() => retainers.id),
    kind: contractKindEnum('kind').notNull(),
    termId: uuid('term_id').references(() => retainerTerms.id),
    /** The first cycle it covers: the term's start cycle, or the open-ended retainer's. */
    startCycle: integer('start_cycle').notNull(),
    status: contractStatusEnum('status').notNull().default('draft'),
    /** `<prefix>-<year>-<nnn>`, set at issue (K4). */
    number: text('number'),
    contractDate: date('contract_date', { mode: 'string' }).notNull(),
    signatoryContactId: uuid('signatory_contact_id').references(() => clientContacts.id),
    /** The frozen render payload (`contractSnapshotSchema`), set at issue (K3). */
    snapshot: jsonb('snapshot'),
    /** The issued PDF (K4); null for drafts. */
    pdfStatus: pdfStatusEnum('pdf_status'),
    pdfFileItemId: uuid('pdf_file_item_id').references((): AnyPgColumn => fileItems.id),
    /** The last draft preview, kept outside file items until the draft is issued or discarded. */
    draftPdfStatus: pdfStatusEnum('draft_pdf_status'),
    draftPdfRequestedHash: text('draft_pdf_requested_hash'),
    draftPdfObjectKey: text('draft_pdf_object_key'),
    draftPdfAt: timestamp('draft_pdf_at', { withTimezone: true }),
    draftPdfHash: text('draft_pdf_hash'),
    /** K5: the signing date and the "signed copy" document. */
    signedOn: date('signed_on', { mode: 'string' }),
    signedFileItemId: uuid('signed_file_item_id').references((): AnyPgColumn => fileItems.id),
    voidReason: text('void_reason'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedById: uuid('voided_by_id').references(() => users.id),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    issuedById: uuid('issued_by_id').references(() => users.id),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    /** A discarded draft (K8). */
    archivedAt: archivedAt(),
  },
  (table) => [
    index('retainer_contracts_retainer_id_idx').on(table.retainerId),
    index('retainer_contracts_term_id_idx').on(table.termId),
    index('retainer_contracts_signatory_contact_id_idx').on(table.signatoryContactId),
    index('retainer_contracts_pdf_file_item_id_idx').on(table.pdfFileItemId),
    index('retainer_contracts_signed_file_item_id_idx').on(table.signedFileItemId),
    index('retainer_contracts_voided_by_id_idx').on(table.voidedById),
    index('retainer_contracts_issued_by_id_idx').on(table.issuedById),
    index('retainer_contracts_created_by_id_idx').on(table.createdById),
    uniqueIndex('retainer_contracts_number_idx').on(table.number),
    /** At most one live contract per term (K1, edge case 10). */
    uniqueIndex('retainer_contracts_term_unique')
      .on(table.termId)
      .where(sql`${table.status} <> 'void' and ${table.archivedAt} is null`),
    /** At most one live open-ended contract per retainer and start cycle. */
    uniqueIndex('retainer_contracts_open_ended_unique')
      .on(table.retainerId, table.startCycle)
      .where(
        sql`${table.kind} = 'open_ended' and ${table.status} <> 'void' and ${table.archivedAt} is null`,
      ),
    check(
      'retainer_contracts_term_check',
      sql`(${table.kind} = 'term') = (${table.termId} is not null)`,
    ),
    check('retainer_contracts_start_cycle_check', sql`${table.startCycle} >= 1`),
    check(
      'retainer_contracts_issued_check',
      sql`(${table.status} = 'draft') = (${table.number} is null) and (${table.status} = 'draft') = (${table.snapshot} is null)`,
    ),
    check(
      'retainer_contracts_archived_check',
      sql`${table.archivedAt} is null or ${table.status} = 'draft'`,
    ),
    check(
      'retainer_contracts_void_reason_check',
      sql`${table.voidReason} is null or char_length(${table.voidReason}) <= 500`,
    ),
  ],
);

/** A contract's own copy of the articles (K2), edited on the draft and frozen at issue. */
export const retainerContractArticles = pgTable(
  'retainer_contract_articles',
  {
    id: id(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => retainerContracts.id),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('retainer_contract_articles_contract_id_idx').on(table.contractId, table.position),
  ],
);

/** An annex of a contract for an applied amendment (K10), numbered per contract. */
export const retainerContractAnnexes = pgTable(
  'retainer_contract_annexes',
  {
    id: id(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => retainerContracts.id),
    amendmentId: uuid('amendment_id')
      .notNull()
      .references(() => retainerAmendments.id),
    annexNumber: integer('annex_number').notNull(),
    status: contractAnnexStatusEnum('status').notNull().default('issued'),
    annexDate: date('annex_date', { mode: 'string' }).notNull(),
    /** The frozen render payload (`annexSnapshotSchema`). */
    snapshot: jsonb('snapshot').notNull(),
    pdfStatus: pdfStatusEnum('pdf_status').notNull().default('pending'),
    pdfFileItemId: uuid('pdf_file_item_id').references((): AnyPgColumn => fileItems.id),
    signedOn: date('signed_on', { mode: 'string' }),
    signedFileItemId: uuid('signed_file_item_id').references((): AnyPgColumn => fileItems.id),
    voidReason: text('void_reason'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedById: uuid('voided_by_id').references(() => users.id),
    issuedById: uuid('issued_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('retainer_contract_annexes_contract_id_idx').on(table.contractId),
    index('retainer_contract_annexes_amendment_id_idx').on(table.amendmentId),
    index('retainer_contract_annexes_pdf_file_item_id_idx').on(table.pdfFileItemId),
    index('retainer_contract_annexes_signed_file_item_id_idx').on(table.signedFileItemId),
    index('retainer_contract_annexes_voided_by_id_idx').on(table.voidedById),
    index('retainer_contract_annexes_issued_by_id_idx').on(table.issuedById),
    uniqueIndex('retainer_contract_annexes_number_idx').on(table.contractId, table.annexNumber),
    /** One live annex per amendment. */
    uniqueIndex('retainer_contract_annexes_amendment_unique')
      .on(table.amendmentId)
      .where(sql`${table.status} <> 'void'`),
    check('retainer_contract_annexes_number_check', sql`${table.annexNumber} >= 1`),
    check(
      'retainer_contract_annexes_void_reason_check',
      sql`${table.voidReason} is null or char_length(${table.voidReason}) <= 500`,
    ),
  ],
);
