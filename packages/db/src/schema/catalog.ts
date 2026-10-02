import { CATALOG_BILLINGS } from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { departmentCodeEnum } from './auth.js';
import { archivedAt, id, timestamps } from './columns.js';
import { deliverableKindEnum } from './retainers.js';
import { workTemplates } from './templates.js';

/*
 * Service catalog (F04, ADR 0023), owned by the api `catalog` module. Prices are integer minor
 * units in the currency their column names (ADR 0006); quotes copy them, so edits never change a
 * quote.
 */

export const catalogBillingEnum = pgEnum('catalog_billing', CATALOG_BILLINGS);

export const catalogServices = pgTable(
  'catalog_services',
  {
    id: id(),
    name: text('name').notNull(),
    description: text('description'),
    /** The performing department. */
    department: departmentCodeEnum('department').notNull(),
    billing: catalogBillingEnum('billing').notNull(),
    /** Per unit, or per unit per month for monthly services. */
    priceUsdMinor: bigint('price_usd_minor', { mode: 'number' }).notNull(),
    priceSypMinor: bigint('price_syp_minor', { mode: 'number' }),
    revisionRounds: integer('revision_rounds').notNull().default(2),
    /** Set = counted: the service becomes a retainer deliverable line (monthly only). */
    deliverableKind: deliverableKindEnum('deliverable_kind'),
    deliverableLabel: text('deliverable_label'),
    /** A project template for one-off services, a monthly one for monthly services. */
    templateId: uuid('template_id').references(() => workTemplates.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('catalog_services_name_idx')
      .on(sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
    index('catalog_services_template_id_idx').on(table.templateId),
    check('catalog_services_name_check', sql`char_length(${table.name}) between 1 and 120`),
    check('catalog_services_price_usd_check', sql`${table.priceUsdMinor} >= 0`),
    check('catalog_services_price_syp_check', sql`${table.priceSypMinor} >= 0`),
    check('catalog_services_revision_rounds_check', sql`${table.revisionRounds} between 0 and 20`),
    check(
      'catalog_services_counted_check',
      sql`${table.deliverableKind} is null or ${table.billing} = 'monthly'`,
    ),
  ],
);

export const catalogPackages = pgTable(
  'catalog_packages',
  {
    id: id(),
    name: text('name').notNull(),
    description: text('description'),
    billing: catalogBillingEnum('billing').notNull(),
    /** The package price; per month for monthly packages. */
    priceUsdMinor: bigint('price_usd_minor', { mode: 'number' }).notNull(),
    priceSypMinor: bigint('price_syp_minor', { mode: 'number' }),
    /** Monthly packages only: a monthly template. */
    templateId: uuid('template_id').references(() => workTemplates.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    uniqueIndex('catalog_packages_name_idx')
      .on(sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
    index('catalog_packages_template_id_idx').on(table.templateId),
    check('catalog_packages_name_check', sql`char_length(${table.name}) between 1 and 120`),
    check('catalog_packages_price_usd_check', sql`${table.priceUsdMinor} >= 0`),
    check('catalog_packages_price_syp_check', sql`${table.priceSypMinor} >= 0`),
    check(
      'catalog_packages_template_check',
      sql`${table.templateId} is null or ${table.billing} = 'monthly'`,
    ),
  ],
);

/** A service inside a package; the items are replaced as a whole when the package is saved. */
export const catalogPackageItems = pgTable(
  'catalog_package_items',
  {
    id: id(),
    packageId: uuid('package_id')
      .notNull()
      .references(() => catalogPackages.id),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => catalogServices.id),
    /** Per month for monthly packages. */
    quantity: integer('quantity').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    uniqueIndex('catalog_package_items_service_idx').on(table.packageId, table.serviceId),
    index('catalog_package_items_package_id_idx').on(table.packageId, table.position),
    index('catalog_package_items_service_id_idx').on(table.serviceId),
    check('catalog_package_items_quantity_check', sql`${table.quantity} between 1 and 999`),
  ],
);
