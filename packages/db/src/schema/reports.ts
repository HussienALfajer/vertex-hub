import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { clients } from './clients.js';
import { id, timestamps } from './columns.js';
import { pdfStatusEnum } from './invoices.js';
import { retainerCycles } from './retainers.js';

/*
 * Dashboards and reports (F15, ADR 0027), owned by the api `reports` module: the monthly client
 * report summaries and their temporary PDFs, and the retainer cycle reports (F05C). Every figure
 * is computed on read.
 */

/**
 * The account manager's summary of a client's month (rule 19): one row per client and month,
 * replaced on save (last write wins) and audited; an empty text clears it.
 */
export const clientReportNotes = pgTable(
  'client_report_notes',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    /** The first day of the month. */
    month: date('month', { mode: 'string' }).notNull(),
    summary: text('summary').notNull(),
    updatedById: uuid('updated_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('client_report_notes_client_month_idx').on(table.clientId, table.month),
    index('client_report_notes_updated_by_id_idx').on(table.updatedById),
    check('client_report_notes_month_check', sql`extract(day from ${table.month}) = 1`),
    check('client_report_notes_summary_check', sql`char_length(${table.summary}) <= 4000`),
  ],
);

/**
 * A monthly client report PDF rendered on request (rule 20), as F13 statement PDFs: not a
 * document, downloadable for 24 hours, then deleted with its object by `files.purge-uploads`.
 * One row per payload hash.
 */
export const clientReportPdfs = pgTable(
  'client_report_pdfs',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    /** The first day of the month. */
    month: date('month', { mode: 'string' }).notNull(),
    /** The render payload's hash: the same report, the same PDF. */
    hash: text('hash').notNull(),
    status: pdfStatusEnum('status').notNull(),
    storageKey: text('storage_key'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    /** Asked for (or asked for again); the 24 hours count from here. */
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('client_report_pdfs_hash_idx').on(table.hash),
    index('client_report_pdfs_client_id_idx').on(table.clientId),
    index('client_report_pdfs_requested_at_idx').on(table.requestedAt),
  ],
);

/**
 * A retainer cycle's report (spec F05C R1–R3): one row per cycle, created when the cycle closes
 * (or when its summary is first saved), with the account manager's summary and the latest PDF.
 * Kept as long as the cycle; a new render replaces the object.
 */
export const retainerCycleReports = pgTable(
  'retainer_cycle_reports',
  {
    cycleId: uuid('cycle_id')
      .primaryKey()
      .references(() => retainerCycles.id),
    summary: text('summary').notNull().default(''),
    /** Null until a render is asked for. */
    pdfStatus: pdfStatusEnum('pdf_status'),
    storageKey: text('storage_key'),
    /** The payload hash of the latest render: the PDF is current while the report hashes the same. */
    hash: text('hash'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    renderedAt: timestamp('rendered_at', { withTimezone: true }),
    /** Null until someone saves the summary (the job creates the row). */
    updatedById: uuid('updated_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * When the summary was last saved: set by the summary save only, never by a render, since the
     * report shows it and its PDF is named by the report's hash.
     */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('retainer_cycle_reports_updated_by_id_idx').on(table.updatedById),
    check('retainer_cycle_reports_summary_check', sql`char_length(${table.summary}) <= 4000`),
  ],
);
