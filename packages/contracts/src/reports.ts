import { z } from 'zod';
import {
  addMonths,
  type CalendarDate,
  calendarDateSchema,
  firstOfMonth,
  lastOfMonth,
} from './dates.js';
import { departmentCodeSchema } from './departments.js';
import { currencySchema, minorAmountSchema, signedMinorAmountSchema } from './money.js';
import { projectStatusSchema } from './projects.js';
import { taskSchema, taskStatusSchema } from './tasks.js';

/*
 * Dashboards and basic reports (spec F15, ADR 0027): computed on read from the records other
 * modules keep; nothing here is stored except the monthly report summaries.
 */

// Rules

/** A period of calendar dates in Asia/Damascus, both ends included. */
export const reportPeriodSchema = z
  .object({ from: calendarDateSchema, to: calendarDateSchema })
  .meta({ id: 'ReportPeriod' });

export type ReportPeriod = z.infer<typeof reportPeriodSchema>;

/** The clients a report service covers: every one, or the listed ones (ADR 0027). */
export type ReportClients = 'all' | readonly string[];

/** Rule 6: "this month" is the current month up to today; "last month" the whole previous one. */
export function reportMonths(today: CalendarDate): {
  thisMonth: ReportPeriod;
  lastMonth: ReportPeriod;
} {
  const lastMonthStart = addMonths(firstOfMonth(today), -1);
  return {
    thisMonth: { from: firstOfMonth(today), to: today },
    lastMonth: { from: lastMonthStart, to: lastOfMonth(lastMonthStart) },
  };
}

/** Rule 1: won ÷ (won + lost) of the leads closed in a month, whole percent; null when none closed. */
export function conversionRate(won: number, lost: number): number | null {
  if (won + lost === 0) return null;
  return Math.round((won * 100) / (won + lost));
}

/** Rule 1: approval items whose request link was issued longer ago than this are "waiting". */
export const APPROVAL_WAITING_HOURS = 48;

/** The link was issued more than `APPROVAL_WAITING_HOURS` before `now`. */
export function isApprovalWaiting(sentAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - sentAt.getTime() > APPROVAL_WAITING_HOURS * 3_600_000;
}

// Shared shapes

const namedSchema = z.object({ id: z.uuid(), name: z.string() });

const countSchema = z.number().int().min(0);

/** A cycle's completion (rule 6), whole percent; null when nothing is committed. */
const completionSchema = z.number().int().min(0).max(100).nullable();

const monthPairSchema = <T extends z.ZodType>(value: T) =>
  z.object({ thisMonth: value, lastMonth: value });

const reportMonthsSchema = monthPairSchema(reportPeriodSchema).meta({ id: 'ReportMonths' });

const currencyAmountSchema = z.object({ currency: currencySchema, amountMinor: minorAmountSchema });

// Company section (rule 1)

const leadMonthSchema = z.object({
  /** Leads created in the month. */
  new: countSchema,
  /** Leads closed as won or lost in the month. */
  won: countSchema,
  lost: countSchema,
  /** Whole percent; null when no lead closed in the month ("—"). */
  conversionRate: z.number().int().min(0).max(100).nullable(),
});

export const companyDashboardSchema = z
  .object({
    months: reportMonthsSchema,
    activeEngagements: z.object({
      /** Non-archived projects in `planned`, `active` and `on_hold`. */
      projects: z.array(z.object({ status: projectStatusSchema, count: countSchema })),
      /** Non-archived retainers in `active`. */
      retainers: countSchema,
    }),
    /** Every department with its F06 workload counts over its own tasks. */
    departments: z.array(
      z.object({
        department: departmentCodeSchema,
        open: countSchema,
        dueThisWeek: countSchema,
        overdue: countSchema,
        unassigned: countSchema,
      }),
    ),
    /** Open cycles of active retainers with at least one line behind, by client name. */
    retainersBehind: z.array(
      z.object({
        client: namedSchema,
        retainer: namedSchema,
        cycleId: z.uuid(),
        linesBehind: countSchema,
        completion: completionSchema,
      }),
    ),
    /** Pending approval items whose link was issued more than 48 hours ago and is not revoked. */
    approvalsWaiting: z.object({
      count: countSchema,
      oldest: z
        .object({
          itemId: z.uuid(),
          title: z.string(),
          client: namedSchema,
          sentAt: z.iso.datetime(),
          /** The link expired before the client answered. */
          expired: z.boolean(),
        })
        .nullable(),
    }),
    /** Wallets in low state, by client name; the balance may be negative (edge case 11). */
    lowWallets: z.array(
      z.object({ client: namedSchema, balanceUsdMinor: signedMinorAmountSchema }),
    ),
    leads: monthPairSchema(leadMonthSchema),
  })
  .meta({ id: 'CompanyDashboard' });

export type CompanyDashboard = z.infer<typeof companyDashboardSchema>;

// Finance section (rule 2)

export const financeDashboardSchema = z
  .object({
    months: reportMonthsSchema,
    /** Issued, non-void invoices by `issued_on`, in USD at each invoice's rate. */
    invoicedUsdMinor: monthPairSchema(minorAmountSchema),
    /** Non-void payments by `paid_on`, in USD at each payment's rate. */
    collectedUsdMinor: monthPairSchema(minorAmountSchema),
    /** Balance of issued, non-void invoices now, per currency and in USD at invoice rates. */
    outstanding: z.object({
      byCurrency: z.array(currencyAmountSchema),
      usdMinor: minorAmountSchema,
    }),
    /** `overdue` invoices now. */
    overdue: z.object({
      count: countSchema,
      byCurrency: z.array(currencyAmountSchema),
      usdMinor: minorAmountSchema,
    }),
  })
  .meta({ id: 'FinanceDashboard' });

export type FinanceDashboard = z.infer<typeof financeDashboardSchema>;

// Departments section (rule 3)

export const DASHBOARD_LIMITS = {
  /** Oldest overdue tasks listed per department. */
  overdueTasks: 10,
} as const;

export const departmentDashboardQuerySchema = z.object({
  /** One of the departments in scope; the first of them when left out. */
  department: departmentCodeSchema.optional(),
});

export type DepartmentDashboardQuery = z.infer<typeof departmentDashboardQuerySchema>;

export const departmentDashboardSchema = z
  .object({
    /** The departments the caller may pick from, in catalog order. */
    departments: z.array(departmentCodeSchema),
    department: departmentCodeSchema,
    /** This week, Saturday to Friday. */
    week: reportPeriodSchema,
    /** Open tasks of the department per open status. */
    byStatus: z.array(z.object({ status: taskStatusSchema, count: countSchema })),
    overdue: z.object({
      count: countSchema,
      /** At most `DASHBOARD_LIMITS.overdueTasks`, oldest due first. */
      oldest: z.array(taskSchema),
    }),
    unassigned: countSchema,
    /** As F06 Workload: each non-archived member, counts over all of their open tasks. */
    people: z.array(
      z.object({
        user: namedSchema,
        overdue: countSchema,
        dueThisWeek: countSchema,
        open: countSchema,
      }),
    ),
  })
  .meta({ id: 'DepartmentDashboard' });

export type DepartmentDashboard = z.infer<typeof departmentDashboardSchema>;

// My clients section (rule 4)

export const myClientsDashboardSchema = z
  .object({
    /** Rows with a problem first, then by client name. */
    clients: z.array(
      z.object({
        client: namedSchema,
        /** Active retainers with this month's cycle. */
        retainers: z.array(
          z.object({ retainer: namedSchema, completion: completionSchema, behind: z.boolean() }),
        ),
        openProjects: countSchema,
        /** Approval items pending the client. */
        approvals: z.object({
          pending: countSchema,
          oldestSentAt: z.iso.datetime().nullable(),
          /** The oldest was sent more than 48 hours ago. */
          waiting: z.boolean(),
        }),
        /** Null without `invoices.read` over the client. */
        invoices: z
          .object({ outstandingUsdMinor: minorAmountSchema, overdue: countSchema })
          .nullable(),
        /** Null without `campaigns.read` over the client. */
        lowWallet: z.boolean().nullable(),
        /** Behind, overdue invoices, a low wallet or approvals waiting over 48 hours. */
        hasProblem: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'MyClientsDashboard' });

export type MyClientsDashboard = z.infer<typeof myClientsDashboardSchema>;
