import { z } from 'zod';
import {
  addDays,
  addMonths,
  type CalendarDate,
  calendarDateSchema,
  daysInclusive,
  firstOfMonth,
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

/**
 * What a retainer charge bills (spec F05B, ADR 0029): a month's amount, an amendment's addition
 * or credit, or an early termination fee. Invoices bill charges, not cycles.
 */
export const RETAINER_CHARGE_KINDS = ['monthly', 'addition', 'credit', 'termination_fee'] as const;

export const retainerChargeKindSchema = z
  .enum(RETAINER_CHARGE_KINDS)
  .meta({ id: 'RetainerChargeKind' });

export type RetainerChargeKind = z.infer<typeof retainerChargeKindSchema>;

/** Being invoiced is read from invoice lines, as for other sources; this is the charge's own state. */
export const RETAINER_CHARGE_STATUSES = ['pending', 'cancelled', 'settled_outside'] as const;

export const retainerChargeStatusSchema = z
  .enum(RETAINER_CHARGE_STATUSES)
  .meta({ id: 'RetainerChargeStatus' });

export type RetainerChargeStatus = z.infer<typeof retainerChargeStatusSchema>;

// Terms (spec F05B T1–T12)

/** What happens when a term's last month ends (T7–T9). */
export const TERM_END_ACTIONS = ['renew', 'end', 'continue'] as const;

export const termEndActionSchema = z.enum(TERM_END_ACTIONS).meta({ id: 'TermEndAction' });

export type TermEndAction = z.infer<typeof termEndActionSchema>;

export const TERM_STATUSES = ['scheduled', 'active', 'completed', 'cancelled'] as const;

export const termStatusSchema = z.enum(TERM_STATUSES).meta({ id: 'TermStatus' });

export type TermStatus = z.infer<typeof termStatusSchema>;

export const TERM_LIMITS = { minMonths: 1, maxMonths: 36 } as const;

/** T7: the renewal term is created this many days before the current term ends. */
export const TERM_RENEWAL_DAYS = 30;

/**
 * T3: the default schedule, an even split of the total with the remainder on the last month
 * (100000 over 3 months is 33333 / 33333 / 33334).
 */
export function splitEvenly(totalMinor: number, months: number): number[] {
  if (months < 1) return [];
  const each = Math.floor(totalMinor / months);
  return Array.from({ length: months }, (_, index) =>
    index === months - 1 ? totalMinor - each * (months - 1) : each,
  );
}

/** The months of a term, first days, from its start month. */
export function termMonths(startMonth: CalendarDate, months: number): CalendarDate[] {
  return Array.from({ length: months }, (_, index) => addMonths(startMonth, index));
}

/** The position (1…months) of `month` in a term starting in `startMonth`. */
export function termPosition(startMonth: CalendarDate, month: CalendarDate): number {
  const [startYear, start] = startMonth.split('-').map(Number) as [number, number];
  const [year, current] = month.split('-').map(Number) as [number, number];
  return (year - startYear) * 12 + current - start + 1;
}

/** The last month of a term (its first day). */
export function termEndMonth(startMonth: CalendarDate, months: number): CalendarDate {
  return addMonths(startMonth, months - 1);
}

/** T11: the renewal date of a retainer whose last term ends in `endMonth`: the day after. */
export function dayAfterTerm(endMonth: CalendarDate): CalendarDate {
  return addMonths(endMonth, 1);
}

/** T3: one amount per month, summing to the agreed total (`SCHEDULE_TOTAL_MISMATCH`). */
export function scheduleMatches(term: {
  months: number;
  agreedTotalMinor: number;
  schedule: readonly number[];
}): boolean {
  return (
    term.schedule.length === term.months &&
    term.schedule.reduce((sum, amount) => sum + amount, 0) === term.agreedTotalMinor
  );
}

const monthSchema = calendarDateSchema.refine(
  (date) => firstOfMonth(date) === date,
  'Expected the first day of a month',
);

const termMonthCountSchema = z.number().int().min(TERM_LIMITS.minMonths).max(TERM_LIMITS.maxMonths);

/**
 * A term without its start month: the new retainer form (it starts in the start date's month)
 * and quote acceptance (F04, Q1). The sum and length of the schedule are checked by the API.
 */
export const retainerTermInputSchema = z
  .object({
    months: termMonthCountSchema,
    /** Money field. */
    agreedTotalMinor: minorAmountSchema,
    /** One amount per month, in order (T3); money field. */
    schedule: z.array(minorAmountSchema).min(1).max(TERM_LIMITS.maxMonths),
    endAction: termEndActionSchema.default('renew'),
  })
  .meta({ id: 'RetainerTermInput' });

export type RetainerTermInput = z.infer<typeof retainerTermInputSchema>;

export const createRetainerTermSchema = retainerTermInputSchema
  .extend({ startMonth: monthSchema })
  .meta({ id: 'CreateRetainerTerm' });

export type CreateRetainerTerm = z.infer<typeof createRetainerTermSchema>;

export type CreateRetainerTermInput = z.input<typeof createRetainerTermSchema>;

/** T5: every field of a scheduled term; an active term takes `endAction` only (`TERM_STARTED`). */
export const updateRetainerTermSchema = createRetainerTermSchema
  .partial()
  .extend({ endAction: termEndActionSchema.optional() })
  .meta({ id: 'UpdateRetainerTerm' });

export type UpdateRetainerTerm = z.infer<typeof updateRetainerTermSchema>;

export const cancelRetainerTermSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .meta({ id: 'CancelRetainerTerm' });

export type CancelRetainerTerm = z.infer<typeof cancelRetainerTermSchema>;

/** The active term of a retainer, else its scheduled one (header chip, list renewal column). */
export const retainerTermSummarySchema = z
  .object({
    id: z.uuid(),
    number: z.number().int().min(1),
    status: termStatusSchema,
    startMonth: calendarDateSchema,
    endMonth: calendarDateSchema,
    months: z.number().int().min(1),
    endAction: termEndActionSchema,
    /** Detail only, for callers with money access (G3). */
    money: z
      .object({
        agreedTotalMinor: z.number().int().min(0),
        /** T6: Σ of its months' non-cancelled monthly, addition and credit charges. */
        currentTotalMinor: z.number().int(),
      })
      .optional(),
  })
  .meta({ id: 'RetainerTermSummary' });

export type RetainerTermSummary = z.infer<typeof retainerTermSummarySchema>;

/**
 * A month of a term: its `monthly` charge (C1). The invoice that bills it is on the retainer's
 * billing (`RetainerCharge`, money access), by `chargeId`.
 */
export const retainerTermMonthSchema = z
  .object({
    month: calendarDateSchema,
    /** 1…months. */
    position: z.number().int().min(1),
    /** Null when the month has no charge (a cancelled term's month that never had one). */
    chargeId: z.uuid().nullable(),
    status: retainerChargeStatusSchema.nullable(),
    /** The month began and its charge became due (C3). */
    due: z.boolean(),
    /** Present only for callers with money access (G3). */
    money: z
      .object({
        /** The month's `monthly` charge. */
        amountMinor: z.number().int().min(0),
        /** The schedule amount plus onward amendments (what a renewal copies, T7). */
        baseAmountMinor: z.number().int().min(0),
        /** Σ of the month's non-cancelled monthly, addition and credit charges (T6). */
        totalMinor: z.number().int(),
      })
      .optional(),
  })
  .meta({ id: 'RetainerTermMonth' });

export type RetainerTermMonth = z.infer<typeof retainerTermMonthSchema>;

export const retainerTermSchema = retainerTermSummarySchema
  .omit({ money: true })
  .extend({
    /** The term this one renews automatically (T7). */
    renewedFrom: z.object({ id: z.uuid(), number: z.number().int().min(1) }).nullable(),
    cancelledAt: z.iso.datetime().nullable(),
    cancelReason: z.string().nullable(),
    createdAt: z.iso.datetime(),
    money: retainerTermSummarySchema.shape.money,
    /** Its months in order, each with its `monthly` charge (T3). */
    schedule: z.array(retainerTermMonthSchema),
  })
  .meta({ id: 'RetainerTerm' });

export type RetainerTerm = z.infer<typeof retainerTermSchema>;

export const retainerTermListSchema = z
  .object({ items: z.array(retainerTermSchema) })
  .meta({ id: 'RetainerTermList', description: 'Terms, newest first' });

export type RetainerTermList = z.infer<typeof retainerTermListSchema>;

/** E2: an optional early termination fee when a retainer ends (money access). */
export const retainerTerminationSchema = z
  .object({
    /** Money field. */
    feeMinor: minorAmountSchema.min(1),
    reason: z.string().trim().min(1).max(500),
  })
  .meta({ id: 'RetainerTermination' });

export type RetainerTermination = z.infer<typeof retainerTerminationSchema>;

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
  /** A line's revision limit; the same bound as `TASK_LIMITS.revisionLimit` (no import: cycle). */
  revisionLimit: 20,
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

/** The revision rounds of the line's generated tasks (F04); null: the template step's. */
const revisionLimitSchema = z.number().int().min(0).max(RETAINER_LIMITS.revisionLimit).nullable();

const deliverableLineFieldsSchema = z.object({
  kind: deliverableKindSchema,
  label: deliverableLabelSchema.optional(),
  monthlyQuantity: z.number().int().min(1).max(999),
  revisionLimit: revisionLimitSchema.optional(),
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
    /** Null: the template step's revision limit. */
    revisionLimit: z.number().int().min(0).nullable(),
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

/** A09: the alert starts when this many days or fewer remain in the cycle (spec P2A). */
export const BEHIND_ALERT_DAYS = 7;

/** A09: the final reminder is sent when this many days or fewer remain. */
export const BEHIND_FINAL_DAYS = 3;

/**
 * A09 (spec P2A rules 1–3): which notice a cycle is due on `today`, from its period alone; the
 * caller checks the lines with `isLineBehind`. A period no longer than the alert window gets none.
 */
export function behindAlert(period: CyclePeriod, today: CalendarDate): 'first' | 'final' | null {
  if (daysInclusive(period.periodStart, period.periodEnd) <= BEHIND_ALERT_DAYS) return null;
  const daysLeft = daysInclusive(today, period.periodEnd);
  if (daysLeft < 1 || daysLeft > BEHIND_ALERT_DAYS) return null;
  return daysLeft <= BEHIND_FINAL_DAYS ? 'final' : 'first';
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
    /** Copied from the standing line; null: the template step's. */
    revisionLimit: z.number().int().min(0).nullable(),
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

/**
 * `renewalDate` > `startDate` is checked by the API (`INVALID_DATES`). A `term` starts in the
 * start date's month and sets the renewal date (F05B T11: `RENEWAL_DATE_FROM_TERM` with both).
 */
export const createRetainerSchema = retainerFieldsSchema
  .extend({
    clientId: z.uuid(),
    /** At most `RETAINER_LIMITS.deliverables`; the API answers `LIMIT_REACHED`. */
    deliverables: z.array(newDeliverableLineSchema).default([]),
    /** Money field (F05B). */
    term: retainerTermInputSchema.optional(),
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
  .object({
    status: retainerStatusSchema,
    /** `ended` only (F05B E2); money field. */
    termination: retainerTerminationSchema.optional(),
  })
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
    /** With an active or scheduled term, the day after its last term (F05B T11). */
    renewalDate: calendarDateSchema.nullable(),
    renewal: renewalStateSchema.nullable(),
    /** The active term, else the scheduled one (F05B). */
    term: retainerTermSummarySchema.nullable(),
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
