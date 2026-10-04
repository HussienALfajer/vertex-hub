import {
  AD_CAMPAIGN_STATUSES,
  AD_FUNDINGS,
  AD_OBJECTIVES,
  AD_PLATFORMS,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { clients } from './clients.js';
import { archivedAt, id, minorAmount, timestamps } from './columns.js';
import { projects } from './projects.js';
import { retainers } from './retainers.js';
import { tasks } from './tasks.js';

/*
 * Ad campaigns and their periodic updates (spec F12, ADR 0025), owned by the `campaigns` module.
 * Every amount is USD in minor units: ad platforms bill in USD (ADR 0006).
 */

export const adPlatformEnum = pgEnum('ad_platform', AD_PLATFORMS);

export const adObjectiveEnum = pgEnum('ad_objective', AD_OBJECTIVES);

export const adCampaignStatusEnum = pgEnum('ad_campaign_status', AD_CAMPAIGN_STATUSES);

export const adFundingEnum = pgEnum('ad_funding', AD_FUNDINGS);

export const adCampaigns = pgTable(
  'ad_campaigns',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    name: text('name').notNull(),
    platform: adPlatformEnum('platform').notNull(),
    objective: adObjectiveEnum('objective').notNull(),
    /** Fixed once the campaign has non-archived updates (rule 6). */
    funding: adFundingEnum('funding').notNull().default('wallet'),
    /** USD, the planned total for the whole campaign. */
    budgetMinor: minorAmount('budget_minor').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    /** Null for an open-ended campaign. */
    endsOn: date('ends_on', { mode: 'string' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    status: adCampaignStatusEnum('status').notNull().default('planned'),
    /** Optional links, for display and reports only (rule 3). */
    projectId: uuid('project_id').references(() => projects.id),
    retainerId: uuid('retainer_id').references(() => retainers.id),
    taskId: uuid('task_id').references(() => tasks.id),
    notes: text('notes').notNull().default(''),
    /** Set exactly while `cancelled`. */
    cancelReason: text('cancel_reason'),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
    archivedById: uuid('archived_by_id').references(() => users.id),
  },
  (table) => [
    index('ad_campaigns_client_id_status_idx').on(table.clientId, table.status),
    index('ad_campaigns_owner_id_status_idx').on(table.ownerId, table.status),
    index('ad_campaigns_project_id_idx').on(table.projectId),
    index('ad_campaigns_retainer_id_idx').on(table.retainerId),
    index('ad_campaigns_task_id_idx').on(table.taskId),
    index('ad_campaigns_created_by_id_idx').on(table.createdById),
    index('ad_campaigns_archived_by_id_idx').on(table.archivedById),
    check('ad_campaigns_name_check', sql`char_length(${table.name}) between 1 and 200`),
    check('ad_campaigns_budget_check', sql`${table.budgetMinor} > 0`),
    check(
      'ad_campaigns_dates_check',
      sql`${table.endsOn} is null or ${table.endsOn} >= ${table.startsOn}`,
    ),
    check(
      'ad_campaigns_engagement_check',
      sql`${table.projectId} is null or ${table.retainerId} is null`,
    ),
    check('ad_campaigns_notes_check', sql`char_length(${table.notes}) <= 2000`),
    check(
      'ad_campaigns_cancel_reason_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelReason} is not null) and char_length(${table.cancelReason}) <= 500`,
    ),
  ],
);

export const adCampaignUpdates = pgTable(
  'ad_campaign_updates',
  {
    id: id(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => adCampaigns.id),
    /** Within one calendar month; periods of a campaign's live updates never overlap (rules 9–10). */
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    /** USD. */
    spendMinor: minorAmount('spend_minor').notNull(),
    reach: integer('reach').notNull(),
    clicks: integer('clicks').notNull(),
    results: integer('results').notNull(),
    note: text('note').notNull().default(''),
    enteredById: uuid('entered_by_id')
      .notNull()
      .references(() => users.id),
    updatedById: uuid('updated_by_id').references(() => users.id),
    ...timestamps(),
    archivedAt: archivedAt(),
    archivedById: uuid('archived_by_id').references(() => users.id),
  },
  (table) => [
    index('ad_campaign_updates_campaign_id_period_start_idx').on(
      table.campaignId,
      table.periodStart,
    ),
    index('ad_campaign_updates_entered_by_id_idx').on(table.enteredById),
    index('ad_campaign_updates_updated_by_id_idx').on(table.updatedById),
    index('ad_campaign_updates_archived_by_id_idx').on(table.archivedById),
    check(
      'ad_campaign_updates_period_check',
      sql`${table.periodStart} <= ${table.periodEnd} and date_trunc('month', ${table.periodStart}) = date_trunc('month', ${table.periodEnd})`,
    ),
    check(
      'ad_campaign_updates_metrics_check',
      sql`${table.spendMinor} >= 0 and ${table.reach} >= 0 and ${table.clicks} >= 0 and ${table.results} >= 0`,
    ),
    check('ad_campaign_updates_note_check', sql`char_length(${table.note}) <= 500`),
  ],
);
