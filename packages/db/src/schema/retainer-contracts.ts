import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { archivedAt, id, timestamps } from './columns.js';

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
