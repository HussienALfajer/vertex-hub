import { z } from 'zod';
import { addDays, type CalendarDate, calendarDateSchema, daysInclusive } from './dates.js';
import { departmentCodeSchema } from './departments.js';
import { clientRefSchema, personSchema } from './images.js';
import {
  pageQuerySchema,
  pageSchema,
  queryBooleanSchema,
  queryListSchema,
  sortOrderSchema,
} from './lists.js';
import { currencySchema, minorAmountSchema, signedMinorAmountSchema } from './money.js';
import { engagementDepartmentsSchema, projectNameSchema, taskCountsSchema } from './projects.js';
import type { CyclePeriod } from './retainer-cycles.js';

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
 * What a retainer charge bills (spec F05B, ADR 0029): a cycle's amount, an amendment's addition
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

/** What happens when a term's last cycle ends (T7–T9). */
export const TERM_END_ACTIONS = ['renew', 'end', 'continue'] as const;

export const termEndActionSchema = z.enum(TERM_END_ACTIONS).meta({ id: 'TermEndAction' });

export type TermEndAction = z.infer<typeof termEndActionSchema>;

export const TERM_STATUSES = ['scheduled', 'active', 'completed', 'cancelled'] as const;

export const termStatusSchema = z.enum(TERM_STATUSES).meta({ id: 'TermStatus' });

export type TermStatus = z.infer<typeof termStatusSchema>;

/** F05C T1': a term covers 1–36 cycles. */
export const TERM_LIMITS = { minCycles: 1, maxCycles: 36 } as const;

/** T7, F05C T3': the renewal term is created this many days before the current term ends. */
export const TERM_RENEWAL_DAYS = 30;

/**
 * T3: the default schedule, an even split of the total with the remainder on the last cycle
 * (100000 over 3 cycles is 33333 / 33333 / 33334).
 */
export function splitEvenly(totalMinor: number, cycles: number): number[] {
  if (cycles < 1) return [];
  const each = Math.floor(totalMinor / cycles);
  return Array.from({ length: cycles }, (_, index) =>
    index === cycles - 1 ? totalMinor - each * (cycles - 1) : each,
  );
}

/** F05C T3': the renewal date of a retainer whose last term ends on `endDate`: the day after. */
export function dayAfterTerm(endDate: CalendarDate): CalendarDate {
  return addDays(endDate, 1);
}

/** T3: one amount per cycle, summing to the agreed total (`SCHEDULE_TOTAL_MISMATCH`). */
export function scheduleMatches(term: {
  cycles: number;
  agreedTotalMinor: number;
  schedule: readonly number[];
}): boolean {
  return (
    term.schedule.length === term.cycles &&
    term.schedule.reduce((sum, amount) => sum + amount, 0) === term.agreedTotalMinor
  );
}

/** A retainer cycle's number, 1 for the cycle that starts on the start date (F05C Y1). */
export const cycleNumberSchema = z.number().int().min(1).max(1200);

const termCycleCountSchema = z.number().int().min(TERM_LIMITS.minCycles).max(TERM_LIMITS.maxCycles);

/**
 * A term without its start cycle: the new retainer form (it starts at the retainer's current
 * cycle) and quote acceptance (F04, Q1). The sum and length of the schedule are checked by the API.
 */
export const retainerTermInputSchema = z
  .object({
    cycles: termCycleCountSchema,
    /** Money field. */
    agreedTotalMinor: minorAmountSchema,
    /** One amount per cycle, in order (T3); money field. */
    schedule: z.array(minorAmountSchema).min(1).max(TERM_LIMITS.maxCycles),
    endAction: termEndActionSchema.default('renew'),
  })
  .meta({ id: 'RetainerTermInput' });

export type RetainerTermInput = z.infer<typeof retainerTermInputSchema>;

export const createRetainerTermSchema = retainerTermInputSchema
  .extend({ startCycle: cycleNumberSchema })
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
    startCycle: z.number().int().min(1),
    cycles: z.number().int().min(1),
    /** The first day of its first cycle. */
    startDate: calendarDateSchema,
    /** The last day of its last cycle (T1'). */
    endDate: calendarDateSchema,
    endAction: termEndActionSchema,
    /** Detail only, for callers with money access (G3). */
    money: z
      .object({
        agreedTotalMinor: z.number().int().min(0),
        /** T6: Σ of its cycles' non-cancelled monthly, addition and credit charges. */
        currentTotalMinor: z.number().int(),
      })
      .optional(),
  })
  .meta({ id: 'RetainerTermSummary' });

export type RetainerTermSummary = z.infer<typeof retainerTermSummarySchema>;

/**
 * A cycle of a term: its `monthly` charge (C1). The invoice that bills it is on the retainer's
 * billing (`RetainerCharge`, money access), by `chargeId`.
 */
export const retainerTermCycleSchema = z
  .object({
    cycle: z.number().int().min(1),
    periodStart: calendarDateSchema,
    periodEnd: calendarDateSchema,
    /** 1…cycles. */
    position: z.number().int().min(1),
    /** Null when the cycle has no charge (a cancelled term's cycle that never had one). */
    chargeId: z.uuid().nullable(),
    status: retainerChargeStatusSchema.nullable(),
    /** The cycle began and its charge became due (C3). */
    due: z.boolean(),
    /** Present only for callers with money access (G3). */
    money: z
      .object({
        /** The cycle's `monthly` charge. */
        amountMinor: z.number().int().min(0),
        /** The schedule amount plus onward amendments (what a renewal copies, T7). */
        baseAmountMinor: z.number().int().min(0),
        /** Σ of the cycle's non-cancelled monthly, addition and credit charges (T6). */
        totalMinor: z.number().int(),
      })
      .optional(),
  })
  .meta({ id: 'RetainerTermCycle' });

export type RetainerTermCycle = z.infer<typeof retainerTermCycleSchema>;

export const retainerTermSchema = retainerTermSummarySchema
  .omit({ money: true })
  .extend({
    /** The term this one renews automatically (T7). */
    renewedFrom: z.object({ id: z.uuid(), number: z.number().int().min(1) }).nullable(),
    cancelledAt: z.iso.datetime().nullable(),
    cancelReason: z.string().nullable(),
    createdAt: z.iso.datetime(),
    money: retainerTermSummarySchema.shape.money,
    /** Its cycles in order, each with its `monthly` charge (T3). */
    schedule: z.array(retainerTermCycleSchema),
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
  /** F05B A7. */
  amendments: 300,
  amendmentLines: 20,
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
    author: personSchema,
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
    /** F05C Y1: counted from the retainer's start date. */
    number: z.number().int().min(1),
    /** The cycle's period; it starts later for a cycle started "now" and ends early on ending. */
    periodStart: calendarDateSchema,
    periodEnd: calendarDateSchema,
    status: cycleStatusSchema,
    /** F05C B3: recorded by the catch-up of a backdated retainer. */
    backdated: z.boolean(),
    /** F05C B4: a backdated cycle whose delivery was not recorded. */
    untracked: z.boolean(),
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
  description: 'Cycles, newest first',
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

// Amendments (spec F05B A1–A9, C5, C6)

export const AMENDMENT_KINDS = ['change', 'reschedule', 'quote_renewal'] as const;

export const amendmentKindSchema = z.enum(AMENDMENT_KINDS).meta({ id: 'AmendmentKind' });

export type AmendmentKind = z.infer<typeof amendmentKindSchema>;

/** F05C A1': this cycle only, or every cycle from the effective cycle on. */
export const AMENDMENT_SCOPES = ['cycle', 'onward'] as const;

export const amendmentScopeSchema = z.enum(AMENDMENT_SCOPES).meta({ id: 'AmendmentScope' });

export type AmendmentScope = z.infer<typeof amendmentScopeSchema>;

export const AMENDMENT_STATUSES = [
  'pending_approval',
  'scheduled',
  'applied',
  'rejected',
  'withdrawn',
  'cancelled',
] as const;

export const amendmentStatusSchema = z.enum(AMENDMENT_STATUSES).meta({ id: 'AmendmentStatus' });

export type AmendmentStatus = z.infer<typeof amendmentStatusSchema>;

/**
 * What an amendment does to a cycle (C6, A3): an amount not yet invoiced changes, a draft is
 * synced, an issued cycle gets an addition or a credit; an open-ended fee changes; a cycle that
 * began without a cycle row takes no line change.
 */
export const AMENDMENT_EFFECTS = [
  'charge_changed',
  'draft_synced',
  'addition',
  'credit',
  'fee_changed',
  'no_cycle',
] as const;

export const amendmentEffectKindSchema = z
  .enum(AMENDMENT_EFFECTS)
  .meta({ id: 'AmendmentEffectKind' });

export type AmendmentEffectKind = z.infer<typeof amendmentEffectKindSchema>;

/** A cycle's `monthly` charge as the planner reads it (C6). */
export interface CycleChargeState {
  cycle: number;
  /** The cycle's `monthly` charge; for a cycle without one, the amount it would be created at. */
  amountMinor: number;
  /** The live invoice that bills the charge. */
  invoice: { id: string; displayNumber: string | null; issued: boolean } | null;
  /** Σ of the cycle's other non-cancelled charges (additions, credits). */
  extrasMinor: number;
}

/** One cycle's outcome of an amount change; `before` and `after` are the cycle's totals. */
export interface CycleEffect {
  cycle: number;
  effect: Extract<AmendmentEffectKind, 'charge_changed' | 'draft_synced' | 'addition' | 'credit'>;
  beforeMinor: number;
  afterMinor: number;
  invoice: { id: string; displayNumber: string | null } | null;
}

/**
 * C6 and A3, the cycle-effect planner used by the preview and the apply: an amount change on a
 * cycle. A charge no live invoice bills changes; one on a draft changes and syncs the draft; one
 * on an issued invoice keeps its amount and the difference becomes an addition or a credit.
 * Returns null for no change and `'negative'` when the cycle's total, or a changed charge, would
 * go below 0 (`NEGATIVE_AMOUNT`).
 */
export function planCycleChange(
  state: CycleChargeState,
  deltaMinor: number,
): CycleEffect | 'negative' | null {
  if (deltaMinor === 0) return null;
  const beforeMinor = state.amountMinor + state.extrasMinor;
  const afterMinor = beforeMinor + deltaMinor;
  if (afterMinor < 0) return 'negative';
  const invoice = state.invoice
    ? { id: state.invoice.id, displayNumber: state.invoice.displayNumber }
    : null;
  if (state.invoice?.issued) {
    return {
      cycle: state.cycle,
      effect: deltaMinor > 0 ? 'addition' : 'credit',
      beforeMinor,
      afterMinor,
      invoice,
    };
  }
  if (state.amountMinor + deltaMinor < 0) return 'negative';
  return {
    cycle: state.cycle,
    effect: state.invoice ? 'draft_synced' : 'charge_changed',
    beforeMinor,
    afterMinor,
    invoice,
  };
}

/**
 * A4: Σ of the change over the cycles it affects; an open-ended fee change counts the delta
 * itself once.
 */
export function amendmentMoneyDelta(change: {
  amountDeltaMinor: number;
  cycles: number;
  changesFee: boolean;
}): number {
  return change.amountDeltaMinor * (change.cycles + (change.changesFee ? 1 : 0));
}

/** A4: a reduction waits for the General Manager unless its creator may approve it. */
export function amendmentNeedsApproval(moneyDeltaMinor: number, canApprove: boolean): boolean {
  return moneyDeltaMinor < 0 && !canApprove;
}

export interface CreditTaking {
  /** The credits on the draft with the part each gives (negative). */
  taken: { id: string; amountMinor: number }[];
  /** A credit larger than what was left: `appliedMinor` stays on it, the remainder is new. */
  split: { id: string; appliedMinor: number; remainderMinor: number } | null;
}

/**
 * C5: pending credits (negative, oldest first) taken off a cycle's draft of `totalMinor` while the
 * total stays ≥ 0; a credit larger than what is left is split.
 */
export function takeCredits(
  totalMinor: number,
  credits: readonly { id: string; amountMinor: number }[],
): CreditTaking {
  const taken: CreditTaking['taken'] = [];
  let left = totalMinor;
  for (const credit of credits) {
    if (left <= 0) break;
    if (left + credit.amountMinor >= 0) {
      taken.push({ id: credit.id, amountMinor: credit.amountMinor });
      left += credit.amountMinor;
      continue;
    }
    taken.push({ id: credit.id, amountMinor: -left });
    return {
      taken,
      split: { id: credit.id, appliedMinor: -left, remainderMinor: credit.amountMinor + left },
    };
  }
  return { taken, split: null };
}

const amendmentReasonSchema = z.string().trim().min(1).max(500);

/** A2: a line change; a line not on the retainer needs a delta > 0 (`INVALID_QUANTITY`). */
export const amendmentLineInputSchema = z
  .object({
    kind: deliverableKindSchema,
    label: deliverableLabelSchema.optional(),
    quantityDelta: z
      .number()
      .int()
      .min(-999)
      .max(999)
      .refine((delta) => delta !== 0, 'The change cannot be zero'),
    /** For a new line only. */
    revisionLimit: revisionLimitSchema.optional(),
  })
  .refine(labelRequiredForOther, labelRule)
  .meta({ id: 'AmendmentLineInput' });

export type AmendmentLineInput = z.infer<typeof amendmentLineInputSchema>;

/**
 * A1–A3, F05C A1': the effective cycle is the current cycle or later, placed against the terms by
 * the API (`INVALID_EFFECTIVE_CYCLE`); at least one line or a non-zero amount (`EMPTY_AMENDMENT`).
 */
export const createAmendmentSchema = z
  .object({
    scope: amendmentScopeSchema,
    effectiveCycle: cycleNumberSchema,
    lines: z.array(amendmentLineInputSchema).max(RETAINER_LIMITS.amendmentLines).default([]),
    /** The change to each affected cycle; money field. */
    amountDeltaMinor: signedMinorAmountSchema.default(0),
    reason: amendmentReasonSchema,
  })
  .meta({ id: 'CreateAmendment' });

export type CreateAmendment = z.infer<typeof createAmendmentSchema>;

export type CreateAmendmentInput = z.input<typeof createAmendmentSchema>;

/** A6: new amounts for cycles of a term that no issued invoice bills, with the same sum. */
export const rescheduleTermSchema = z
  .object({
    schedule: z
      .array(z.object({ cycle: cycleNumberSchema, amountMinor: minorAmountSchema }))
      .min(1)
      .max(TERM_LIMITS.maxCycles),
    reason: amendmentReasonSchema,
  })
  .meta({ id: 'RescheduleTerm' });

export type RescheduleTerm = z.infer<typeof rescheduleTermSchema>;

export const approveAmendmentSchema = z
  .object({ note: z.string().trim().max(500).optional() })
  .meta({ id: 'ApproveAmendment' });

export type ApproveAmendment = z.infer<typeof approveAmendmentSchema>;

/** A4: rejecting needs a note. */
export const rejectAmendmentSchema = z
  .object({ note: z.string().trim().min(1).max(500) })
  .meta({ id: 'RejectAmendment' });

export type RejectAmendment = z.infer<typeof rejectAmendmentSchema>;

export const amendmentLineSchema = z
  .object({
    kind: deliverableKindSchema,
    label: z.string().nullable(),
    /** `change`: the change to the line. */
    quantityDelta: z.number().int().nullable(),
    /** `quote_renewal`: the line's new monthly quantity. */
    quantity: z.number().int().nullable(),
    revisionLimit: z.number().int().min(0).nullable(),
    position: z.number().int().min(1),
  })
  .meta({ id: 'AmendmentLine' });

export type AmendmentLine = z.infer<typeof amendmentLineSchema>;

export const amendmentEffectSchema = z
  .object({
    cycle: z.number().int().min(1),
    periodStart: calendarDateSchema,
    periodEnd: calendarDateSchema,
    effect: amendmentEffectKindSchema,
    /** The invoice that billed the cycle: the synced draft, or the issued one. */
    invoice: z.object({ id: z.uuid(), displayNumber: z.string().nullable() }).nullable(),
    /** The cycle's total (or the fee) before and after; money access only (G3). */
    money: z.object({ beforeMinor: z.number().int(), afterMinor: z.number().int() }).optional(),
  })
  .meta({ id: 'AmendmentEffect' });

export type AmendmentEffect = z.infer<typeof amendmentEffectSchema>;

const amendmentPersonSchema = z.object({ id: z.uuid(), name: z.string() });

export const amendmentSchema = z
  .object({
    id: z.uuid(),
    retainerId: z.uuid(),
    number: z.number().int().min(1),
    kind: amendmentKindSchema,
    /** Null for a reschedule. */
    scope: amendmentScopeSchema.nullable(),
    effectiveCycle: z.number().int().min(1),
    /** The effective cycle's first day. */
    effectiveDate: calendarDateSchema,
    status: amendmentStatusSchema,
    reason: z.string(),
    lines: z.array(amendmentLineSchema),
    /** Null for a system amendment (quote renewal). */
    createdBy: personSchema.nullable(),
    createdAt: z.iso.datetime(),
    decision: z
      .object({
        approved: z.boolean(),
        by: personSchema,
        at: z.iso.datetime(),
        note: z.string().nullable(),
      })
      .nullable(),
    appliedAt: z.iso.datetime().nullable(),
    /** What it did when applied; while pending or scheduled, what it would do (its preview). */
    effects: z.array(amendmentEffectSchema),
    /** Present only for callers with money access (G3). */
    money: z
      .object({
        amountDeltaMinor: z.number().int(),
        /** A4: Σ of the change over the cycles it affects, when created. */
        moneyDeltaMinor: z.number().int(),
        /** `reschedule`: the new amounts. */
        schedule: z
          .array(z.object({ cycle: z.number().int().min(1), amountMinor: z.number().int() }))
          .nullable(),
      })
      .optional(),
  })
  .meta({ id: 'Amendment' });

export type Amendment = z.infer<typeof amendmentSchema>;

/** `POST /amendments/preview`: what saving would do; nothing is saved. */
export const amendmentPreviewSchema = z
  .object({
    cycles: z.array(amendmentEffectSchema),
    moneyDeltaMinor: z.number().int(),
    needsApproval: z.boolean(),
  })
  .meta({ id: 'AmendmentPreview' });

export type AmendmentPreview = z.infer<typeof amendmentPreviewSchema>;

export const amendmentListQuerySchema = pageQuerySchema.extend({
  status: queryListSchema(amendmentStatusSchema).optional(),
});

export type AmendmentListQuery = z.infer<typeof amendmentListQuerySchema>;

/** Newest first. */
export const amendmentPageSchema = pageSchema(amendmentSchema).meta({ id: 'AmendmentPage' });

export type AmendmentPage = z.infer<typeof amendmentPageSchema>;

/** `GET /api/retainer-amendments`: amendments waiting for the General Manager, oldest first. */
export const pendingAmendmentListQuerySchema = pageQuerySchema.extend({
  status: z.literal('pending_approval').default('pending_approval'),
});

export type PendingAmendmentListQuery = z.infer<typeof pendingAmendmentListQuerySchema>;

export const retainerAmendmentSchema = amendmentSchema
  .extend({
    retainer: amendmentPersonSchema.extend({ currency: currencySchema }),
    client: clientRefSchema,
  })
  .meta({ id: 'RetainerAmendment' });

export type RetainerAmendment = z.infer<typeof retainerAmendmentSchema>;

export const retainerAmendmentPageSchema = pageSchema(retainerAmendmentSchema).meta({
  id: 'RetainerAmendmentPage',
});

export type RetainerAmendmentPage = z.infer<typeof retainerAmendmentPageSchema>;
// Retainers

const retainerFieldsSchema = z.object({
  name: projectNameSchema,
  departments: engagementDepartmentsSchema,
  /** F05C Y1: the anchor of every cycle. */
  startDate: calendarDateSchema,
  /** Money field: sent only by callers with money access; `USD` when left out. */
  currency: currencySchema,
  /** Money field. */
  monthlyFeeMinor: minorAmountSchema.nullable(),
});

// Backdated start (spec F05C B1–B5)

/** B1: how far back a new retainer may start, and so the most past cycles a catch-up holds. */
export const BACKDATE_LIMIT_MONTHS = 12;

export const CATCH_UP_BILLINGS = ['billed_externally', 'draft_now'] as const;

export const catchUpBillingSchema = z.enum(CATCH_UP_BILLINGS).meta({ id: 'CatchUpBilling' });

export type CatchUpBilling = z.infer<typeof catchUpBillingSchema>;

export const CATCH_UP_DELIVERIES = ['untracked', 'entered'] as const;

export const catchUpDeliverySchema = z.enum(CATCH_UP_DELIVERIES).meta({ id: 'CatchUpDelivery' });

export type CatchUpDelivery = z.infer<typeof catchUpDeliverySchema>;

/**
 * One past cycle of a backdated retainer (B3, B4). `delivered` holds one count per deliverable
 * line of the request, in order, and only with `entered` delivery.
 */
export const catchUpEntrySchema = z
  .object({
    cycle: cycleNumberSchema,
    billing: catchUpBillingSchema.default('billed_externally'),
    delivery: catchUpDeliverySchema.default('untracked'),
    delivered: z
      .array(z.number().int().min(0).max(999))
      .max(RETAINER_LIMITS.deliverables)
      .optional(),
  })
  .refine((entry) => (entry.delivery === 'entered') === (entry.delivered !== undefined), {
    message: 'Delivered counts come with "entered" delivery only',
    path: ['delivered'],
  })
  .meta({ id: 'CatchUpEntry' });

export type CatchUpEntry = z.infer<typeof catchUpEntrySchema>;

export type CatchUpEntryInput = z.input<typeof catchUpEntrySchema>;

/**
 * B2: the catch-up names each past cycle `1 … pastCycles` once, in any order, and an `entered`
 * entry counts every deliverable line (`CATCH_UP_REQUIRED` otherwise). Without past cycles it is
 * empty.
 */
export function catchUpComplete(
  entries: readonly Pick<CatchUpEntry, 'cycle' | 'delivered'>[],
  pastCycles: number,
  lineCount: number,
): boolean {
  if (entries.length !== pastCycles) return false;
  const cycles = new Set(entries.map((entry) => entry.cycle));
  if (cycles.size !== pastCycles) return false;
  for (let cycle = 1; cycle <= pastCycles; cycle += 1) if (!cycles.has(cycle)) return false;
  return entries.every((entry) => !entry.delivered || entry.delivered.length === lineCount);
}

/**
 * The start date's range is checked by the API: from today − 12 months (`INVALID_DATES`, B1).
 * A start date before the current cycle needs `catchUp` (B2, money access). A `term` starts at the
 * retainer's current cycle (its first one when the start date is today or later), or at cycle 1
 * of a backdated retainer (B5), and sets the renewal date (F05C T3'). The renewal date is derived
 * and never sent (strict: 400).
 */
export const createRetainerSchema = retainerFieldsSchema
  .extend({
    clientId: z.uuid(),
    /** At most `RETAINER_LIMITS.deliverables`; the API answers `LIMIT_REACHED`. */
    deliverables: z.array(newDeliverableLineSchema).default([]),
    /** Money field (F05B). */
    term: retainerTermInputSchema.optional(),
    /** B2: one entry per past cycle; money field. */
    catchUp: z.array(catchUpEntrySchema).max(BACKDATE_LIMIT_MONTHS).optional(),
  })
  .partial({ currency: true, monthlyFeeMinor: true })
  .strict()
  .meta({ id: 'CreateRetainer' });

export type CreateRetainer = z.infer<typeof createRetainerSchema>;

export type CreateRetainerInput = z.input<typeof createRetainerSchema>;

/**
 * `currency` and `monthlyFeeMinor` need money access; `startDate` only while the retainer has no
 * cycle and no charge (`RETAINER_STARTED`). Strict: a `renewalDate` is refused (400).
 */
export const updateRetainerSchema = retainerFieldsSchema
  .partial()
  .strict()
  .meta({ id: 'UpdateRetainer' });

export type UpdateRetainer = z.infer<typeof updateRetainerSchema>;

export type UpdateRetainerInput = z.input<typeof updateRetainerSchema>;

export const retainerStatusChangeSchema = z
  .object({
    status: retainerStatusSchema,
    /** `ended` only (F05B E2); money field. */
    termination: retainerTerminationSchema.optional(),
    /**
     * F05C P2, P4: resuming or reactivating an open-ended retainer whose current cycle has no
     * cycle yet starts a full cycle now; otherwise it starts at the next cycle.
     */
    startNow: z.boolean().optional(),
  })
  .meta({ id: 'RetainerStatusChange' });

export type RetainerStatusChange = z.infer<typeof retainerStatusChangeSchema>;

/** F05C Y6: the open cycle as the header shows it ("cycle 3 of 6 · … · 6 days left"). */
export const currentCycleSchema = cycleSchema
  .extend({
    /** Days left in its period, today included. */
    daysLeft: z.number().int().min(0),
    /** Its position in the term that covers it (k of N); null without a term. */
    termPosition: z.number().int().min(1).nullable(),
    termCycles: z.number().int().min(1).nullable(),
  })
  .meta({ id: 'CurrentCycle' });

export type CurrentCycle = z.infer<typeof currentCycleSchema>;

export const retainerSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    client: clientRefSchema,
    /** The effective image (F01C rule 3): its own, else the client's logo; null for the initial. */
    imageId: z.uuid().nullable(),
    /** The client's account manager, who is responsible for the retainer. */
    accountManager: personSchema,
    departments: z.array(departmentCodeSchema),
    status: retainerStatusSchema,
    /** With an active or scheduled term, the day after its last term (F05C T3'). */
    renewalDate: calendarDateSchema.nullable(),
    renewal: renewalStateSchema.nullable(),
    /** The active term, else the scheduled one (F05B). */
    term: retainerTermSummarySchema.nullable(),
    /** Amendments waiting for the General Manager (F05B A4). */
    pendingAmendments: z.number().int().min(0),
    /** The newest open cycle, or null (paused across a cycle, ended, not started). */
    currentCycle: currentCycleSchema.nullable(),
    /**
     * F05C Y6: when the next cycle opens, for a retainer without an open cycle that will open one
     * (paused, resumed "from the next cycle", not started yet); null otherwise.
     */
    nextCycleStart: calendarDateSchema.nullable(),
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
    /** Its own image (F01C); null when it shows the client's logo or its initial. */
    ownImageId: z.uuid().nullable(),
    startDate: calendarDateSchema,
    endedOn: calendarDateSchema.nullable(),
    /** Non-archived standing lines, by position. */
    deliverables: z.array(deliverableLineSchema),
    archivedAt: z.iso.datetime().nullable(),
    /** Present only for callers with money access. */
    money: z
      .object({
        currency: currencySchema,
        monthlyFeeMinor: z.number().int().min(0).nullable(),
        /** F05B C9: pending credits owed to the client, as a positive amount. */
        creditPendingMinor: z.number().int().min(0),
      })
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
  /** `true`: with amendments waiting for the General Manager (F05B A4). */
  pendingApproval: queryBooleanSchema.optional(),
  /** `true` lists archived retainers only; needs `projects.manage` with scope all. */
  archived: queryBooleanSchema.default(false),
  sort: z.enum(RETAINER_SORTS).default('clientName'),
  order: sortOrderSchema.default('asc'),
});

export type RetainerListQuery = z.infer<typeof retainerListQuerySchema>;

export const retainerPageSchema = pageSchema(retainerSchema).meta({ id: 'RetainerPage' });

export type RetainerPage = z.infer<typeof retainerPageSchema>;
