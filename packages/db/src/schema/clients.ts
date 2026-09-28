import {
  type BrandKit,
  CLIENT_PLATFORMS,
  CLIENT_STATUSES,
  NOTE_CHANNELS,
  PLATFORM_ACCESS_STATES,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { archivedAt, id, timestamps } from './columns.js';

/*
 * Clients and what the team knows about them (F02), owned by the api `clients` module.
 */

export const clientStatusEnum = pgEnum('client_status', CLIENT_STATUSES);

export const clientPlatformEnum = pgEnum('client_platform', CLIENT_PLATFORMS);

export const platformAccessEnum = pgEnum('platform_access', PLATFORM_ACCESS_STATES);

export const noteChannelEnum = pgEnum('note_channel', NOTE_CHANNELS);

const emptyBrandKit: BrandKit = {
  colors: [],
  fonts: [],
  toneOfVoice: null,
  forbiddenWords: [],
  files: [],
  references: [],
};

export const clients = pgTable(
  'clients',
  {
    id: id(),
    tradeName: text('trade_name').notNull(),
    sector: text('sector'),
    accountManagerId: uuid('account_manager_id')
      .notNull()
      .references(() => users.id),
    status: clientStatusEnum('status').notNull().default('active'),
    isHealthcare: boolean('is_healthcare').notNull().default(false),
    /** Shape `brandKitSchema`; validated on write. */
    brandKit: jsonb('brand_kit').$type<BrandKit>().notNull().default(emptyBrandKit),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('clients_trade_name_idx')
      .on(sql`lower(${table.tradeName})`)
      .where(sql`${table.archivedAt} is null`),
    index('clients_sector_idx').on(sql`lower(${table.sector})`),
    index('clients_account_manager_id_idx').on(table.accountManagerId),
    index('clients_status_idx').on(table.status),
  ],
);

export const clientContacts = pgTable(
  'client_contacts',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    name: text('name').notNull(),
    jobTitle: text('job_title'),
    /** `+` and 8–15 digits. */
    phone: text('phone'),
    email: text('email'),
    hasFinalApproval: boolean('has_final_approval').notNull().default(false),
    notes: text('notes'),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [index('client_contacts_client_id_idx').on(table.clientId)],
);

export const clientPlatformAccounts = pgTable(
  'client_platform_accounts',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    platform: clientPlatformEnum('platform').notNull(),
    label: text('label'),
    url: text('url').notNull(),
    agencyAccess: platformAccessEnum('agency_access').notNull().default('none'),
    adminNote: text('admin_note'),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [index('client_platform_accounts_client_id_idx').on(table.clientId)],
);

/** The communication log. */
export const clientNotes = pgTable(
  'client_notes',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    channel: noteChannelEnum('channel').notNull(),
    contactId: uuid('contact_id').references(() => clientContacts.id),
    summary: text('summary').notNull(),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('client_notes_client_id_idx').on(table.clientId, table.occurredAt),
    index('client_notes_author_id_idx').on(table.authorId),
    index('client_notes_contact_id_idx').on(table.contactId),
  ],
);
