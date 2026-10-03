import { z } from 'zod';
import { calendarDateSchema } from './dates.js';
import { pageQuerySchema, pageSchema, queryListSchema } from './lists.js';
import { currencySchema, minorAmountSchema } from './money.js';
import { optionalText } from './text.js';

/*
 * Out-of-scope work logged on a project or a retainer for separate billing (spec F05, M3).
 */

export const EXTRA_WORK_BILLING = ['unbilled', 'billed', 'waived'] as const;

export const extraWorkBillingSchema = z.enum(EXTRA_WORK_BILLING).meta({ id: 'ExtraWorkBilling' });

export type ExtraWorkBilling = z.infer<typeof extraWorkBillingSchema>;

/**
 * M3: `waived` needs why it is free, `billed` the invoice reference (`BILLING_NOTE_REQUIRED`).
 * Since F13 only issuing an invoice sets `billed` (`BILLED_BY_INVOICE` by hand).
 */
export const billingNeedsNote = (status: ExtraWorkBilling) => status !== 'unbilled';

const extraWorkFieldsSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: optionalText(2000),
  /** Not in the future; today when left out. */
  requestedOn: calendarDateSchema,
  /** A non-archived contact of the same client (`UNKNOWN_CONTACT`). */
  requestedByContactId: z.uuid().nullable(),
  /** Money field, in the project's or retainer's currency. */
  estimateMinor: minorAmountSchema.nullable(),
});

export const createExtraWorkSchema = extraWorkFieldsSchema
  .partial({
    description: true,
    requestedOn: true,
    requestedByContactId: true,
    estimateMinor: true,
  })
  .meta({ id: 'CreateExtraWork' });

export type CreateExtraWork = z.infer<typeof createExtraWorkSchema>;

export type CreateExtraWorkInput = z.input<typeof createExtraWorkSchema>;

export const updateExtraWorkSchema = extraWorkFieldsSchema
  .partial()
  .meta({ id: 'UpdateExtraWork' });

export type UpdateExtraWork = z.infer<typeof updateExtraWorkSchema>;

export const extraWorkBillingChangeSchema = z
  .object({ billingStatus: extraWorkBillingSchema, billingNote: optionalText(300).optional() })
  .meta({ id: 'ExtraWorkBillingChange' });

export type ExtraWorkBillingChange = z.infer<typeof extraWorkBillingChangeSchema>;

export const extraWorkSchema = z
  .object({
    id: z.uuid(),
    /** Exactly one of `projectId` and `retainerId` is set. */
    projectId: z.uuid().nullable(),
    retainerId: z.uuid().nullable(),
    title: z.string(),
    description: z.string().nullable(),
    requestedOn: calendarDateSchema,
    contact: z.object({ id: z.uuid(), name: z.string(), archived: z.boolean() }).nullable(),
    loggedBy: z.object({ id: z.uuid(), name: z.string() }),
    billingStatus: extraWorkBillingSchema,
    billingNote: z.string().nullable(),
    createdAt: z.iso.datetime(),
    /** Present only for callers with money access. */
    money: z
      .object({ estimateMinor: z.number().int().min(0).nullable(), currency: currencySchema })
      .optional(),
  })
  .meta({ id: 'ExtraWork' });

export type ExtraWork = z.infer<typeof extraWorkSchema>;

export const extraWorkListQuerySchema = pageQuerySchema.extend({
  billingStatus: queryListSchema(extraWorkBillingSchema).default([...EXTRA_WORK_BILLING]),
});

export type ExtraWorkListQuery = z.infer<typeof extraWorkListQuerySchema>;

export const extraWorkPageSchema = pageSchema(extraWorkSchema).meta({
  id: 'ExtraWorkPage',
  description: 'Non-archived extra work, newest request first',
});

export type ExtraWorkPage = z.infer<typeof extraWorkPageSchema>;
