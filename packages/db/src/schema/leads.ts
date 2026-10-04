import { LEAD_LOSS_REASONS, LEAD_SOURCES, LEAD_STAGES } from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { catalogPackages, catalogServices } from './catalog.js';
import { clients, noteChannelEnum } from './clients.js';
import { archivedAt, id, minorAmount, timestamps } from './columns.js';
import { currencyEnum } from './projects.js';

/*
 * Leads, their requested services and packages, and their activity log (spec F03, ADR 0026),
 * owned by the `leads` module.
 */

export const leadStageEnum = pgEnum('lead_stage', LEAD_STAGES);

export const leadSourceEnum = pgEnum('lead_source', LEAD_SOURCES);

export const leadLossReasonEnum = pgEnum('lead_loss_reason', LEAD_LOSS_REASONS);

export const leads = pgTable(
  'leads',
  {
    id: id(),
    contactName: text('contact_name').notNull(),
    /** The display name when set, else the contact name. */
    companyName: text('company_name'),
    phone: text('phone'),
    /** Lower-case. */
    email: text('email'),
    socialHandle: text('social_handle'),
    source: leadSourceEnum('source').notNull(),
    sourceDetail: text('source_detail'),
    request: text('request'),
    budgetMinor: minorAmount('budget_minor'),
    budgetCurrency: currencyEnum('budget_currency'),
    sector: text('sector'),
    isHealthcare: boolean('is_healthcare').notNull().default(false),
    stage: leadStageEnum('stage').notNull().default('new'),
    stageChangedAt: timestamp('stage_changed_at', { withTimezone: true }).notNull().defaultNow(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    /** Set exactly while the stage is open (rule 3). */
    nextFollowUpOn: date('next_follow_up_on', { mode: 'string' }),
    lostReason: leadLossReasonEnum('lost_reason'),
    lostNote: text('lost_note'),
    /** Set on win and loss, cleared on reopen. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** The created or linked client, set exactly while `won`. */
    clientId: uuid('client_id').references(() => clients.id),
    convertedById: uuid('converted_by_id').references(() => users.id),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('leads_stage_idx').on(table.stage),
    index('leads_owner_id_idx').on(table.ownerId, table.stage),
    index('leads_next_follow_up_on_idx').on(table.nextFollowUpOn),
    index('leads_closed_at_idx').on(table.closedAt),
    index('leads_client_id_idx').on(table.clientId),
    index('leads_phone_idx').on(table.phone),
    index('leads_email_idx').on(table.email),
    index('leads_converted_by_id_idx').on(table.convertedById),
    index('leads_created_by_id_idx').on(table.createdById),
    check('leads_contact_name_check', sql`char_length(${table.contactName}) between 1 and 120`),
    check(
      'leads_contact_method_check',
      sql`${table.phone} is not null or ${table.email} is not null or ${table.socialHandle} is not null`,
    ),
    check(
      'leads_budget_check',
      sql`(${table.budgetMinor} is null) = (${table.budgetCurrency} is null) and (${table.budgetMinor} is null or ${table.budgetMinor} > 0)`,
    ),
    check(
      'leads_follow_up_check',
      sql`(${table.stage} in ('won', 'lost')) = (${table.nextFollowUpOn} is null)`,
    ),
    check(
      'leads_lost_check',
      sql`(${table.stage} = 'lost') = (${table.lostReason} is not null) and (${table.lostNote} is null or ${table.stage} = 'lost')`,
    ),
    check(
      'leads_won_check',
      sql`(${table.stage} = 'won') = (${table.clientId} is not null) and (${table.stage} = 'won') = (${table.convertedById} is not null)`,
    ),
    check(
      'leads_closed_at_check',
      sql`(${table.stage} in ('won', 'lost')) = (${table.closedAt} is not null)`,
    ),
  ],
);

/** Requested services and packages; replaced as a whole when the lead is saved. */
export const leadInterests = pgTable(
  'lead_interests',
  {
    id: id(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id),
    serviceId: uuid('service_id').references(() => catalogServices.id),
    packageId: uuid('package_id').references(() => catalogPackages.id),
  },
  (table) => [
    index('lead_interests_lead_id_idx').on(table.leadId),
    index('lead_interests_service_id_idx').on(table.serviceId),
    index('lead_interests_package_id_idx').on(table.packageId),
    uniqueIndex('lead_interests_lead_service_idx')
      .on(table.leadId, table.serviceId)
      .where(sql`${table.serviceId} is not null`),
    uniqueIndex('lead_interests_lead_package_idx')
      .on(table.leadId, table.packageId)
      .where(sql`${table.packageId} is not null`),
    check(
      'lead_interests_item_check',
      sql`(${table.serviceId} is null) <> (${table.packageId} is null)`,
    ),
  ],
);

/** The activity log, shaped like `client_notes`; copied to the client on conversion. */
export const leadNotes = pgTable(
  'lead_notes',
  {
    id: id(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    channel: noteChannelEnum('channel').notNull(),
    summary: text('summary').notNull(),
    ...timestamps(),
    archivedAt: archivedAt(),
  },
  (table) => [
    index('lead_notes_lead_id_idx').on(table.leadId, table.occurredAt),
    index('lead_notes_author_id_idx').on(table.authorId),
    check('lead_notes_summary_check', sql`char_length(${table.summary}) between 1 and 2000`),
  ],
);
