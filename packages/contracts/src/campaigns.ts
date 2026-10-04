import { z } from 'zod';
import { calendarDateSchema } from './dates.js';
import {
  pageQuerySchema,
  pageSchema,
  queryBooleanSchema,
  queryListSchema,
  sortOrderSchema,
} from './lists.js';
import { minorAmountSchema } from './money.js';
import { taskStatusSchema } from './tasks.js';

/*
 * Ad campaigns (spec F12, ADR 0025): a client's campaign on an ad platform with a planned USD
 * budget, and periodic updates of spend and results entered by hand.
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
