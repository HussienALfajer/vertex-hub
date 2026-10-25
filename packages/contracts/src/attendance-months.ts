import { z } from 'zod';
import {
  type AttendanceDayKind,
  type AttendanceDayStatus,
  type AttendancePlace,
  attendanceDaySchema,
  type DayLeave,
} from './attendance.js';
import type { AttendanceItemKind, AttendanceItemStatus } from './attendance-items.js';
import {
  addMonths,
  type CalendarDate,
  calendarDateSchema,
  calendarMonthSchema,
  instantSchema,
  lastOfMonth,
} from './dates.js';
import { LEAVE_TYPES, type LeaveType, type LeaveUnit, sumDays } from './hr.js';
import { personSchema } from './images.js';

/*
 * HR attendance months (spec F17 part D, rules D1–D5): the month sheet, closing a month with its
 * frozen summary for F19, and reopening it.
 */

export const ATTENDANCE_MONTH_STATUSES = ['open', 'closed'] as const;

export const attendanceMonthStatusSchema = z
  .enum(ATTENDANCE_MONTH_STATUSES)
  .meta({ id: 'AttendanceMonthStatus' });

export type AttendanceMonthStatus = z.infer<typeof attendanceMonthStatusSchema>;

export const ATTENDANCE_MONTH_LIMITS = { reopenReason: 500 } as const;

/** A month never closed is `open`, without a closing or a reopening. */
export const attendanceMonthSchema = z
  .object({
    month: calendarMonthSchema,
    status: attendanceMonthStatusSchema,
    closedBy: personSchema.nullable(),
    closedAt: instantSchema.nullable(),
    /** The last reopening, kept after the month is closed again. */
    reopenedBy: personSchema.nullable(),
    reopenedAt: instantSchema.nullable(),
    reopenReason: z.string().nullable(),
  })
  .meta({ id: 'AttendanceMonth' });

export type AttendanceMonth = z.infer<typeof attendanceMonthSchema>;

/** Rule D4: reopening needs a reason. */
export const reopenMonthSchema = z
  .object({ reason: z.string().trim().min(1).max(ATTENDANCE_MONTH_LIMITS.reopenReason) })
  .meta({ id: 'ReopenMonth' });

export type ReopenMonth = z.infer<typeof reopenMonthSchema>;

/** The first and last date of a month. */
export function monthRange(month: string): { from: CalendarDate; to: CalendarDate } {
  const from = `${month}-01`;
  return { from, to: lastOfMonth(from) };
}

/** The months a date range touches, in order. */
export function monthsOf(from: CalendarDate, to: CalendarDate): string[] {
  const months: string[] = [];
  for (let date = `${from.slice(0, 7)}-01`; date <= to; date = addMonths(date, 1)) {
    months.push(date.slice(0, 7));
  }
  return months;
}

/** Rule D2: a month may be closed once its last day has passed. */
export function monthEnded(month: string, today: CalendarDate): boolean {
  return monthRange(month).to < today;
}

/** Rule D3: an employee's month, as F19 reads it. Days are counted in halves where leave is. */
export const attendanceMonthTotalsSchema = z
  .object({
    workDays: z.number().int(),
    presentDays: z.number().int(),
    remoteDays: z.number().int(),
    fieldDays: z.number().int(),
    /** Half a day beside a half-day leave. */
    absentDays: z.number(),
    leaveDays: z.record(z.enum(LEAVE_TYPES), z.number()),
    /** Unpaid leave and the unpaid overflow of sick and emergency leave (rule B12). */
    unpaidLeaveDays: z.number(),
    holidayDays: z.number().int(),
    lateCount: z.number().int(),
    /** The fractions of a day of the deducted items. */
    deductedDays: z.number(),
    overtimePaidMinutes: z.number().int(),
    overtimeTimeOffMinutes: z.number().int(),
    workedMinutes: z.number().int(),
  })
  .meta({ id: 'AttendanceMonthTotals' });

export type AttendanceMonthTotals = z.infer<typeof attendanceMonthTotalsSchema>;

/** A day of the month as the totals read it. */
export interface TotalsDay {
  kind: AttendanceDayKind;
  status: AttendanceDayStatus;
  place: AttendancePlace | null;
  leave: DayLeave;
  checkedIn: boolean;
  workedMinutes: number;
  /** A live field or shoot punch on the day. */
  field: boolean;
}

/** A day of approved leave in the month, with its unpaid part. */
export interface TotalsLeave {
  leaveType: LeaveType;
  days: number;
  unpaidDays: number;
}

export interface TotalsItem {
  kind: AttendanceItemKind;
  status: AttendanceItemStatus;
  decidedFraction: number | null;
  decidedMinutes: number | null;
}

/** Rule D3: the totals of an employee's month from its live days, leave and items. */
export function monthTotals(
  days: readonly TotalsDay[],
  leaves: readonly TotalsLeave[],
  items: readonly TotalsItem[],
): AttendanceMonthTotals {
  const count = (test: (day: TotalsDay) => boolean) => days.filter(test).length;
  const present = (day: TotalsDay) => day.kind === 'work' && day.checkedIn;
  const leaveDays = Object.fromEntries(
    LEAVE_TYPES.map((type) => [
      type,
      sumDays(leaves.filter((leave) => leave.leaveType === type).map((leave) => leave.days)),
    ]),
  ) as Record<LeaveType, number>;
  const decided = (status: AttendanceItemStatus) => items.filter((item) => item.status === status);
  return {
    workDays: count((day) => day.kind === 'work'),
    presentDays: count(present),
    remoteDays: count((day) => present(day) && day.place === 'remote'),
    fieldDays: count((day) => day.field),
    absentDays: sumDays(
      days.filter((day) => day.status === 'absent').map((day) => (day.leave === 'none' ? 1 : 0.5)),
    ),
    leaveDays,
    unpaidLeaveDays: sumDays(leaves.map((leave) => leave.unpaidDays)),
    holidayDays: count((day) => day.kind === 'holiday'),
    lateCount: items.filter((item) => item.kind === 'lateness' && item.status !== 'void').length,
    deductedDays:
      Math.round(
        decided('deducted').reduce((sum, item) => sum + (item.decidedFraction ?? 0), 0) * 100,
      ) / 100,
    overtimePaidMinutes: decided('paid').reduce((sum, item) => sum + (item.decidedMinutes ?? 0), 0),
    overtimeTimeOffMinutes: decided('time_off').reduce(
      (sum, item) => sum + (item.decidedMinutes ?? 0),
      0,
    ),
    workedMinutes: days.reduce((sum, day) => sum + day.workedMinutes, 0),
  };
}

/**
 * Rule B12 per day: the first `paidDays` of a leave's units are paid, the rest unpaid, so the
 * month a day falls in carries its own part.
 */
export function leaveUnitsPay(
  units: readonly LeaveUnit[],
  paidDays: number,
): { date: CalendarDate; days: number; unpaidDays: number }[] {
  let left = paidDays;
  return units.map((unit) => {
    const paid = Math.min(unit.days, left);
    left = sumDays([left, -paid]);
    return { date: unit.date, days: unit.days, unpaidDays: sumDays([unit.days, -paid]) };
  });
}

/** A cell of the month sheet. */
export const monthSheetDaySchema = attendanceDaySchema
  .pick({
    date: true,
    kind: true,
    status: true,
    place: true,
    leave: true,
    workedMinutes: true,
    lateMinutes: true,
    earlyMinutes: true,
    overtimeMinutes: true,
  })
  .extend({
    /** A live field or shoot punch on the day. */
    field: z.boolean(),
    /** Items of the day still to decide. */
    pendingItems: z.number().int(),
  })
  .meta({ id: 'MonthSheetDay' });

export type MonthSheetDay = z.infer<typeof monthSheetDaySchema>;

export const monthSheetRowSchema = z
  .object({
    user: personSchema,
    /** The employee's days in the month, by date. */
    days: z.array(monthSheetDaySchema),
    /** The frozen summary once the month is closed, the live totals while it is open. */
    totals: attendanceMonthTotalsSchema,
    /** Requests touching the month and items of its days, still pending (rule D1). */
    pendingRequests: z.number().int(),
    pendingItems: z.number().int(),
  })
  .meta({ id: 'MonthSheetRow' });

export type MonthSheetRow = z.infer<typeof monthSheetRowSchema>;

export const monthSheetQuerySchema = z.object({ departmentId: z.uuid().optional() });

export type MonthSheetQuery = z.infer<typeof monthSheetQuerySchema>;

export const monthSheetSchema = z
  .object({
    month: attendanceMonthSchema,
    from: calendarDateSchema,
    to: calendarDateSchema,
    /** Employees with a day in the month, by name. */
    rows: z.array(monthSheetRowSchema),
  })
  .meta({ id: 'MonthSheet' });

export type MonthSheet = z.infer<typeof monthSheetSchema>;

/** Rule D2: what keeps a month from closing, in the `MONTH_HAS_PENDING` error's details. */
export const monthPendingSchema = z
  .object({
    kind: z.enum(['request', 'item']),
    id: z.uuid(),
    user: personSchema,
    /** The request's first day, or the item's day. */
    date: calendarDateSchema,
  })
  .meta({ id: 'MonthPending' });

export type MonthPending = z.infer<typeof monthPendingSchema>;
