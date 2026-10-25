import {
  IMAGE_MAX_BYTES,
  IMAGE_SOURCES,
  IMAGE_STATUSES,
  IMAGE_SUBJECT_TYPES,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { clients } from './clients.js';
import { id, timestamps } from './columns.js';
import { fileVersions } from './files.js';
import { projects } from './projects.js';
import { retainers } from './retainers.js';

/*
 * Profile images (F01C, ADR 0040), owned by the api `files` module. The square and its
 * renditions live on disk under FILES_ROOT; a replaced or removed image is archived.
 */

export const imageSubjectTypeEnum = pgEnum('image_subject_type', IMAGE_SUBJECT_TYPES);

export const imageSourceEnum = pgEnum('image_source', IMAGE_SOURCES);

export const imageStatusEnum = pgEnum('image_status', IMAGE_STATUSES);

export const images = pgTable(
  'images',
  {
    id: id(),
    subjectType: imageSubjectTypeEnum('subject_type').notNull(),
    userId: uuid('user_id').references((): AnyPgColumn => users.id),
    clientId: uuid('client_id').references((): AnyPgColumn => clients.id),
    projectId: uuid('project_id').references((): AnyPgColumn => projects.id),
    retainerId: uuid('retainer_id').references((): AnyPgColumn => retainers.id),
    source: imageSourceEnum('source').notNull(),
    /** Rule 6: the logo brand file version the crop was cut from. */
    sourceVersionId: uuid('source_version_id').references(() => fileVersions.id),
    /** The square as uploaded; the renditions are `<key>.sm.webp` and `<key>.md.webp`. */
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    status: imageStatusEnum('status').notNull().default('pending'),
    attempts: smallint('attempts').notNull().default(0),
    createdById: uuid('created_by_id')
      .notNull()
      .references((): AnyPgColumn => users.id),
    ...timestamps(),
    /** Set when the image is replaced or removed. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedById: uuid('archived_by_id').references((): AnyPgColumn => users.id),
  },
  (table) => [
    index('images_user_id_idx').on(table.userId),
    index('images_client_id_idx').on(table.clientId),
    index('images_project_id_idx').on(table.projectId),
    index('images_retainer_id_idx').on(table.retainerId),
    index('images_source_version_id_idx').on(table.sourceVersionId),
    index('images_created_by_id_idx').on(table.createdById),
    index('images_archived_by_id_idx').on(table.archivedById),
    /** One current image per subject. */
    uniqueIndex('images_user_current_unique')
      .on(table.userId)
      .where(sql`${table.archivedAt} is null`),
    uniqueIndex('images_client_current_unique')
      .on(table.clientId)
      .where(sql`${table.archivedAt} is null`),
    uniqueIndex('images_project_current_unique')
      .on(table.projectId)
      .where(sql`${table.archivedAt} is null`),
    uniqueIndex('images_retainer_current_unique')
      .on(table.retainerId)
      .where(sql`${table.archivedAt} is null`),
    /** The `files.preview` job's queue (rule 10). */
    index('images_pending_idx').on(table.createdAt).where(sql`${table.status} = 'pending'`),
    check(
      'images_subject_check',
      sql`num_nonnulls(${table.userId}, ${table.clientId}, ${table.projectId}, ${table.retainerId}) = 1 and (
        (${table.subjectType} = 'user' and ${table.userId} is not null)
        or (${table.subjectType} = 'client' and ${table.clientId} is not null)
        or (${table.subjectType} = 'project' and ${table.projectId} is not null)
        or (${table.subjectType} = 'retainer' and ${table.retainerId} is not null))`,
    ),
    check(
      'images_source_check',
      sql`(${table.source} = 'upload' and ${table.sourceVersionId} is null)
        or (${table.source} = 'brand_file' and ${table.subjectType} = 'client' and ${table.sourceVersionId} is not null)`,
    ),
    check(
      'images_size_check',
      sql`${table.sizeBytes} between 1 and ${sql.raw(String(IMAGE_MAX_BYTES))}`,
    ),
    check(
      'images_mime_type_check',
      sql`${table.mimeType} in ('image/png', 'image/jpeg', 'image/webp')`,
    ),
    check(
      'images_archived_check',
      sql`(${table.archivedAt} is null) = (${table.archivedById} is null)`,
    ),
  ],
);
