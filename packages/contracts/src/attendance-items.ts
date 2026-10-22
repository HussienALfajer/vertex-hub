import { z } from 'zod';
import {
  type AttendanceDayStatus,
  attendanceDaySchema,
  type DayPhase,
  punchMethodSchema,
} from './attendance.js';
import {
  type CalendarDate,
  calendarDateSchema,
  calendarMonthSchema,
  instantSchema,
} from './dates.js';
import {
  floorHalfDay,
  hrOpinionSchema,
  LATENESS_FRACTIONS,
  type LatenessTier,
  personRefSchema,
} from './hr.js';
import { pageQuerySchema, pageSchema, queryListSchema, sortOrderSchema } from './lists.js';
import { optionalText } from './text.js';

/*
 * HR attendance decisions (spec F17 part C, rules C12, C14, C17–C19): the items a day raises for
 * the General Manager to decide, the employee's justification, the Today board and the review of
 * field punches.
 */

export const ATTENDANCE_ITEM_KINDS = [
  'lateness',
  'early_leave',
  'absence',
  'missing_out',
  'overtime',
] as const;

export const attendanceItemKindSchema = z
  .enum(ATTENDANCE_ITEM_KINDS)
  .meta({ id: 'AttendanceItemKind' });

export type AttendanceItemKind = z.infer<typeof attendanceItemKindSchema>;

/** The decisions of rule C18. */
export const ITEM_DECISIONS = [
  'deducted',
  'waived',
  'warned',
  'paid',
  'time_off',
  'rejected',
] as const;

export const itemDecisionSchema = z.enum(ITEM_DECISIONS).meta({ id: 'ItemDecision' });

export type ItemDecision = z.infer<typeof itemDecisionSchema>;

/** An item waits (`pending`), is decided, or no longer applies (`void`, rule C14). */
export const ATTENDANCE_ITEM_STATUSES = ['pending', ...ITEM_DECISIONS, 'void'] as const;

export const attendanceItemStatusSchema = z
  .enum(ATTENDANCE_ITEM_STATUSES)
  .meta({ id: 'AttendanceItemStatus' });

export type AttendanceItemStatus = z.infer<typeof attendanceItemStatusSchema>;

/** Rule C18: the decisions each kind takes. */
export const ITEM_DECISIONS_BY_KIND: Record<AttendanceItemKind, readonly ItemDecision[]> = {
  lateness: ['deducted', 'waived', 'warned'],
  early_leave: ['deducted', 'waived', 'warned'],
  absence: ['deducted', 'waived', 'warned'],
  missing_out: ['waived', 'deducted'],
  overtime: ['paid', 'time_off', 'rejected'],
};

export const ATTENDANCE_ITEM_LIMITS = { justification: 500, note: 500 } as const;

/** Rule C17: the fraction of the first tier covering `minutes`. */
export function tierFraction(minutes: number, tiers: readonly LatenessTier[]): number {
  return (
    tiers.find((tier) => tier.upToMinutes === null || minutes <= tier.upToMinutes)?.fraction ?? 1
  );
}

/** A computed day, as rule C17 reads it. */
export interface ItemsInput {
  phase: DayPhase;
  /** Rule C1: before the start date nothing is raised. */
  trial: boolean;
  status: AttendanceDayStatus;
  lateMinutes: number;
  earlyMinutes: number;
  overtimeMinutes: number;
  missingOut: boolean;
}

export interface RaisedItem {
  kind: AttendanceItemKind;
  minutes: number;
}

/**
 * Rules C14 and C17: the items a day raises as it stands: lateness from the first check-in, early
 * leave from a closed check-out (replaced if the employee checks in again), and absence, missing
 * out and overtime once the day has ended.
 */
export function dayItems(day: ItemsInput): RaisedItem[] {
  if (day.trial || day.phase === 'before') return [];
  const items: RaisedItem[] = [];
  if (day.lateMinutes > 0) items.push({ kind: 'lateness', minutes: day.lateMinutes });
  if (day.earlyMinutes > 0) items.push({ kind: 'early_leave', minutes: day.earlyMinutes });
  if (day.phase === 'after') {
    if (day.status === 'absent') items.push({ kind: 'absence', minutes: 0 });
    if (day.missingOut) items.push({ kind: 'missing_out', minutes: 0 });
    if (day.overtimeMinutes > 0) items.push({ kind: 'overtime', minutes: day.overtimeMinutes });
  }
  return items;
}

/**
 * Rule C17: the fraction proposed to the General Manager. Lateness and early leave by the tiers,
 * the first lateness of the month as a warning (0) when the setting says so; absence a whole day,
 * or half of one beside a half-day leave; missing out and overtime nothing.
 */
export function proposedFraction(
  item: RaisedItem,
  context: {
    tiers: readonly LatenessTier[];
    firstLatenessWarning: boolean;
    /** No other live lateness of the user earlier in the month. */
    firstLatenessOfMonth: boolean;
    halfDayLeave: boolean;
  },
): number {
  switch (item.kind) {
    case 'lateness':
      return context.firstLatenessWarning && context.firstLatenessOfMonth
        ? 0
        : tierFraction(item.minutes, context.tiers);
    case 'early_leave':
      return tierFraction(item.minutes, context.tiers);
    case 'absence':
      return context.halfDayLeave ? 0.5 : 1;
    default:
      return 0;
  }
}

/** Rule C18: overtime taken as time off, in annual leave days rounded down to a half day. */
export function overtimeCreditDays(minutes: number, minutesPerLeaveDay: number): number {
  return floorHalfDay(minutes / minutesPerLeaveDay);
}

/** Rule C18: an item's decision; `fraction` and `minutes` only where the decision takes them. */
export const decideItemSchema = z
  .object({
    decision: itemDecisionSchema,
    /** `deducted`: the fraction of a day; the proposal when left out. */
    fraction: z.literal(LATENESS_FRACTIONS).optional(),
    /** `paid` and `time_off`: at most the item's minutes; all of them when left out. */
    minutes: z.number().int().min(1).optional(),
    note: optionalText(ATTENDANCE_ITEM_LIMITS.note).default(null),
  })
  .meta({ id: 'DecideItem' });

export type DecideItem = z.infer<typeof decideItemSchema>;

export type DecideItemInput = z.input<typeof decideItemSchema>;

export interface ItemOutcome {
  status: ItemDecision;
  decidedFraction: number | null;
  decidedMinutes: number | null;
}

/**
 * Rule C18: what a decision makes of an item, or null when it does not fit (`INVALID_DECISION`):
 * a decision the kind does not take, a fraction or minutes it does not take, a deduction without
 * a fraction and no proposal to fall back on, or more minutes than the item has.
 */
export function itemOutcome(
  item: { kind: AttendanceItemKind; minutes: number; proposedFraction: number },
  input: Pick<DecideItem, 'decision' | 'fraction' | 'minutes'>,
): ItemOutcome | null {
  if (!ITEM_DECISIONS_BY_KIND[item.kind].includes(input.decision)) return null;
  const deducted = input.decision === 'deducted';
  const timed = input.decision === 'paid' || input.decision === 'time_off';
  if ((input.fraction !== undefined && !deducted) || (input.minutes !== undefined && !timed)) {
    return null;
  }
  if (deducted) {
    const fraction = input.fraction ?? (item.proposedFraction > 0 ? item.proposedFraction : null);
    if (fraction === null) return null;
    return { status: 'deducted', decidedFraction: fraction, decidedMinutes: null };
  }
  if (timed) {
    const minutes = input.minutes ?? item.minutes;
    if (minutes > item.minutes) return null;
    return { status: input.decision, decidedFraction: null, decidedMinutes: minutes };
  }
  return { status: input.decision, decidedFraction: null, decidedMinutes: null };
}

export const attendanceItemSchema = z
  .object({
    id: z.uuid(),
    user: personRefSchema,
    dayId: z.uuid(),
    date: calendarDateSchema,
    kind: attendanceItemKindSchema,
    /** Late, early or overtime minutes; 0 for absence and missing out. */
    minutes: z.number().int(),
    proposedFraction: z.number(),
    justification: z.string().nullable(),
    justifiedAt: instantSchema.nullable(),
    status: attendanceItemStatusSchema,
    /** `deducted` only. */
    decidedFraction: z.number().nullable(),
    /** `paid` and `time_off` only. */
    decidedMinutes: z.number().int().nullable(),
    /** `time_off` only: the days added to the annual balance. */
    creditedDays: z.number().nullable(),
    decidedBy: personRefSchema.nullable(),
    decidedAt: instantSchema.nullable(),
    decisionNote: z.string().nullable(),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .meta({ id: 'AttendanceItem' });

export type AttendanceItem = z.infer<typeof attendanceItemSchema>;

export const attendanceItemListQuerySchema = pageQuerySchema.extend({
  status: queryListSchema(attendanceItemStatusSchema).optional(),
  kind: attendanceItemKindSchema.optional(),
  /** `me` for one's own; others' items need `hr.read` covering them. */
  userId: z.union([z.uuid(), z.literal('me')]).optional(),
  departmentId: z.uuid().optional(),
  /** Items of days in this month. */
  month: calendarMonthSchema.optional(),
  /** By the day's date: oldest first for the approvals inbox, newest first by default. */
  order: sortOrderSchema.default('desc'),
});

export type AttendanceItemListQuery = z.infer<typeof attendanceItemListQuerySchema>;

export type AttendanceItemListQueryInput = z.input<typeof attendanceItemListQuerySchema>;

export const attendanceItemPageSchema = pageSchema(attendanceItemSchema).meta({
  id: 'AttendanceItemPage',
  description: 'Items by the date of their day',
});

export type AttendanceItemPage = z.infer<typeof attendanceItemPageSchema>;

export const attendanceItemPermissionsSchema = z
  .object({
    /** `hr.approve`, on an item that is not void. */
    canDecide: z.boolean(),
    /** The employee, on a pending item. */
    canJustify: z.boolean(),
    /** `hr.read` covering the employee, on someone else's pending item. */
    canGiveOpinion: z.boolean(),
  })
  .meta({ id: 'AttendanceItemPermissions', description: 'What the caller may do, for the UI' });

export type AttendanceItemPermissions = z.infer<typeof attendanceItemPermissionsSchema>;

/** An item with the day's timeline and the opinions on it (Approvals). */
export const attendanceItemDetailSchema = attendanceItemSchema
  .extend({
    day: attendanceDaySchema,
    /** Oldest first. */
    opinions: z.array(hrOpinionSchema),
    permissions: attendanceItemPermissionsSchema,
  })
  .meta({ id: 'AttendanceItemDetail' });

export type AttendanceItemDetail = z.infer<typeof attendanceItemDetailSchema>;

/** Rule C17: the employee's reason, until the item is decided. */
export const justifyItemSchema = z
  .object({ text: z.string().trim().min(1).max(ATTENDANCE_ITEM_LIMITS.justification) })
  .meta({ id: 'JustifyItem' });

export type JustifyItem = z.infer<typeof justifyItemSchema>;

/** Rule C12: rejecting a field or shoot punch needs a note. */
export const rejectPunchSchema = z
  .object({ note: z.string().trim().min(1).max(ATTENDANCE_ITEM_LIMITS.note) })
  .meta({ id: 'RejectPunch' });

export type RejectPunch = z.infer<typeof rejectPunchSchema>;

/*
 * The Today board (spec, Screens): who is in, late, not yet in, on leave, remote, in the field or
 * on a shoot, exempt or without a passkey, and the refused office punches of the day.
 */

/** Where a user stands today; `late`, the place and the passkey are told apart beside it. */
export const TODAY_STATES = [
  'in',
  'out',
  'not_in',
  'on_leave',
  'holiday',
  'off',
  'exempt',
] as const;

export const todayStateSchema = z.enum(TODAY_STATES).meta({ id: 'TodayState' });

export type TodayState = z.infer<typeof todayStateSchema>;

export const todayBoardQuerySchema = z.object({ departmentId: z.uuid().optional() });

export type TodayBoardQuery = z.infer<typeof todayBoardQuerySchema>;

export const todayBoardRowSchema = z
  .object({
    user: personRefSchema,
    state: todayStateSchema,
    late: z.boolean(),
    /** The method of the last live punch today: office, remote, field, shoot or correction. */
    method: punchMethodSchema.nullable(),
    /** Rule C10: no active passkey, so no punch. */
    noPasskey: z.boolean(),
    /** Null when attendance does not apply today. */
    day: attendanceDaySchema.nullable(),
  })
  .meta({ id: 'TodayBoardRow' });

export type TodayBoardRow = z.infer<typeof todayBoardRowSchema>;

export const PUNCH_REFUSALS = ['INVALID_CODE', 'OFF_OFFICE_NETWORK'] as const;

/** Rule C6: an office punch refused today, from the audit. */
export const punchRefusalSchema = z
  .object({
    user: personRefSchema,
    at: instantSchema,
    reason: z.enum(PUNCH_REFUSALS),
    ipAddress: z.string().nullable(),
  })
  .meta({ id: 'PunchRefusal' });

export type PunchRefusal = z.infer<typeof punchRefusalSchema>;

export const todayBoardSchema = z
  .object({
    date: calendarDateSchema,
    /** By name. */
    rows: z.array(todayBoardRowSchema),
    /** Newest first. */
    refusals: z.array(punchRefusalSchema),
  })
  .meta({ id: 'TodayBoard' });

export type TodayBoard = z.infer<typeof todayBoardSchema>;

/**
 * The subject id of the General Managers' notices that merge per day (`attendance_items_pending`,
 * `field_punch_recorded`): a fixed id for each date, so one day's notices share a row.
 */
export function attendanceDateSubjectId(date: CalendarDate): string {
  return `00000000-0000-7000-8000-0000${date.replaceAll('-', '')}`;
}
