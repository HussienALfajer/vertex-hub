import {
  BRAND_FILE_KINDS,
  FILE_FINAL_SOURCES,
  FILE_MAX_BYTES,
  FILE_OWNER_TYPES,
  FILE_PREVIEW_STATUSES,
  FILE_ROLES,
  FILE_VERSION_KINDS,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { announcements } from './announcements.js';
import { users } from './auth.js';
import { adWalletEntries } from './campaigns.js';
import { clients } from './clients.js';
import { archivedAt, id, timestamps } from './columns.js';
import { contentPosts } from './content.js';
import { hrRequests } from './hr.js';
import { invoices } from './invoices.js';
import { projects } from './projects.js';
import { quotes } from './quotes.js';
import { retainerContracts } from './retainer-contracts.js';
import { retainers } from './retainers.js';
import { taskComments, tasks } from './tasks.js';

/*
 * Files and versions (F10, ADR 0019), owned by the api `files` module. Content lives on disk
 * under FILES_ROOT; these tables hold the metadata and the storage keys.
 */

export const fileOwnerTypeEnum = pgEnum('file_owner_type', FILE_OWNER_TYPES);

export const fileRoleEnum = pgEnum('file_role', FILE_ROLES);

export const brandFileKindEnum = pgEnum('brand_file_kind', BRAND_FILE_KINDS);

export const fileVersionKindEnum = pgEnum('file_version_kind', FILE_VERSION_KINDS);

export const filePreviewStatusEnum = pgEnum('file_preview_status', FILE_PREVIEW_STATUSES);

export const fileFinalSourceEnum = pgEnum('file_final_source', FILE_FINAL_SOURCES);

export const fileItems = pgTable(
  'file_items',
  {
    id: id(),
    ownerType: fileOwnerTypeEnum('owner_type').notNull(),
    taskId: uuid('task_id').references(() => tasks.id),
    projectId: uuid('project_id').references(() => projects.id),
    retainerId: uuid('retainer_id').references(() => retainers.id),
    postId: uuid('post_id').references(() => contentPosts.id),
    quoteId: uuid('quote_id').references((): AnyPgColumn => quotes.id),
    invoiceId: uuid('invoice_id').references((): AnyPgColumn => invoices.id),
    adWalletEntryId: uuid('ad_wallet_entry_id').references((): AnyPgColumn => adWalletEntries.id),
    retainerContractId: uuid('retainer_contract_id').references(
      (): AnyPgColumn => retainerContracts.id,
    ),
    /** F16 part D: an announcement's attachment; no client. */
    announcementId: uuid('announcement_id').references((): AnyPgColumn => announcements.id),
    /** F17: an employee file's document, keyed by the employee's user; no client. */
    employeeId: uuid('employee_id').references(() => users.id),
    /** F17 rule B13: a leave request's document (the sick certificate); no client. */
    hrRequestId: uuid('hr_request_id').references((): AnyPgColumn => hrRequests.id),
    /** F06B rule B2: the comment, question or reply a task `attachment` belongs to. */
    taskCommentId: uuid('task_comment_id').references((): AnyPgColumn => taskComments.id),
    /** The owner's client; the owner itself for `client`; null for a task without a client. */
    clientId: uuid('client_id').references(() => clients.id),
    role: fileRoleEnum('role').notNull(),
    name: text('name').notNull(),
    brandKind: brandFileKindEnum('brand_kind'),
    confidential: boolean('confidential').notNull().default(false),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('file_items_task_id_idx').on(table.taskId),
    index('file_items_project_id_idx').on(table.projectId),
    index('file_items_retainer_id_idx').on(table.retainerId),
    index('file_items_post_id_idx').on(table.postId),
    index('file_items_quote_id_idx').on(table.quoteId),
    index('file_items_invoice_id_idx').on(table.invoiceId),
    index('file_items_ad_wallet_entry_id_idx').on(table.adWalletEntryId),
    index('file_items_retainer_contract_id_idx').on(table.retainerContractId),
    index('file_items_announcement_id_idx').on(table.announcementId),
    index('file_items_employee_id_idx').on(table.employeeId),
    index('file_items_hr_request_id_idx').on(table.hrRequestId),
    index('file_items_task_comment_id_idx').on(table.taskCommentId),
    index('file_items_client_id_idx').on(table.clientId, table.role),
    index('file_items_created_by_id_idx').on(table.createdById),
    /**
     * Names are unique per owner and role among live items, except references and the
     * attachments of a task's thread (F06B: two comments may attach `image.png`).
     */
    uniqueIndex('file_items_name_unique')
      .on(
        table.ownerType,
        table.role,
        sql`coalesce(${table.taskId}, ${table.projectId}, ${table.retainerId}, ${table.postId}, ${table.quoteId}, ${table.invoiceId}, ${table.adWalletEntryId}, ${table.retainerContractId}, ${table.announcementId}, ${table.employeeId}, ${table.hrRequestId}, ${table.clientId})`,
        sql`lower(${table.name})`,
      )
      .where(
        sql`${table.archivedAt} is null and ${table.role} <> 'reference' and ${table.taskCommentId} is null`,
      ),
    // `post`, `quote`, `invoice`, `ad_wallet_entry`, `retainer_contract`, `announcement` and
    // `employee`, `hr_request` (and the `attachment` role) are compared as text: their enum values
    // were added in the same migration as these checks (F08, F04, F13, F12, F05C, F16, F17).
    check(
      'file_items_owner_check',
      sql`num_nonnulls(${table.taskId}, ${table.projectId}, ${table.retainerId}, ${table.postId}, ${table.quoteId}, ${table.invoiceId}, ${table.adWalletEntryId}, ${table.retainerContractId}, ${table.announcementId}, ${table.employeeId}, ${table.hrRequestId}) <= 1 and (
        (${table.ownerType} = 'task' and ${table.taskId} is not null)
        or (${table.ownerType} = 'client' and ${table.clientId} is not null and num_nonnulls(${table.taskId}, ${table.projectId}, ${table.retainerId}, ${table.postId}, ${table.quoteId}, ${table.invoiceId}, ${table.adWalletEntryId}, ${table.retainerContractId}, ${table.announcementId}, ${table.employeeId}, ${table.hrRequestId}) = 0)
        or (${table.ownerType} = 'project' and ${table.projectId} is not null and ${table.clientId} is not null)
        or (${table.ownerType} = 'retainer' and ${table.retainerId} is not null and ${table.clientId} is not null)
        or (${table.ownerType}::text = 'post' and ${table.postId} is not null and ${table.clientId} is not null)
        or (${table.ownerType}::text = 'quote' and ${table.quoteId} is not null and ${table.clientId} is not null)
        or (${table.ownerType}::text = 'invoice' and ${table.invoiceId} is not null and ${table.clientId} is not null)
        or (${table.ownerType}::text = 'ad_wallet_entry' and ${table.adWalletEntryId} is not null and ${table.clientId} is not null)
        or (${table.ownerType}::text = 'retainer_contract' and ${table.retainerContractId} is not null and ${table.clientId} is not null)
        or (${table.ownerType}::text = 'announcement' and ${table.announcementId} is not null and ${table.clientId} is null)
        or (${table.ownerType}::text = 'employee' and ${table.employeeId} is not null and ${table.clientId} is null)
        or (${table.ownerType}::text = 'hr_request' and ${table.hrRequestId} is not null and ${table.clientId} is null))`,
    ),
    check(
      'file_items_role_check',
      sql`(${table.ownerType} = 'task' and ${table.role} in ('deliverable', 'reference', 'attachment'))
        or (${table.ownerType} = 'client' and ${table.role} in ('brand', 'document'))
        or (${table.ownerType} in ('project', 'retainer') and ${table.role} = 'document')
        or (${table.ownerType}::text = 'post' and ${table.role} = 'deliverable')
        or (${table.ownerType}::text = 'quote' and ${table.role} = 'document')
        or (${table.ownerType}::text in ('invoice', 'ad_wallet_entry', 'retainer_contract') and ${table.role} = 'document')
        or (${table.ownerType}::text = 'announcement' and ${table.role}::text = 'attachment')
        or (${table.ownerType}::text in ('employee', 'hr_request') and ${table.role} = 'document')`,
    ),
    // F06B rule B2: a task attachment belongs to a comment, and only it does.
    check(
      'file_items_task_comment_check',
      sql`(${table.taskCommentId} is not null) = (${table.ownerType} = 'task' and ${table.role} = 'attachment')`,
    ),
    check(
      'file_items_brand_kind_check',
      sql`(${table.role} = 'brand') = (${table.brandKind} is not null)`,
    ),
    check(
      'file_items_confidential_check',
      sql`not ${table.confidential} or ${table.role} = 'document'`,
    ),
    check('file_items_name_check', sql`char_length(${table.name}) between 1 and 120`),
  ],
);

export const fileVersions = pgTable(
  'file_versions',
  {
    id: id(),
    fileItemId: uuid('file_item_id')
      .notNull()
      .references(() => fileItems.id),
    number: integer('number').notNull(),
    kind: fileVersionKindEnum('kind').notNull(),
    storageKey: text('storage_key'),
    originalName: text('original_name'),
    mimeType: text('mime_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    sha256: text('sha256'),
    previewStatus: filePreviewStatusEnum('preview_status').notNull().default('none'),
    width: integer('width'),
    height: integer('height'),
    url: text('url'),
    linkLabel: text('link_label'),
    note: text('note'),
    uploadedById: uuid('uploaded_by_id')
      .notNull()
      .references(() => users.id),
    isFinal: boolean('is_final').notNull().default(false),
    finalSource: fileFinalSourceEnum('final_source'),
    finalMarkedById: uuid('final_marked_by_id').references(() => users.id),
    finalMarkedAt: timestamp('final_marked_at', { withTimezone: true }),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('file_versions_file_item_id_idx').on(table.fileItemId),
    index('file_versions_uploaded_by_id_idx').on(table.uploadedById),
    index('file_versions_final_marked_by_id_idx').on(table.finalMarkedById),
    uniqueIndex('file_versions_number_unique').on(table.fileItemId, table.number),
    /** At most one live final version per item (rule 10). */
    uniqueIndex('file_versions_final_unique')
      .on(table.fileItemId)
      .where(sql`${table.isFinal} and ${table.archivedAt} is null`),
    index('file_versions_final_marked_at_idx')
      .on(table.finalMarkedAt.desc())
      .where(sql`${table.isFinal}`),
    check('file_versions_number_check', sql`${table.number} >= 1`),
    check(
      'file_versions_kind_check',
      sql`(${table.kind} = 'upload' and ${table.storageKey} is not null and ${table.originalName} is not null and ${table.mimeType} is not null and ${table.sizeBytes} is not null and ${table.sha256} is not null and ${table.url} is null)
        or (${table.kind} = 'link' and ${table.url} is not null and ${table.storageKey} is null)`,
    ),
    check(
      'file_versions_size_check',
      sql`${table.sizeBytes} is null or ${table.sizeBytes} between 1 and ${sql.raw(String(FILE_MAX_BYTES))}`,
    ),
    check(
      'file_versions_final_check',
      sql`(${table.isFinal} and ${table.finalSource} is not null and ${table.finalMarkedAt} is not null)
        or (not ${table.isFinal} and ${table.finalSource} is null and ${table.finalMarkedAt} is null and ${table.finalMarkedById} is null)`,
    ),
  ],
);

/** Uploads waiting to be attached (rule 2); deleted on attach or purged after 24 hours. */
export const fileUploads = pgTable(
  'file_uploads',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    width: integer('width'),
    height: integer('height'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('file_uploads_user_id_idx').on(table.userId),
    index('file_uploads_created_at_idx').on(table.createdAt),
  ],
);
