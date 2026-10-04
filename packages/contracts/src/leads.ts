import { z } from 'zod';
import {
  clientStatusSchema,
  createContactSchema,
  noteChannelSchema,
  noteOccurredAtSchema,
  optionalEmailSchema,
  sectorSchema,
  tradeNameSchema,
} from './clients.js';
import {
  addDays,
  type CalendarDate,
  calendarDateSchema,
  daysInclusive,
  nextWorkDay,
  weekOf,
  workDaysBefore,
} from './dates.js';
import { departmentCodeSchema } from './departments.js';
import {
  pageQuerySchema,
  pageSchema,
  queryBooleanSchema,
  queryListSchema,
  sortOrderSchema,
} from './lists.js';
import { currencySchema, minorAmountSchema } from './money.js';
import type { QuoteRejectionReason } from './quotes.js';
import { optionalText } from './text.js';
import { phoneSchema } from './users.js';

/*
 * Leads (spec F03, ADR 0026): one record per inquiry, worked through a pipeline from New to Won
 * or Lost, with an owner, a mandatory next follow-up date while open (A12) and an activity log.
 */

export const LEAD_STAGES = ['new', 'contacted', 'meeting', 'quote_sent', 'won', 'lost'] as const;

export const leadStageSchema = z.enum(LEAD_STAGES).meta({ id: 'LeadStage' });

export type LeadStage = z.infer<typeof leadStageSchema>;

export const OPEN_LEAD_STAGES = [
  'new',
  'contacted',
  'meeting',
  'quote_sent',
] as const satisfies readonly LeadStage[];

/** The stages a lead is moved to by hand (rule 5). */
export const MANUAL_LEAD_STAGES = [
  'new',
  'contacted',
  'meeting',
] as const satisfies readonly LeadStage[];

export type ManualLeadStage = (typeof MANUAL_LEAD_STAGES)[number];

/** The stages a lost lead is reopened to (rule 9). */
export const REOPEN_LEAD_STAGES = ['new', 'contacted'] as const satisfies readonly LeadStage[];

export const LEAD_SOURCES = [
  'instagram',
  'facebook',
  'tiktok',
  'whatsapp',
  'website',
  'referral',
  'paid_ad',
  'event',
  'walk_in',
  'other',
] as const;

export const leadSourceSchema = z.enum(LEAD_SOURCES).meta({ id: 'LeadSource' });

export type LeadSource = z.infer<typeof leadSourceSchema>;

export const LEAD_LOSS_REASONS = [
  'price',
  'timing',
  'competitor',
  'not_a_fit',
  'no_response',
  'other',
] as const;

export const leadLossReasonSchema = z.enum(LEAD_LOSS_REASONS).meta({ id: 'LeadLossReason' });

export type LeadLossReason = z.infer<typeof leadLossReasonSchema>;

export const LEAD_LIMITS = {
  /** Requested services and packages per lead (`LIMIT_REACHED`). */
  interests: 10,
  /** The next follow-up date is at most this many days ahead (rule 3). */
  followUpDays: 180,
  /** Overdue after this many full work days (rule 19). */
  overdueWorkDays: 2,
  /** Cards per board column (edge case 13). */
  boardColumn: 200,
  /** The board's Won and Lost columns hold leads closed this many days back. */
  boardClosedDays: 30,
} as const;

export function isOpenLeadStage(stage: LeadStage): boolean {
  return (OPEN_LEAD_STAGES as readonly LeadStage[]).includes(stage);
}

/** Company name, else contact name. */
export function leadDisplayName(lead: { companyName: string | null; contactName: string }): string {
  return lead.companyName ?? lead.contactName;
}

/** At least one of phone, email and social handle (`CONTACT_REQUIRED`). */
export function leadHasContactMethod(lead: {
  phone: string | null;
  email: string | null;
  socialHandle: string | null;
}): boolean {
  return !!(lead.phone || lead.email || lead.socialHandle);
}

/** A detail is required for the `other` source (`NOTE_REQUIRED`). */
export function leadSourceDetailMissing(lead: {
  source: LeadSource;
  sourceDetail: string | null;
}): boolean {
  return lead.source === 'other' && !lead.sourceDetail;
}

/**
 * Rule 5: why a manual move from `from` to `to` is refused, or null when allowed. Leaving Quote
 * sent needs no quote in `sent`; won, lost and Quote sent are never entered by hand.
 */
export function manualLeadMoveRefusal(
  from: LeadStage,
  to: LeadStage,
  hasSentQuote: boolean,
): 'INVALID_TRANSITION' | 'LEAD_HAS_SENT_QUOTE' | null {
  const manual = MANUAL_LEAD_STAGES as readonly LeadStage[];
  if (!manual.includes(to) || from === to) return 'INVALID_TRANSITION';
  if (manual.includes(from)) return null;
  if (from !== 'quote_sent' || to === 'new') return 'INVALID_TRANSITION';
  return hasSentQuote ? 'LEAD_HAS_SENT_QUOTE' : null;
}

/** The quote rejection reason a loss records (F04 rule 11): same name, `not_a_fit` → `scope`. */
export function lossRejectionReason(reason: LeadLossReason): QuoteRejectionReason {
  return reason === 'not_a_fit' ? 'scope' : reason;
}

/** Rule 3: from today to today + 180 days (`INVALID_DATES`). */
export function followUpDateInRange(date: CalendarDate, today: CalendarDate): boolean {
  return date >= today && date <= addDays(today, LEAD_LIMITS.followUpDays);
}

/** The UI's default next follow-up date: the next work day. */
export function defaultFollowUpDate(today: CalendarDate): CalendarDate {
  return nextWorkDay(today);
}

/**
 * A12 on work day `day` (rules 18–19): a lead is due when its date is after the previous work
 * day and on or before `day`, and overdue when its date is on or before the second work day
 * before `day`.
 */
export function followUpReminderBounds(day: CalendarDate): {
  dueAfter: CalendarDate;
  overdueOnOrBefore: CalendarDate;
} {
  return {
    dueAfter: workDaysBefore(day, 1),
    overdueOnOrBefore: workDaysBefore(day, LEAD_LIMITS.overdueWorkDays),
  };
}

export const LEAD_FOLLOW_UP_FILTERS = ['overdue', 'today', 'week'] as const;

export const leadFollowUpFilterSchema = z
  .enum(LEAD_FOLLOW_UP_FILTERS)
  .meta({ id: 'LeadFollowUpFilter' });

export type LeadFollowUpFilter = z.infer<typeof leadFollowUpFilterSchema>;

/**
 * The follow-up dates a filter matches: `overdue` before today, `today`, and `week` from today
 * to the end of the current week (Friday).
 */
export function followUpFilterRange(
  filter: LeadFollowUpFilter,
  today: CalendarDate,
): { from: CalendarDate | null; to: CalendarDate } {
  if (filter === 'overdue') return { from: null, to: addDays(today, -1) };
  if (filter === 'today') return { from: today, to: today };
  return { from: today, to: weekOf(today).to };
}

/** Whole days since the stage changed, counted in Asia/Damascus days. */
export function daysInStage(stageChangedOn: CalendarDate, today: CalendarDate): number {
  return Math.max(0, daysInclusive(stageChangedOn, today) - 1);
}

// Inputs

const interestSchema = z
  .object({ serviceId: z.uuid().optional(), packageId: z.uuid().optional() })
  .refine((item) => !!item.serviceId !== !!item.packageId, {
    message: 'Exactly one of serviceId and packageId',
  })
  .meta({ id: 'LeadInterestInput' });

/** Duplicates are refused; more than `LEAD_LIMITS.interests` is `LIMIT_REACHED` in the API. */
const interestsSchema = z
  .array(interestSchema)
  .max(100)
  .refine((items) => new Set(items.map((i) => i.serviceId ?? i.packageId)).size === items.length, {
    message: 'Each service or package once',
  });

const budgetPairSchema = z.object({
  budgetMinor: minorAmountSchema.min(1).nullable(),
  budgetCurrency: currencySchema.nullable(),
});

const leadFieldsSchema = budgetPairSchema.extend({
  contactName: z.string().trim().min(1).max(120),
  companyName: optionalText(120),
  phone: phoneSchema,
  email: optionalEmailSchema,
  socialHandle: optionalText(120),
  source: leadSourceSchema,
  /** Required for `other` (`NOTE_REQUIRED`). */
  sourceDetail: optionalText(120),
  request: optionalText(2000),
  sector: sectorSchema,
  isHealthcare: z.boolean(),
  /** Today to today + 180 days (`INVALID_DATES`). */
  nextFollowUpOn: calendarDateSchema,
  interests: interestsSchema,
});

/** Budget amount and currency come together or not at all. */
const budgetPaired = (lead: { budgetMinor?: number | null; budgetCurrency?: string | null }) =>
  lead.budgetMinor === undefined && lead.budgetCurrency === undefined
    ? true
    : lead.budgetMinor !== undefined &&
      lead.budgetCurrency !== undefined &&
      (lead.budgetMinor === null) === (lead.budgetCurrency === null);

const budgetIssue = { message: 'Budget amount and currency go together', path: ['budgetCurrency'] };

/** At least one of phone, email and social handle (`CONTACT_REQUIRED`, checked by the API). */
export const createLeadSchema = leadFieldsSchema
  .extend({
    companyName: optionalText(120).default(null),
    phone: phoneSchema.default(null),
    email: optionalEmailSchema.default(null),
    socialHandle: optionalText(120).default(null),
    sourceDetail: optionalText(120).default(null),
    request: optionalText(2000).default(null),
    budgetMinor: minorAmountSchema.min(1).nullable().default(null),
    budgetCurrency: currencySchema.nullable().default(null),
    sector: sectorSchema.default(null),
    isHealthcare: z.boolean().default(false),
    interests: interestsSchema.default([]),
    /** An eligible owner (rule 1, `INVALID_LEAD_OWNER`). */
    ownerId: z.uuid(),
  })
  .refine(budgetPaired, budgetIssue)
  .meta({ id: 'CreateLead' });

export type CreateLead = z.infer<typeof createLeadSchema>;

export type CreateLeadInput = z.input<typeof createLeadSchema>;

/** Rule 7: any field of create except the owner; `interests` replaces the whole list. */
export const updateLeadSchema = leadFieldsSchema
  .partial()
  .extend({
    /** The `updatedAt` the form loaded; another save since then is `STALE_LEAD`. */
    updatedAt: z.iso.datetime(),
  })
  .refine(budgetPaired, budgetIssue)
  .meta({ id: 'UpdateLead' });

export type UpdateLead = z.infer<typeof updateLeadSchema>;

export type UpdateLeadInput = z.input<typeof updateLeadSchema>;

/** Rule 5; a new follow-up date may come with the move. */
export const leadStageChangeSchema = z
  .object({
    stage: z.enum(MANUAL_LEAD_STAGES),
    nextFollowUpOn: calendarDateSchema.optional(),
  })
  .meta({ id: 'LeadStageChange' });

export type LeadStageChange = z.infer<typeof leadStageChangeSchema>;

export const leadOwnerChangeSchema = z
  .object({ ownerId: z.uuid() })
  .meta({ id: 'LeadOwnerChange' });

export type LeadOwnerChange = z.infer<typeof leadOwnerChangeSchema>;

/** Rule 8: the note is required for `other` (`NOTE_REQUIRED`). */
export const loseLeadSchema = z
  .object({ reason: leadLossReasonSchema, note: optionalText(500).default(null) })
  .meta({ id: 'LoseLead' });

export type LoseLead = z.infer<typeof loseLeadSchema>;

export type LoseLeadInput = z.input<typeof loseLeadSchema>;

/**
 * Rule 9. `ownerId` hands the reopened lead to another eligible owner (owner decision): the only
 * way back for a lost lead whose owner was archived since (`INVALID_LEAD_OWNER` otherwise).
 */
export const reopenLeadSchema = z
  .object({
    stage: z.enum(REOPEN_LEAD_STAGES),
    nextFollowUpOn: calendarDateSchema,
    ownerId: z.uuid().optional(),
  })
  .meta({ id: 'ReopenLead' });

export type ReopenLead = z.infer<typeof reopenLeadSchema>;

/** Rule 10: the lead's contact added to the client, or not. */
const conversionContactSchema = z.discriminatedUnion('add', [
  z.object({ add: z.literal(false) }),
  createContactSchema.omit({ notes: true }).extend({ add: z.literal(true) }),
]);

/**
 * Rule 10: a new client from the lead, or a link to an existing one; also step 0 of accepting a
 * lead's quote (rule 11).
 */
export const convertLeadSchema = z
  .discriminatedUnion('mode', [
    z.object({
      mode: z.literal('new'),
      client: z.object({
        /** Unique among non-archived clients (`CLIENT_NAME_TAKEN`). */
        tradeName: tradeNameSchema,
        sector: sectorSchema,
        isHealthcare: z.boolean(),
        /** A user with the Account Manager role (`INVALID_ACCOUNT_MANAGER`). */
        accountManagerId: z.uuid(),
      }),
      contact: conversionContactSchema,
    }),
    z.object({
      mode: z.literal('existing'),
      /** A non-archived client (`CLIENT_ARCHIVED`); an ended one becomes active. */
      clientId: z.uuid(),
      contact: conversionContactSchema,
    }),
  ])
  .meta({ id: 'ConvertLead' });

export type ConvertLead = z.infer<typeof convertLeadSchema>;

export type ConvertLeadInput = z.input<typeof convertLeadSchema>;

/** The dialog's tab: without `clientId` the new-client defaults, with it the existing client. */
export const leadConversionPlanQuerySchema = z.object({ clientId: z.uuid().optional() });

export type LeadConversionPlanQuery = z.infer<typeof leadConversionPlanQuerySchema>;

const leadNoteFieldsSchema = z.object({
  occurredAt: noteOccurredAtSchema,
  channel: noteChannelSchema,
  summary: z.string().trim().min(1).max(2000),
});

/** Rule 4: an activity sets the open lead's next follow-up date; `occurredAt` defaults to now. */
export const createLeadNoteSchema = leadNoteFieldsSchema
  .partial({ occurredAt: true })
  .extend({ nextFollowUpOn: calendarDateSchema })
  .meta({ id: 'CreateLeadNote' });

export type CreateLeadNote = z.infer<typeof createLeadNoteSchema>;

export type CreateLeadNoteInput = z.input<typeof createLeadNoteSchema>;

export const updateLeadNoteSchema = leadNoteFieldsSchema.partial().meta({ id: 'UpdateLeadNote' });

export type UpdateLeadNote = z.infer<typeof updateLeadNoteSchema>;

// Responses

const personSchema = z.object({ id: z.uuid(), name: z.string() });

const ownerSchema = personSchema.extend({ archived: z.boolean() });

export const leadSchema = z
  .object({
    id: z.uuid(),
    displayName: z.string(),
    contactName: z.string(),
    companyName: z.string().nullable(),
    source: leadSourceSchema,
    stage: leadStageSchema,
    stageChangedAt: z.iso.datetime(),
    daysInStage: z.number().int().min(0),
    owner: ownerSchema,
    /** Null once won or lost. */
    nextFollowUpOn: calendarDateSchema.nullable(),
    /** The date is before today. */
    followUpOverdue: z.boolean(),
    followUpDueToday: z.boolean(),
    budgetMinor: minorAmountSchema.nullable(),
    budgetCurrency: currencySchema.nullable(),
    /** Names of the requested services and packages, in the order added. */
    interests: z.array(z.string()),
    /** Quote numbers written on the lead (non-archived latest versions). */
    quoteCount: z.number().int().min(0),
    /** The created or linked client of a won lead. */
    client: personSchema.nullable(),
    closedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Lead' });

export type Lead = z.infer<typeof leadSchema>;

export const leadNoteSchema = z
  .object({
    id: z.uuid(),
    leadId: z.uuid(),
    occurredAt: z.iso.datetime(),
    channel: noteChannelSchema,
    summary: z.string(),
    author: personSchema,
    canEdit: z.boolean(),
    canArchive: z.boolean(),
  })
  .meta({ id: 'LeadNote' });

export type LeadNote = z.infer<typeof leadNoteSchema>;

export const leadInterestSchema = z
  .object({
    kind: z.enum(['service', 'package']),
    /** The catalog service or package. */
    id: z.uuid(),
    name: z.string(),
    /** Archived in the catalog after it was added (edge case 10). */
    archived: z.boolean(),
  })
  .meta({ id: 'LeadInterest' });

export type LeadInterest = z.infer<typeof leadInterestSchema>;

export const leadPermissionsSchema = z
  .object({
    /** Edit the fields and set the next follow-up date: an open, non-archived lead (rule 7). */
    canEdit: z.boolean(),
    /** The manual stages the caller may move the lead to now (rule 5). */
    moves: z.array(z.enum(MANUAL_LEAD_STAGES)),
    canChangeOwner: z.boolean(),
    canLogActivity: z.boolean(),
    canLose: z.boolean(),
    canReopen: z.boolean(),
    canConvert: z.boolean(),
    canArchive: z.boolean(),
    canRestore: z.boolean(),
    /** Write a quote on the lead (`quotes.manage` covering it, an open lead). */
    canNewQuote: z.boolean(),
  })
  .meta({ id: 'LeadPermissions', description: 'What the caller may do, for the UI' });

export type LeadPermissions = z.infer<typeof leadPermissionsSchema>;

export const leadDetailSchema = leadSchema
  .extend({
    phone: z.string().nullable(),
    email: z.string().nullable(),
    socialHandle: z.string().nullable(),
    sourceDetail: z.string().nullable(),
    request: z.string().nullable(),
    sector: z.string().nullable(),
    isHealthcare: z.boolean(),
    interests: z.array(leadInterestSchema),
    /** The owner no longer holds `leads.manage` (edge case 4). */
    ownerCanManage: z.boolean(),
    lostReason: leadLossReasonSchema.nullable(),
    lostNote: z.string().nullable(),
    convertedBy: personSchema.nullable(),
    createdBy: personSchema,
    /** Non-archived, newest first. */
    notes: z.array(leadNoteSchema),
    permissions: leadPermissionsSchema,
  })
  .meta({ id: 'LeadDetail' });

export type LeadDetail = z.infer<typeof leadDetailSchema>;

export const loseLeadResultSchema = leadDetailSchema
  .extend({
    /** Display numbers of the quotes the loss recorded as rejected (rule 8). */
    rejectedQuotes: z.array(z.string()),
  })
  .meta({ id: 'LoseLeadResult' });

export type LoseLeadResult = z.infer<typeof loseLeadResultSchema>;

export const LEAD_SORTS = ['nextFollowUpOn', 'createdAt', 'updatedAt', 'stageChangedAt'] as const;

const leadFilterSchema = z.object({
  /** Matches the contact and company names, the phone and the email. */
  search: z.string().trim().min(1).max(100).optional(),
  ownerId: z.uuid().optional(),
  source: queryListSchema(leadSourceSchema).optional(),
  followUp: leadFollowUpFilterSchema.optional(),
});

export const leadListQuerySchema = pageQuerySchema.extend(leadFilterSchema.shape).extend({
  stage: queryListSchema(leadStageSchema).default([...OPEN_LEAD_STAGES]),
  /** The won lead of a client (F02 profile). */
  clientId: z.uuid().optional(),
  /** `true` lists archived leads only; needs `leads.manage` with scope all. */
  archived: queryBooleanSchema.default(false),
  sort: z.enum(LEAD_SORTS).default('nextFollowUpOn'),
  order: sortOrderSchema.default('asc'),
});

export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

export const leadPageSchema = pageSchema(leadSchema).meta({ id: 'LeadPage' });

export type LeadPage = z.infer<typeof leadPageSchema>;

export const leadBoardQuerySchema = leadFilterSchema;

export type LeadBoardQuery = z.infer<typeof leadBoardQuerySchema>;

export const leadBoardSchema = z
  .object({
    columns: z.array(
      z.object({
        stage: leadStageSchema,
        count: z.number().int().min(0),
        /** More than `LEAD_LIMITS.boardColumn` cards; the rest are in the list. */
        truncated: z.boolean(),
        items: z.array(leadSchema),
      }),
    ),
  })
  .meta({
    id: 'LeadBoard',
    description: 'One column per stage; Won and Lost hold leads closed in the last 30 days',
  });

export type LeadBoard = z.infer<typeof leadBoardSchema>;

/** Rule 2, sent in the body so personal data stays out of URLs. */
export const leadDuplicateQuerySchema = z
  .object({
    phone: phoneSchema.default(null),
    email: optionalEmailSchema.default(null),
    /** Company and contact names, matched against client trade names. */
    names: z.array(z.string().trim().min(1).max(120)).max(2).default([]),
    excludeLeadId: z.uuid().optional(),
  })
  .meta({ id: 'LeadDuplicateQuery' });

export type LeadDuplicateQuery = z.infer<typeof leadDuplicateQuerySchema>;

export type LeadDuplicateQueryInput = z.input<typeof leadDuplicateQuerySchema>;

const duplicateClientSchema = z.object({
  id: z.uuid(),
  tradeName: z.string(),
  status: clientStatusSchema,
  accountManager: personSchema,
});

export const leadDuplicatesSchema = z
  .object({
    /** Open, non-archived leads with the same phone or email. */
    leads: z.array(
      z.object({
        id: z.uuid(),
        displayName: z.string(),
        owner: personSchema,
        stage: leadStageSchema,
        /** The caller can open it; otherwise only name, owner and stage show (rule 2). */
        readable: z.boolean(),
      }),
    ),
    /** Non-archived clients with the same trade name, or a contact with the same phone or email. */
    clients: z.array(duplicateClientSchema),
  })
  .meta({ id: 'LeadDuplicates' });

export type LeadDuplicates = z.infer<typeof leadDuplicatesSchema>;

export const leadOwnerOptionsSchema = z
  .object({
    items: z.array(personSchema.extend({ departments: z.array(departmentCodeSchema) })),
  })
  .meta({
    id: 'LeadOwnerOptions',
    description: 'Active users who may own leads (rule 1), by name',
  });

export type LeadOwnerOptions = z.infer<typeof leadOwnerOptionsSchema>;

export const leadConversionPlanSchema = z
  .object({
    /** New-client defaults (rule 10): the display name, the lead's sector and healthcare flag. */
    client: z.object({
      tradeName: z.string(),
      sector: z.string().nullable(),
      isHealthcare: z.boolean(),
      /** The owner when they hold the Account Manager role; otherwise chosen. */
      accountManagerId: z.uuid().nullable(),
    }),
    /** The contact block's defaults, from the lead. */
    contact: z.object({
      name: z.string(),
      phone: z.string().nullable(),
      email: z.string().nullable(),
    }),
    /** Users with the Account Manager role, by name. */
    accountManagers: z.array(personSchema),
    /** Clients matching the lead (rule 2): suggested links. */
    duplicateClients: z.array(duplicateClientSchema),
    /** Non-archived activities copied into the client's log. */
    noteCount: z.number().int().min(0),
    /** Quotes that move to the client. */
    quoteCount: z.number().int().min(0),
    /** With `clientId`: the client to link and whether a contact has the lead's phone or email. */
    existingClient: duplicateClientSchema.extend({ hasContact: z.boolean() }).nullable(),
  })
  .meta({
    id: 'LeadConversionPlan',
    description: 'The convert dialog (and accept step 0) defaults',
  });

export type LeadConversionPlan = z.infer<typeof leadConversionPlanSchema>;
