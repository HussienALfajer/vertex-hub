import { z } from 'zod';
import { calendarDateSchema } from './dates.js';
import { paymentMethodSchema } from './invoices.js';
import {
  pageQuerySchema,
  pageSchema,
  queryBooleanSchema,
  queryListSchema,
  sortOrderSchema,
} from './lists.js';
import {
  currencySchema,
  exchangeRateSchema,
  minorAmountSchema,
  signedMinorAmountSchema,
} from './money.js';
import { quotePdfStateSchema } from './quotes.js';
import { taskStatusSchema } from './tasks.js';
import { optionalText } from './text.js';

/*
 * Ad campaigns (spec F12, ADR 0025): a client's campaign on an ad platform with a planned USD
 * budget, periodic updates of spend and results entered by hand, and the client's USD ad-budget
 * wallet of deposits and refunds that wallet-funded spend is deducted from.
 */

export const AD_PLATFORMS = [
  'meta',
  'google',
  'tiktok',
  'snapchat',
  'linkedin',
  'x',
  'other',
] as const;

export const adPlatformSchema = z.enum(AD_PLATFORMS).meta({ id: 'AdPlatform' });

export type AdPlatform = z.infer<typeof adPlatformSchema>;

/** What a campaign optimizes for; it names what a "result" is. */
export const AD_OBJECTIVES = [
  'awareness',
  'traffic',
  'engagement',
  'messages',
  'leads',
  'sales',
  'video_views',
  'app_installs',
  'other',
] as const;

export const adObjectiveSchema = z.enum(AD_OBJECTIVES).meta({ id: 'AdObjective' });

export type AdObjective = z.infer<typeof adObjectiveSchema>;

export const AD_CAMPAIGN_STATUSES = [
  'planned',
  'active',
  'paused',
  'completed',
  'cancelled',
] as const;

export const adCampaignStatusSchema = z.enum(AD_CAMPAIGN_STATUSES).meta({ id: 'AdCampaignStatus' });

export type AdCampaignStatus = z.infer<typeof adCampaignStatusSchema>;

/** Running or about to run: the list's default. */
export const OPEN_AD_CAMPAIGN_STATUSES = [
  'planned',
  'active',
  'paused',
] as const satisfies readonly AdCampaignStatus[];

/** Who pays the platform: the client's wallet, or the client directly with their own card. */
export const AD_FUNDINGS = ['wallet', 'client_direct'] as const;

export const adFundingSchema = z.enum(AD_FUNDINGS).meta({ id: 'AdFunding' });

export type AdFunding = z.infer<typeof adFundingSchema>;

export const CAMPAIGN_LIMITS = {
  /** An `integer` column. */
  metric: 2_147_483_647,
  /** "No update for N days" after this many days (rule 14). */
  staleUpdateDays: 7,
  /** A new wallet's low-balance threshold: 100 USD. */
  lowBalanceThresholdMinor: 10_000,
  /** A11 repeats every this many days while the balance stays low (rule 21). */
  lowBalanceReminderDays: 7,
} as const;

/** The allowed status changes (spec F12, "Campaign status"). `cancelled` is final. */
export const AD_CAMPAIGN_TRANSITIONS: Readonly<
  Record<AdCampaignStatus, readonly AdCampaignStatus[]>
> = {
  planned: ['active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'completed', 'cancelled'],
  completed: ['active'],
  cancelled: [],
};

export function canChangeCampaignStatus(from: AdCampaignStatus, to: AdCampaignStatus): boolean {
  return AD_CAMPAIGN_TRANSITIONS[from].includes(to);
}

/** Updates are entered on running and completed campaigns (rule 9). */
export function acceptsUpdates(status: AdCampaignStatus): boolean {
  return status === 'active' || status === 'paused' || status === 'completed';
}

// Metrics (rules 11 and 14)

/** Σ spend ÷ Σ results in USD minor units, rounded half up; null without results (rule 11). */
export function costPerResult(spendMinor: number, results: number): number | null {
  if (results === 0) return null;
  return Number((2n * BigInt(spendMinor) + BigInt(results)) / (2n * BigInt(results)));
}

/** Σ spend ÷ budget as a whole percentage, rounded down so 100 means fully used (rule 11). */
export function budgetUsed(spendMinor: number, budgetMinor: number): number {
  return Number((100n * BigInt(spendMinor)) / BigInt(budgetMinor));
}

type Period = { periodStart: string; periodEnd: string };

/** Both ends inclusive (rule 10). */
export function periodsOverlap(a: Period, b: Period): boolean {
  return a.periodStart <= b.periodEnd && b.periodStart <= a.periodEnd;
}

/** Both ends in the same calendar month (rule 9). */
export function periodInOneMonth(period: Period): boolean {
  return period.periodStart.slice(0, 7) === period.periodEnd.slice(0, 7);
}

/**
 * Days since the last update's end, or since the start without updates, for an `active`
 * campaign once that reaches 7 days (rule 14); null otherwise.
 */
export function daysWithoutUpdate(campaign: {
  status: AdCampaignStatus;
  startsOn: string;
  lastUpdateEnd: string | null;
  today: string;
}): number | null {
  if (campaign.status !== 'active') return null;
  const since = campaign.lastUpdateEnd ?? campaign.startsOn;
  const days = Math.round((Date.parse(campaign.today) - Date.parse(since)) / 86_400_000);
  if (campaign.lastUpdateEnd === null) {
    return days >= CAMPAIGN_LIMITS.staleUpdateDays ? days : null;
  }
  return days > CAMPAIGN_LIMITS.staleUpdateDays ? days : null;
}

// Inputs

const budgetSchema = minorAmountSchema.min(1);

const campaignFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  platform: adPlatformSchema,
  objective: adObjectiveSchema,
  funding: adFundingSchema,
  /** USD, the planned total for the whole campaign. */
  budgetMinor: budgetSchema,
  startsOn: calendarDateSchema,
  /** Null for an open-ended campaign; ≥ `startsOn` (`INVALID_DATES`, rule 4). */
  endsOn: calendarDateSchema.nullable(),
  ownerId: z.uuid(),
  /** A project or a retainer of the client, not both (rule 3). */
  projectId: z.uuid().nullable(),
  retainerId: z.uuid().nullable(),
  /** A task of the client (rule 3). */
  taskId: z.uuid().nullable(),
  notes: z.string().trim().max(2000),
});

const oneEngagement = (value: { projectId?: string | null; retainerId?: string | null }) =>
  !(value.projectId && value.retainerId);

const engagementMessage = { message: 'A project or a retainer, not both', path: ['retainerId'] };

export const createCampaignSchema = campaignFieldsSchema
  .extend({
    clientId: z.uuid(),
    funding: adFundingSchema.default('wallet'),
    endsOn: calendarDateSchema.nullable().default(null),
    projectId: z.uuid().nullable().default(null),
    retainerId: z.uuid().nullable().default(null),
    taskId: z.uuid().nullable().default(null),
    notes: z.string().trim().max(2000).default(''),
  })
  .refine(oneEngagement, engagementMessage)
  .meta({ id: 'CreateCampaign' });

export type CreateCampaign = z.infer<typeof createCampaignSchema>;

export type CreateCampaignInput = z.input<typeof createCampaignSchema>;

/** The whole campaign, saved at once (rule 5). */
export const updateCampaignSchema = campaignFieldsSchema
  .extend({
    /** The `updatedAt` the form loaded; another save since then is `CONCURRENT_CHANGE`. */
    updatedAt: z.iso.datetime(),
  })
  .refine(oneEngagement, engagementMessage)
  .meta({ id: 'UpdateCampaign' });

export type UpdateCampaign = z.infer<typeof updateCampaignSchema>;

export type UpdateCampaignInput = z.input<typeof updateCampaignSchema>;

export const campaignStatusChangeSchema = z
  .object({
    to: z.enum(['active', 'paused', 'completed', 'cancelled']),
    /** Required when cancelling (`NOTE_REQUIRED`). */
    reason: z.string().trim().max(500).optional(),
  })
  .meta({ id: 'CampaignStatusChange' });

export type CampaignStatusChange = z.infer<typeof campaignStatusChangeSchema>;

const metricSchema = z.number().int().min(0).max(CAMPAIGN_LIMITS.metric);

/**
 * A period of spend and results. The API checks `periodStart` ≤ `periodEnd` ≤ today
 * (`INVALID_DATES`), one calendar month (`PERIOD_CROSSES_MONTH`) and no overlap with the
 * campaign's other updates (`PERIOD_OVERLAP`).
 */
export const campaignUpdateInputSchema = z
  .object({
    periodStart: calendarDateSchema,
    periodEnd: calendarDateSchema,
    /** USD. */
    spendMinor: minorAmountSchema,
    reach: metricSchema,
    clicks: metricSchema,
    results: metricSchema,
    note: z.string().trim().max(500).default(''),
  })
  .meta({ id: 'CampaignUpdateInput' });

export type CampaignUpdateInput = z.infer<typeof campaignUpdateInputSchema>;

export type CampaignUpdateFormInput = z.input<typeof campaignUpdateInputSchema>;

export const patchCampaignUpdateSchema = campaignUpdateInputSchema
  .extend({ note: z.string().trim().max(500) })
  .partial()
  .meta({ id: 'PatchCampaignUpdate' });

export type PatchCampaignUpdate = z.infer<typeof patchCampaignUpdateSchema>;

// Responses

const personSchema = z.object({ id: z.uuid(), name: z.string() });

const ownerSchema = personSchema.extend({ archived: z.boolean() });

/** Spend, reach, clicks and results with the computed cost per result. */
const metricsSchema = z.object({
  spendMinor: minorAmountSchema,
  reach: z.number().int().min(0),
  clicks: z.number().int().min(0),
  results: z.number().int().min(0),
  costPerResultMinor: minorAmountSchema.nullable(),
});

export const campaignSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    client: personSchema,
    platform: adPlatformSchema,
    objective: adObjectiveSchema,
    funding: adFundingSchema,
    status: adCampaignStatusSchema,
    startsOn: calendarDateSchema,
    endsOn: calendarDateSchema.nullable(),
    owner: ownerSchema,
    budgetMinor: minorAmountSchema,
    spendMinor: minorAmountSchema,
    /** Whole percentage of the budget spent; may exceed 100. */
    budgetUsed: z.number().int().min(0),
    results: z.number().int().min(0),
    costPerResultMinor: minorAmountSchema.nullable(),
    lastUpdateEnd: calendarDateSchema.nullable(),
    /** "No update for N days" (rule 14); null when not shown. */
    daysWithoutUpdate: z.number().int().min(1).nullable(),
    /** An `active` campaign past its end date (rule 4). */
    endPassed: z.boolean(),
    updatedAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Campaign' });

export type Campaign = z.infer<typeof campaignSchema>;

export const campaignUpdateSchema = metricsSchema
  .extend({
    id: z.uuid(),
    periodStart: calendarDateSchema,
    periodEnd: calendarDateSchema,
    note: z.string(),
    enteredBy: personSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'CampaignUpdate' });

export type CampaignUpdate = z.infer<typeof campaignUpdateSchema>;

export const campaignMonthSchema = metricsSchema
  .extend({ month: z.string().regex(/^\d{4}-\d{2}$/) })
  .meta({ id: 'CampaignMonth' });

export type CampaignMonth = z.infer<typeof campaignMonthSchema>;

export const campaignPermissionsSchema = z
  .object({
    /** Edit the fields: a campaign manager, not cancelled nor archived (rule 5). */
    canEdit: z.boolean(),
    /** `funding` too: no non-archived updates yet (rule 6). */
    canChangeFunding: z.boolean(),
    /** The status changes the caller may make now. */
    transitions: z.array(adCampaignStatusSchema),
    /** Add an update: an active, paused or completed campaign (rule 9). */
    canAddUpdate: z.boolean(),
    /** Edit and archive updates: any non-archived campaign, so a spend mistake can be fixed. */
    canEditUpdates: z.boolean(),
    canArchive: z.boolean(),
    canRestore: z.boolean(),
  })
  .meta({ id: 'CampaignPermissions', description: 'What the caller may do, for the UI' });

export type CampaignPermissions = z.infer<typeof campaignPermissionsSchema>;

const linkSchema = personSchema.extend({ archived: z.boolean() });

export const campaignDetailSchema = campaignSchema
  .extend({
    /** The linked project or retainer, shown as archived when it was archived later (rule 3). */
    engagement: linkSchema.extend({ type: z.enum(['project', 'retainer']) }).nullable(),
    task: linkSchema.extend({ status: taskStatusSchema }).nullable(),
    notes: z.string(),
    cancelReason: z.string().nullable(),
    totals: metricsSchema.extend({ budgetUsed: z.number().int().min(0) }),
    /** Oldest month first. */
    months: z.array(campaignMonthSchema),
    /** Non-archived, newest period first. */
    updates: z.array(campaignUpdateSchema),
    /** The client's wallet balance for a `wallet` campaign (rule 8); null for direct ones. */
    walletBalanceMinor: signedMinorAmountSchema.nullable(),
    createdBy: personSchema,
    createdAt: z.iso.datetime(),
    permissions: campaignPermissionsSchema,
  })
  .meta({ id: 'CampaignDetail' });

export type CampaignDetail = z.infer<typeof campaignDetailSchema>;

export const CAMPAIGN_SORTS = ['updatedAt', 'startsOn', 'name'] as const;

export const campaignListQuerySchema = pageQuerySchema.extend({
  /** Matches the campaign's name or the client's trade name. */
  search: z.string().trim().min(1).max(100).optional(),
  status: queryListSchema(adCampaignStatusSchema).default([...OPEN_AD_CAMPAIGN_STATUSES]),
  clientId: z.uuid().optional(),
  platform: adPlatformSchema.optional(),
  funding: adFundingSchema.optional(),
  ownerId: z.uuid().optional(),
  accountManagerId: z.uuid().optional(),
  /** Only the caller's campaigns (owner = me). */
  mine: queryBooleanSchema.optional(),
  sort: z.enum(CAMPAIGN_SORTS).default('updatedAt'),
  order: sortOrderSchema.default('desc'),
});

export type CampaignListQuery = z.infer<typeof campaignListQuerySchema>;

export const campaignPageSchema = pageSchema(campaignSchema).meta({ id: 'CampaignPage' });

export type CampaignPage = z.infer<typeof campaignPageSchema>;

// Wallet (rules 15–22)

export const AD_WALLET_ENTRY_KINDS = ['deposit', 'refund'] as const;

export const adWalletEntryKindSchema = z
  .enum(AD_WALLET_ENTRY_KINDS)
  .meta({ id: 'AdWalletEntryKind' });

export type AdWalletEntryKind = z.infer<typeof adWalletEntryKindSchema>;

/** `AD-2026-0001`, a deposit's receipt. */
export function adDepositDisplayNumber(entry: { year: number; number: number }) {
  return `AD-${entry.year}-${String(entry.number).padStart(4, '0')}`;
}

/** A deposit or refund as the balance sees it. */
export interface WalletEntryAmount {
  kind: AdWalletEntryKind;
  usdMinor: number;
  voided: boolean;
}

/** A campaign update as the balance sees it. */
export interface WalletSpend {
  spendMinor: number;
  archived: boolean;
  funding: AdFunding;
  campaignArchived: boolean;
}

/** Spend of non-archived updates of non-archived `wallet` campaigns comes out of the wallet. */
export function spendCountsInWallet(update: WalletSpend): boolean {
  return !update.archived && !update.campaignArchived && update.funding === 'wallet';
}

/**
 * Rule 15: non-void deposits − non-void refunds − counted spend, in USD minor units. May be
 * negative ("owed by the client").
 */
export function adWalletBalance(
  entries: readonly WalletEntryAmount[],
  updates: readonly WalletSpend[],
): number {
  let balance = 0;
  for (const entry of entries) {
    if (entry.voided) continue;
    balance += entry.kind === 'deposit' ? entry.usdMinor : -entry.usdMinor;
  }
  for (const update of updates) {
    if (spendCountsInWallet(update)) balance -= update.spendMinor;
  }
  return balance;
}

/**
 * Rule 20: below the threshold, for a client that uses the wallet (has a non-void deposit) and
 * has a threshold.
 */
export function isLowBalance(
  balanceMinor: number,
  thresholdMinor: number | null,
  usesWallet: boolean,
): boolean {
  return usesWallet && thresholdMinor !== null && balanceMinor < thresholdMinor;
}

/** A ledger item before the running balance; a spend item is never void. */
export interface WalletLedgerItem {
  kind: AdWalletEntryKind | 'spend';
  /** The entry or the update; ties on one date are ordered by id (UUIDv7: creation order). */
  id: string;
  date: string;
  usdMinor: number;
  voided: boolean;
}

/**
 * Rule 15's ledger: items by date with a running balance; void entries are listed and do not
 * count. Items before `from` make the opening balance; items after `to` are left out.
 */
export function walletLedger<Item extends WalletLedgerItem>(
  items: readonly Item[],
  range: { from?: string; to?: string } = {},
): { openingMinor: number; rows: (Item & { balanceMinor: number })[] } {
  const sorted = [...items].sort((a, b) =>
    a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1,
  );
  const change = (item: Item) =>
    item.voided ? 0 : item.kind === 'deposit' ? item.usdMinor : -item.usdMinor;
  let openingMinor = 0;
  let balance = 0;
  const rows: (Item & { balanceMinor: number })[] = [];
  for (const item of sorted) {
    if (range.to !== undefined && item.date > range.to) break;
    balance += change(item);
    if (range.from !== undefined && item.date < range.from) {
      openingMinor = balance;
      continue;
    }
    rows.push({ ...item, balanceMinor: balance });
  }
  return { openingMinor, rows };
}

const reasonSchema = z.string().trim().min(1).max(500);

/**
 * Rules 16 and 19. `occurredOn` ≤ today (`INVALID_DATES`); the rate defaults to the current one
 * (`RATE_REQUIRED` when none is set); a refund above the balance is `REFUND_EXCEEDS_BALANCE`. The
 * proof is the actor's upload, kept as a document of the entry.
 */
export const recordWalletEntrySchema = z
  .object({
    kind: adWalletEntryKindSchema,
    occurredOn: calendarDateSchema,
    amountMinor: minorAmountSchema.min(1),
    currency: currencySchema,
    sypPerUsd: exchangeRateSchema.nullable().default(null),
    method: paymentMethodSchema,
    /** Bank or wallet name and transaction number. */
    reference: optionalText(200).default(null),
    note: optionalText(500).default(null),
    proofUploadId: z.uuid().nullable().default(null),
  })
  .meta({ id: 'RecordWalletEntry' });

export type RecordWalletEntry = z.infer<typeof recordWalletEntrySchema>;

export type RecordWalletEntryInput = z.input<typeof recordWalletEntrySchema>;

/** Rule 18: an entry recorded by mistake. */
export const voidWalletEntrySchema = z
  .object({ reason: reasonSchema })
  .meta({ id: 'VoidWalletEntry' });

export type VoidWalletEntry = z.infer<typeof voidWalletEntrySchema>;

/** Null turns A11 off for the client. */
export const updateWalletThresholdSchema = z
  .object({ lowBalanceThresholdMinor: minorAmountSchema.nullable() })
  .meta({ id: 'UpdateWalletThreshold' });

export type UpdateWalletThreshold = z.infer<typeof updateWalletThresholdSchema>;

/** The ledger's period; everything by default. */
export const adWalletQuerySchema = z.object({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
});

export type AdWalletQuery = z.infer<typeof adWalletQuerySchema>;

/**
 * Rule 19: the frozen render payload of a deposit's receipt, taken when it is recorded. The
 * template prints the fixed line that the money is the client's ad budget, not an agency fee.
 */
export const adDepositReceiptSnapshotSchema = z.object({
  /** `AD-2026-0001`. */
  displayNumber: z.string(),
  companyDetails: z.string(),
  billingName: z.string(),
  receivedOn: calendarDateSchema,
  amountMinor: minorAmountSchema,
  currency: currencySchema,
  /** A deposit in SYP: its rate and its USD amount. */
  conversion: z.object({ sypPerUsd: exchangeRateSchema, usdMinor: minorAmountSchema }).nullable(),
  method: paymentMethodSchema,
  reference: z.string().nullable(),
  /** The wallet balance right after the deposit, in USD; negative when the client owes. */
  balanceAfterMinor: signedMinorAmountSchema,
});

export type AdDepositReceiptSnapshot = z.infer<typeof adDepositReceiptSnapshotSchema>;

export const walletEntrySchema = z
  .object({
    id: z.uuid(),
    kind: adWalletEntryKindSchema,
    /** `AD-2026-0001` for deposits, kept by a void one; null for refunds. */
    receiptNumber: z.string().nullable(),
    occurredOn: calendarDateSchema,
    amountMinor: minorAmountSchema,
    currency: currencySchema,
    sypPerUsd: exchangeRateSchema,
    usdMinor: minorAmountSchema,
    method: paymentMethodSchema,
    reference: z.string().nullable(),
    note: z.string().nullable(),
    /** The proof, a document of the entry. */
    proof: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    /**
     * A deposit's receipt PDF (rule 19), archived with a void deposit; null for refunds and for
     * deposits recorded before receipts were rendered.
     */
    receiptPdf: z.object({ state: quotePdfStateSchema }).nullable(),
    recordedBy: personSchema,
    createdAt: z.iso.datetime(),
    voided: z.object({ at: z.iso.datetime(), by: personSchema, reason: z.string() }).nullable(),
  })
  .meta({ id: 'WalletEntry' });

export type WalletEntry = z.infer<typeof walletEntrySchema>;

export const walletLedgerRowSchema = z
  .object({
    kind: z.enum([...AD_WALLET_ENTRY_KINDS, 'spend']),
    /** The entry, or the campaign update for `spend`. */
    id: z.uuid(),
    /** The entry's date, or the end of the update's period. */
    date: calendarDateSchema,
    usdMinor: minorAmountSchema,
    /** After this row; a void entry leaves it unchanged. */
    balanceMinor: signedMinorAmountSchema,
    voided: z.boolean(),
    /** Deposits and refunds. */
    entry: walletEntrySchema
      .pick({ receiptNumber: true, amountMinor: true, currency: true })
      .nullable(),
    /** Spend: the campaign and the update's period. */
    spend: z
      .object({
        campaign: personSchema,
        periodStart: calendarDateSchema,
        periodEnd: calendarDateSchema,
      })
      .nullable(),
  })
  .meta({ id: 'WalletLedgerRow' });

export type WalletLedgerRow = z.infer<typeof walletLedgerRowSchema>;

export const adWalletPermissionsSchema = z
  .object({
    /** Record refunds and void entries (`campaigns.fund`). */
    canFund: z.boolean(),
    /** Record deposits: `canFund` on a non-archived client (rule 16). */
    canDeposit: z.boolean(),
    /** A campaign manager covering the client. */
    canEditThreshold: z.boolean(),
  })
  .meta({ id: 'AdWalletPermissions', description: 'What the caller may do, for the UI' });

export type AdWalletPermissions = z.infer<typeof adWalletPermissionsSchema>;

/** Over every non-void entry and counted update, whatever the ledger's period. */
const walletTotalsSchema = z.object({
  depositedMinor: minorAmountSchema,
  refundedMinor: minorAmountSchema,
  spentMinor: minorAmountSchema,
  /** Rule 15; negative when the client owes. */
  balanceMinor: signedMinorAmountSchema,
  /** Null: A11 is off for the client. */
  lowBalanceThresholdMinor: minorAmountSchema.nullable(),
  /** Below the threshold for a client that uses the wallet (rule 20). */
  low: z.boolean(),
});

export const adWalletSchema = walletTotalsSchema
  .extend({
    client: personSchema.extend({ archived: z.boolean() }),
    /** Has a non-void deposit (rule 20). */
    usesWallet: z.boolean(),
    from: calendarDateSchema.nullable(),
    to: calendarDateSchema.nullable(),
    /** The balance before `from`. */
    openingMinor: signedMinorAmountSchema,
    /** Oldest first. */
    ledger: z.array(walletLedgerRowSchema),
    /** Every deposit and refund, newest first, void ones included. */
    entries: z.array(walletEntrySchema),
    permissions: adWalletPermissionsSchema,
  })
  .meta({ id: 'AdWallet' });

export type AdWallet = z.infer<typeof adWalletSchema>;

export const WALLET_SORTS = ['balance', 'client'] as const;

export const walletListQuerySchema = pageQuerySchema.extend({
  /** Matches the client's trade name. */
  search: z.string().trim().min(1).max(100).optional(),
  /** Only balances below their threshold. */
  low: queryBooleanSchema.optional(),
  accountManagerId: z.uuid().optional(),
  sort: z.enum(WALLET_SORTS).default('balance'),
  order: sortOrderSchema.default('asc'),
});

export type WalletListQuery = z.infer<typeof walletListQuerySchema>;

export const walletSummarySchema = walletTotalsSchema
  .extend({
    client: personSchema,
    accountManager: personSchema,
    lastDepositOn: calendarDateSchema.nullable(),
  })
  .meta({ id: 'WalletSummary' });

export type WalletSummary = z.infer<typeof walletSummarySchema>;

/** Clients that use the wallet or have a non-archived wallet campaign. */
export const walletPageSchema = pageSchema(walletSummarySchema).meta({ id: 'WalletPage' });

export type WalletPage = z.infer<typeof walletPageSchema>;
