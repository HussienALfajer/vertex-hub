import {
  AD_CAMPAIGN_STATUSES,
  AD_FUNDINGS,
  AD_OBJECTIVES,
  AD_PLATFORMS,
  AD_WALLET_ENTRY_KINDS,
  CAMPAIGN_LIMITS,
} from '@vertex-hub/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { clients } from './clients.js';
import { archivedAt, id, minorAmount, timestamps } from './columns.js';
import { fileItems } from './files.js';
import { exchangeRate, paymentMethodEnum } from './invoices.js';
import { currencyEnum, projects } from './projects.js';
import { retainers } from './retainers.js';
import { tasks } from './tasks.js';

/*
 * Ad campaigns, their periodic updates and the clients' ad-budget wallets (spec F12, ADR 0025),
 * owned by the `campaigns` module. Campaign and wallet amounts are USD in minor units: ad
 * platforms bill in USD (ADR 0006).
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

export const adWalletEntryKindEnum = pgEnum('ad_wallet_entry_kind', AD_WALLET_ENTRY_KINDS);

/**
 * A client's wallet settings, created on first use and locked by every balance change (rule 17).
 * The balance itself is computed on read (rule 15).
 */
export const adWallets = pgTable(
  'ad_wallets',
  {
    clientId: uuid('client_id')
      .primaryKey()
      .references(() => clients.id),
    /** USD; null turns A11 off for the client. */
    lowBalanceThresholdMinor: minorAmount('low_balance_threshold_minor').default(
      CAMPAIGN_LIMITS.lowBalanceThresholdMinor,
    ),
    /** Set when the balance fell below the threshold, cleared when it is back (rule 20). */
    lowSince: timestamp('low_since', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedById: uuid('updated_by_id').references(() => users.id),
  },
  (table) => [
    index('ad_wallets_updated_by_id_idx').on(table.updatedById),
    check('ad_wallets_threshold_check', sql`${table.lowBalanceThresholdMinor} >= 0`),
  ],
);

/**
 * A deposit or refund of a client's ad money (rules 16–19), in its own currency with its USD
 * amount. Voided by mistake, never archived or edited.
 */
export const adWalletEntries = pgTable(
  'ad_wallet_entries',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    kind: adWalletEntryKindEnum('kind').notNull(),
    /** The receipt number of a deposit, kept by a void one. */
    year: integer('year'),
    number: integer('number'),
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    /** In the entry's own currency. */
    amountMinor: minorAmount('amount_minor').notNull(),
    currency: currencyEnum('currency').notNull(),
    sypPerUsd: exchangeRate('syp_per_usd').notNull(),
    /** What the entry adds to or takes from the wallet, converted once (rule 15). */
    usdMinor: minorAmount('usd_minor').notNull(),
    method: paymentMethodEnum('method').notNull(),
    reference: text('reference'),
    note: text('note'),
    /** The proof, a document of the entry. */
    proofFileItemId: uuid('proof_file_item_id').references((): AnyPgColumn => fileItems.id),
    recordedById: uuid('recorded_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedById: uuid('voided_by_id').references(() => users.id),
    voidReason: text('void_reason'),
  },
  (table) => [
    uniqueIndex('ad_wallet_entries_number_idx').on(table.year, table.number),
    index('ad_wallet_entries_client_id_occurred_on_idx').on(table.clientId, table.occurredOn),
    index('ad_wallet_entries_proof_file_item_id_idx').on(table.proofFileItemId),
    index('ad_wallet_entries_recorded_by_id_idx').on(table.recordedById),
    index('ad_wallet_entries_voided_by_id_idx').on(table.voidedById),
    check(
      'ad_wallet_entries_number_check',
      sql`(${table.kind} = 'deposit') = (${table.year} is not null) and (${table.year} is null) = (${table.number} is null)`,
    ),
    check(
      'ad_wallet_entries_amounts_check',
      sql`${table.amountMinor} > 0 and ${table.usdMinor} > 0`,
    ),
    check('ad_wallet_entries_rate_check', sql`${table.sypPerUsd} > 0`),
    check('ad_wallet_entries_reference_check', sql`char_length(${table.reference}) <= 200`),
    check('ad_wallet_entries_note_check', sql`char_length(${table.note}) <= 500`),
    check(
      'ad_wallet_entries_void_check',
      sql`(${table.voidedAt} is null) = (${table.voidReason} is null) and (${table.voidedAt} is null) = (${table.voidedById} is null) and char_length(${table.voidReason}) <= 500`,
    ),
  ],
);
