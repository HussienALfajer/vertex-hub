import { z } from 'zod';
import { addDays, type CalendarDate, calendarDateSchema, daysInclusive } from './dates.js';
import { departmentCodeSchema } from './departments.js';
import {
  pageQuerySchema,
  pageSchema,
  queryBooleanSchema,
  queryListSchema,
  sortOrderSchema,
} from './lists.js';
import { currencySchema, minorAmountSchema } from './money.js';
import { engagementDepartmentsSchema, projectNameSchema, taskCountsSchema } from './projects.js';

export const RETAINER_STATUSES = ['active', 'paused', 'ended'] as const;

export const retainerStatusSchema = z.enum(RETAINER_STATUSES).meta({ id: 'RetainerStatus' });

export type RetainerStatus = z.infer<typeof retainerStatusSchema>;

/**
 * The allowed status changes (spec F05, "Retainer status"). Reactivating (`ended` to `active`)
 * needs scope all. Archive is separate.
 */
export const RETAINER_TRANSITIONS: Readonly<Record<RetainerStatus, readonly RetainerStatus[]>> = {
  active: ['paused', 'ended'],
  paused: ['active', 'ended'],
  ended: ['active'],
};

export function canChangeRetainerStatus(from: RetainerStatus, to: RetainerStatus): boolean {
  return RETAINER_TRANSITIONS[from].includes(to);
}

export const CYCLE_STATUSES = ['open', 'closed'] as const;

export const cycleStatusSchema = z.enum(CYCLE_STATUSES).meta({ id: 'CycleStatus' });

export type CycleStatus = z.infer<typeof cycleStatusSchema>;

/** `post` covers single posts and carousels; `other` needs a label. */
export const DELIVERABLE_KINDS = [
  'design',
  'reel',
  'story',
  'post',
  'video',
  'photo_shoot',
  'ad_campaign',
  'monthly_report',
  'other',
] as const;

export const deliverableKindSchema = z.enum(DELIVERABLE_KINDS).meta({ id: 'DeliverableKind' });

export type DeliverableKind = z.infer<typeof deliverableKindSchema>;

/** Limits of what one retainer holds (spec F05). */
export const RETAINER_LIMITS = {
  deliverables: 20,
  cycleLines: 30,
  adjustmentsPerLine: 100,
} as const;

// Deliverable lines

const deliverableLabelSchema = z
  .string()
  .trim()
  .max(60)
  .nullable()
  .transform((value) => value || null);

const labelRequiredForOther = <T extends { kind: DeliverableKind; label?: string | null }>(
  line: T,
) => line.kind !== 'other' || !!line.label;

const labelRule = { message: 'A line of kind "other" needs a label', path: ['label'] };

const deliverableLineFieldsSchema = z.object({
  kind: deliverableKindSchema,
  label: deliverableLabelSchema.optional(),
  monthlyQuantity: z.number().int().min(1).max(999),
});

/** A line of a new retainer. */
export const newDeliverableLineSchema = deliverableLineFieldsSchema
  .refine(labelRequiredForOther, labelRule)
  .meta({ id: 'NewDeliverableLine' });

/** A line of the retainer's standing lines; `id` is left out for a new line. */
export const deliverableLineInputSchema = deliverableLineFieldsSchema
  .extend({ id: z.uuid().optional() })
  .refine(labelRequiredForOther, labelRule)
  .meta({ id: 'DeliverableLineInput' });

export type DeliverableLineInput = z.infer<typeof deliverableLineInputSchema>;

/** The retainer's standing lines; lines left out are archived (R10). */
export const retainerDeliverablesSchema = z
  .object({ lines: z.array(deliverableLineInputSchema) })
  .refine(
    ({ lines }) => {
      const ids = lines.flatMap((line) => (line.id ? [line.id] : []));
      return new Set(ids).size === ids.length;
    },
    { message: 'Each existing line is listed once', path: ['lines'] },
  )
  .meta({ id: 'RetainerDeliverables' });

export type RetainerDeliverables = z.infer<typeof retainerDeliverablesSchema>;

/** What makes two lines the same: the kind and the label, case-insensitively. */
export function deliverableKey(line: { kind: DeliverableKind; label?: string | null }): string {
  return `${line.kind}:${line.label?.toLocaleLowerCase('ar') ?? ''}`;
}

/** The lines that repeat an earlier one (`DUPLICATE_DELIVERABLE`). */
export function duplicateDeliverables<T extends { kind: DeliverableKind; label?: string | null }>(
  lines: readonly T[],
): T[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = deliverableKey(line);
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

export const deliverableLineSchema = z
  .object({
    id: z.uuid(),
    kind: deliverableKindSchema,
    label: z.string().nullable(),
    monthlyQuantity: z.number().int().min(1),
    position: z.number().int().min(1),
  })
  .meta({ id: 'DeliverableLine' });

export type DeliverableLine = z.infer<typeof deliverableLineSchema>;

export const deliverableLineListSchema = z
  .object({ items: z.array(deliverableLineSchema) })
  .meta({ id: 'DeliverableLineList', description: 'Non-archived lines, by position' });

export type DeliverableLineList = z.infer<typeof deliverableLineListSchema>;

// The deliverables counter (R7, R11, R13)

export interface CycleCount {
  committed: number;
  delivered: number;
}

export interface CyclePeriod {
  periodStart: CalendarDate;
  periodEnd: CalendarDate;
}

/**
 * R11: whether a line of an open cycle of an `active` retainer is behind on `today`. The caller
 * checks the cycle and retainer status; A09 reuses this rule.
 */
export function isLineBehind(line: CycleCount, period: CyclePeriod, today: CalendarDate): boolean {
  if (line.committed <= 0 || line.delivered >= line.committed) return false;
  const length = daysInclusive(period.periodStart, period.periodEnd);
  const elapsed = Math.min(1, daysInclusive(period.periodStart, today) / length);
  const remaining = daysInclusive(today, period.periodEnd);
  if (remaining <= 7) return true;
  return line.delivered / line.committed < elapsed - 0.25;
}

/** R13: Σ min(delivered, committed) ÷ Σ committed, whole percent rounded down; null if 0. */
export function deliveryRate(lines: readonly CycleCount[]): number | null {
  const committed = lines.reduce((sum, line) => sum + Math.max(0, line.committed), 0);
  if (committed === 0) return null;
  const delivered = lines.reduce(
    (sum, line) => sum + Math.max(0, Math.min(line.delivered, line.committed)),
    0,
  );
  return Math.floor((delivered * 100) / committed);
}

export const RENEWAL_STATES = ['due', 'overdue'] as const;

export const renewalStateSchema = z.enum(RENEWAL_STATES).meta({ id: 'RenewalState' });

export type RenewalState = z.infer<typeof renewalStateSchema>;

/** Days before the renewal date from which it is due (R6). */
export const RENEWAL_NOTICE_DAYS = 30;

/** R6: "due" from 30 days before the renewal date, "overdue" after it; never once ended. */
export function renewalState(
  renewalDate: CalendarDate | null,
  status: RetainerStatus,
  today: CalendarDate,
): RenewalState | null {
  if (!renewalDate || status === 'ended') return null;
  if (today > renewalDate) return 'overdue';
  return today >= addDays(renewalDate, -RENEWAL_NOTICE_DAYS) ? 'due' : null;
}

// Cycles

const reasonSchema = z.string().trim().min(1).max(300);

export const cycleAdjustmentSchema = z
  .object({
    id: z.uuid(),
    delta: z.number().int(),
    reason: z.string(),
    author: z.object({ id: z.uuid(), name: z.string() }),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'CycleAdjustment' });

export type CycleAdjustment = z.infer<typeof cycleAdjustmentSchema>;

export const cycleLineSchema = z
  .object({
    id: z.uuid(),
    cycleId: z.uuid(),
    /** Null for a line added to this cycle only. */
    deliverableId: z.uuid().nullable(),
    kind: deliverableKindSchema,
    label: z.string().nullable(),
    position: z.number().int().min(1),
    committed: z.number().int().min(0),
    /** Open cycle: delivered tasks + adjustments (R7). Closed cycle: frozen at close (R8). */
    delivered: z.number().int().min(0),
    /** Tasks delivered after the cycle closed (R8); 0 on an open cycle. */
    deliveredAfterClose: z.number().int().min(0),
    /** R11, on an open cycle of an active retainer. */
    behind: z.boolean(),
    tasks: taskCountsSchema,
  })
  .meta({ id: 'CycleLine' });

export type CycleLine = z.infer<typeof cycleLineSchema>;

export const cycleSchema = z
  .object({
    id: z.uuid(),
    retainerId: z.uuid(),
    /** The first day of the calendar month. */
    month: calendarDateSchema,
    periodStart: calendarDateSchema,
    periodEnd: calendarDateSchema,
    status: cycleStatusSchema,
    closedAt: z.iso.datetime().nullable(),
    deliveryRate: z.number().int().min(0).max(100).nullable(),
    behind: z.boolean(),
    lines: z.array(cycleLineSchema),
  })
  .meta({ id: 'Cycle' });

export type Cycle = z.infer<typeof cycleSchema>;

export const cycleDetailSchema = cycleSchema
  .extend({
    lines: z.array(
      cycleLineSchema.extend({ adjustments: z.array(cycleAdjustmentSchema) }).meta({
        id: 'CycleLineDetail',
      }),
    ),
  })
  .meta({ id: 'CycleDetail', description: 'A cycle with each line’s adjustments, newest first' });

export type CycleDetail = z.infer<typeof cycleDetailSchema>;

export const cycleListQuerySchema = pageQuerySchema;

export type CycleListQuery = z.infer<typeof cycleListQuerySchema>;

export const cyclePageSchema = pageSchema(cycleSchema).meta({
  id: 'CyclePage',
  description: 'Cycles, newest month first',
});

export type CyclePage = z.infer<typeof cyclePageSchema>;

/** R9: an open cycle's committed quantity, with a reason. */
export const updateCycleLineSchema = z
  .object({ committedQuantity: z.number().int().min(0).max(999), reason: reasonSchema })
  .meta({ id: 'UpdateCycleLine' });

export type UpdateCycleLine = z.infer<typeof updateCycleLineSchema>;

/** R9: a line for this cycle only, with a reason. */
export const createCycleLineSchema = z
  .object({
    kind: deliverableKindSchema,
    label: deliverableLabelSchema.optional(),
    committedQuantity: z.number().int().min(0).max(999),
    reason: reasonSchema,
  })
  .refine(labelRequiredForOther, labelRule)
  .meta({ id: 'CreateCycleLine' });

export type CreateCycleLine = z.infer<typeof createCycleLineSchema>;

export type CreateCycleLineInput = z.input<typeof createCycleLineSchema>;

/** R7: a correction of the delivered count; never edited, corrected by another one. */
export const createCycleAdjustmentSchema = z
  .object({
    delta: z
      .number()
      .int()
      .min(-999)
      .max(999)
      .refine((delta) => delta !== 0, 'The change cannot be zero'),
    reason: reasonSchema,
  })
  .meta({ id: 'CreateCycleAdjustment' });

export type CreateCycleAdjustment = z.infer<typeof createCycleAdjustmentSchema>;

// Retainers

const retainerFieldsSchema = z.object({
  name: projectNameSchema,
  departments: engagementDepartmentsSchema,
  startDate: calendarDateSchema,
  /** A reminder only (R6); after `startDate`. */
  renewalDate: calendarDateSchema.nullable(),
  /** Money field: sent only by callers with money access; `USD` when left out. */
  currency: currencySchema,
  /** Money field. */
  monthlyFeeMinor: minorAmountSchema.nullable(),
});

/** `renewalDate` > `startDate` is checked by the API (`INVALID_DATES`). */
export const createRetainerSchema = retainerFieldsSchema
  .extend({
    clientId: z.uuid(),
    /** At most `RETAINER_LIMITS.deliverables`; the API answers `LIMIT_REACHED`. */
    deliverables: z.array(newDeliverableLineSchema).default([]),
  })
  .partial({ renewalDate: true, currency: true, monthlyFeeMinor: true })
  .meta({ id: 'CreateRetainer' });

export type CreateRetainer = z.infer<typeof createRetainerSchema>;

export type CreateRetainerInput = z.input<typeof createRetainerSchema>;

/** `currency` and `monthlyFeeMinor` need money access; `startDate` only before the first cycle. */
export const updateRetainerSchema = retainerFieldsSchema.partial().meta({ id: 'UpdateRetainer' });

export type UpdateRetainer = z.infer<typeof updateRetainerSchema>;

export type UpdateRetainerInput = z.input<typeof updateRetainerSchema>;

export const retainerStatusChangeSchema = z
  .object({ status: retainerStatusSchema })
  .meta({ id: 'RetainerStatusChange' });

export type RetainerStatusChange = z.infer<typeof retainerStatusChangeSchema>;

export const retainerSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    client: z.object({ id: z.uuid(), name: z.string() }),
    /** The client's account manager, who is responsible for the retainer. */
    accountManager: z.object({ id: z.uuid(), name: z.string() }),
    departments: z.array(departmentCodeSchema),
    status: retainerStatusSchema,
    renewalDate: calendarDateSchema.nullable(),
    renewal: renewalStateSchema.nullable(),
    /** The newest open cycle, or null (paused across a month, ended, not started). */
    currentCycle: cycleSchema.nullable(),
  })
  .meta({ id: 'Retainer' });

export type Retainer = z.infer<typeof retainerSchema>;

export const retainerPermissionsSchema = z
  .object({
    canManage: z.boolean(),
    canReactivate: z.boolean(),
    canArchive: z.boolean(),
    canSeeMoney: z.boolean(),
    canEditMoney: z.boolean(),
    /** M3: billing follows the work, so it stays open on ended retainers. */
    canBill: z.boolean(),
  })
  .meta({ id: 'RetainerPermissions', description: 'What the caller may do, for the UI' });

export type RetainerPermissions = z.infer<typeof retainerPermissionsSchema>;

export const retainerDetailSchema = retainerSchema
  .extend({
    startDate: calendarDateSchema,
    endedOn: calendarDateSchema.nullable(),
    /** Non-archived standing lines, by position. */
    deliverables: z.array(deliverableLineSchema),
    archivedAt: z.iso.datetime().nullable(),
    /** Present only for callers with money access. */
    money: z
      .object({ currency: currencySchema, monthlyFeeMinor: z.number().int().min(0).nullable() })
      .optional(),
    permissions: retainerPermissionsSchema,
  })
  .meta({ id: 'RetainerDetail' });

export type RetainerDetail = z.infer<typeof retainerDetailSchema>;

export const RETAINER_SORTS = ['clientName', 'name', 'renewalDate'] as const;

export const retainerListQuerySchema = pageQuerySchema.extend({
  /** Matches the retainer name or the client's trade name. */
  search: z.string().trim().min(1).max(100).optional(),
  status: queryListSchema(retainerStatusSchema).default(['active', 'paused']),
  clientId: z.uuid().optional(),
  /** The client's primary account manager. */
  accountManagerId: z.uuid().optional(),
  department: departmentCodeSchema.optional(),
  behind: queryBooleanSchema.optional(),
  /** `true`: renewal due or overdue (R6). */
  renewalDue: queryBooleanSchema.optional(),
  /** `true` lists archived retainers only; needs `projects.manage` with scope all. */
  archived: queryBooleanSchema.default(false),
  sort: z.enum(RETAINER_SORTS).default('clientName'),
  order: sortOrderSchema.default('asc'),
});

export type RetainerListQuery = z.infer<typeof retainerListQuerySchema>;

export const retainerPageSchema = pageSchema(retainerSchema).meta({ id: 'RetainerPage' });

export type RetainerPage = z.infer<typeof retainerPageSchema>;
