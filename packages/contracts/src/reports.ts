import { z } from 'zod';
import { adObjectiveSchema, adPlatformSchema } from './campaigns.js';
import { publishedLinkSchema } from './content.js';
import {
  addMonths,
  businessDate,
  businessInstant,
  type CalendarDate,
  calendarDateSchema,
  daysInclusive,
  firstOfMonth,
  lastOfMonth,
} from './dates.js';
import { departmentCodeSchema } from './departments.js';
import { fileMonthSchema } from './files.js';
import { queryListSchema } from './lists.js';
import {
  currencySchema,
  exchangeRateSchema,
  minorAmountSchema,
  signedMinorAmountSchema,
} from './money.js';
import { postPlatformSchema } from './post-values.js';
import { projectStatusSchema } from './projects.js';
import { cycleStatusSchema, deliverableKindSchema } from './retainers.js';
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

// Report periods and months (rules 8, 11 and 17)

/** Rules 8 and 11: a report period spans at most this many days. */
export const REPORT_PERIOD_MAX_DAYS = 366;

/** `from` ≤ `to` and at most `REPORT_PERIOD_MAX_DAYS` days, both included (`INVALID_DATES`). */
export function isValidReportPeriod(period: ReportPeriod): boolean {
  return (
    period.from <= period.to && daysInclusive(period.from, period.to) <= REPORT_PERIOD_MAX_DAYS
  );
}

/** A calendar month, `YYYY-MM`. */
export const reportMonthSchema = fileMonthSchema;

/** The days of a `YYYY-MM` month. */
export function monthPeriod(month: string): ReportPeriod {
  const from = `${month}-01`;
  return { from, to: lastOfMonth(from) };
}

/** Rule 17: months after the current one are refused (`INVALID_MONTH`). */
export function isFutureMonth(month: string, today: CalendarDate): boolean {
  return month > today.slice(0, 7);
}

/** Rule 17: the current month's report is preliminary. */
export function isPreliminaryMonth(month: string, today: CalendarDate): boolean {
  return month === today.slice(0, 7);
}

/** `total` over `count` items, one decimal; null without items. */
export function averageOf(total: number, count: number): number | null {
  if (count === 0) return null;
  return Math.round((total * 10) / count) / 10;
}

// Department productivity (rules 8–10)

/**
 * Rule 10: delivered not after the due moment — the end of the due date in Asia/Damascus, or the
 * due time when set (`HH:MM` or `HH:MM:SS`).
 */
export function deliveredOnTime(
  deliveredAt: Date,
  task: { dueDate: CalendarDate; dueTime: string | null },
): boolean {
  if (!task.dueTime) return businessDate(deliveredAt) <= task.dueDate;
  return deliveredAt.getTime() <= businessInstant(task.dueDate, task.dueTime.slice(0, 5)).getTime();
}

/** Rule 10: on-time deliveries over deliveries, whole percent; null when none was delivered. */
export function onTimeRate(onTime: number, delivered: number): number | null {
  if (delivered === 0) return null;
  return Math.round((onTime * 100) / delivered);
}

// Revenue split (rule 14)

/**
 * Splits `total` into whole parts proportional to `weights` by the largest-remainder method, so
 * the parts always add up to `total`; ties go to the earlier weight. Null when every weight is 0.
 */
export function splitLargestRemainder(total: number, weights: readonly number[]): number[] | null {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (sum <= 0) return null;
  const exact = weights.map((weight) => (total * weight) / sum);
  const parts = exact.map((value) => Math.floor(value));
  let left = total - parts.reduce((acc, part) => acc + part, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    parts[index] = (parts[index] ?? 0) + 1;
    left -= 1;
  }
  return parts;
}

/**
 * Where a share of revenue goes: a catalog service or package (`service:<id>`, `package:<id>`),
 * or null for "Unclassified" (a quote line of neither).
 */
export interface RevenueTarget {
  key: string | null;
  /** The quote line's quantity × unit price, or 1 for a line's own service. */
  weight: number;
}

/** An invoice line as rule 14 splits it: its total and where its share goes. */
export interface RevenueLine {
  totalMinor: number;
  /** Empty, or all weights 0: "Unclassified". */
  targets: readonly RevenueTarget[];
}

/**
 * Rule 14: splits an invoice's (or a payment's) USD amount over the invoice's lines by line
 * totals, then each line's share over its targets by weight; the parts add up to `usdMinor`. The
 * `null` key is "Unclassified" (edge case 8).
 */
export function splitRevenue(
  usdMinor: number,
  lines: readonly RevenueLine[],
): Map<string | null, number> {
  const result = new Map<string | null, number>();
  const add = (key: string | null, amount: number) => {
    if (amount !== 0) result.set(key, (result.get(key) ?? 0) + amount);
  };
  const shares = splitLargestRemainder(
    usdMinor,
    lines.map((line) => line.totalMinor),
  );
  if (!shares) {
    add(null, usdMinor);
    return result;
  }
  lines.forEach((line, index) => {
    const share = shares[index] ?? 0;
    const parts = splitLargestRemainder(
      share,
      line.targets.map((target) => target.weight),
    );
    if (!parts) {
      add(null, share);
      return;
    }
    line.targets.forEach((target, at) => {
      add(target.key, parts[at] ?? 0);
    });
  });
  return result;
}

// Overdue invoices (rule 16)

export const AGING_BUCKETS = ['1_30', '31_60', '61_90', 'over_90'] as const;

export const agingBucketSchema = z.enum(AGING_BUCKETS).meta({ id: 'AgingBucket' });

export type AgingBucket = z.infer<typeof agingBucketSchema>;

/** Days past the due date on `today`; 0 on the due date itself. */
export function daysOverdue(dueOn: CalendarDate, today: CalendarDate): number {
  return Math.max(0, daysInclusive(dueOn, today) - 1);
}

/** Rule 16: 1–30, 31–60, 61–90 and over 90 days overdue. */
export function agingBucket(days: number): AgingBucket {
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return 'over_90';
}

/** Rule 18.7: under two days the average response shows in hours, else in days (one decimal). */
export function responseTime(hours: number): { unit: 'hours' | 'days'; value: number } {
  if (hours < 48) return { unit: 'hours', value: Math.round(hours * 10) / 10 };
  return { unit: 'days', value: Math.round((hours / 24) * 10) / 10 };
}

// Productivity report (rules 8–10)

/** The period defaults to this month up to today; the departments to all in scope. */
export const productivityQuerySchema = z.object({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  department: queryListSchema(departmentCodeSchema).optional(),
});

export type ProductivityQuery = z.infer<typeof productivityQuerySchema>;

const averageSchema = z.number().min(0).nullable();

const productivityMeasuresSchema = z
  .object({
    /** Created in the period. */
    new: countSchema,
    /** Delivered (and still delivered) with `delivered_at` in the period. */
    delivered: countSchema,
    /** Whole percent of the delivered; null when none was delivered ("—"). */
    onTimeRate: z.number().int().min(0).max(100).nullable(),
    /** Per delivered task, one decimal; null when none was delivered. */
    averageClientRevisions: averageSchema,
    /** Sources `internal` and `medical`. */
    averageInternalRevisions: averageSchema,
    /** Days from start (else creation) to delivery, one decimal. */
    averageCycleDays: averageSchema,
    /** At the time of the request, not the period. */
    openNow: countSchema,
    overdueNow: countSchema,
  })
  .meta({ id: 'ProductivityMeasures' });

export type ProductivityMeasures = z.infer<typeof productivityMeasuresSchema>;

export const productivityReportSchema = z
  .object({
    period: reportPeriodSchema,
    /** In catalog order. */
    departments: z.array(
      z.object({
        department: departmentCodeSchema,
        /** The department's display name. */
        name: z.string(),
        measures: productivityMeasuresSchema,
        unassigned: z.object({
          count: countSchema,
          /** The day the oldest unassigned open task was created. */
          oldestOn: calendarDateSchema.nullable(),
        }),
        /** Non-archived members, then anyone who delivered a task of it in the period, by name. */
        people: z.array(
          z.object({
            user: namedSchema.extend({ archived: z.boolean() }),
            measures: productivityMeasuresSchema,
          }),
        ),
      }),
    ),
  })
  .meta({ id: 'ProductivityReport' });

export type ProductivityReport = z.infer<typeof productivityReportSchema>;

// Revenue report (rules 11–15)

/** The period defaults to this month up to today. */
export const revenueQuerySchema = z.object({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
});

export type RevenueQuery = z.infer<typeof revenueQuerySchema>;

export const REVENUE_ROW_KINDS = ['service', 'package', 'unclassified'] as const;

export const revenueReportSchema = z
  .object({
    period: reportPeriodSchema,
    invoicedUsdMinor: minorAmountSchema,
    collectedUsdMinor: minorAmountSchema,
    /** Clients with something invoiced, collected or outstanding, by name. */
    byClient: z.array(
      z.object({
        client: namedSchema,
        accountManager: namedSchema.nullable(),
        invoicedUsdMinor: minorAmountSchema,
        collectedUsdMinor: minorAmountSchema,
        /** Issued on or before `to`, less payments on or before `to`, at invoice rates. */
        outstandingUsdMinor: minorAmountSchema,
      }),
    ),
    /** By invoiced amount, largest first; "Unclassified" last. */
    byService: z.array(
      z.object({
        kind: z.enum(REVENUE_ROW_KINDS),
        /** The service or package; null for "Unclassified". */
        id: z.uuid().nullable(),
        name: z.string().nullable(),
        archived: z.boolean(),
        invoicedUsdMinor: minorAmountSchema,
        collectedUsdMinor: minorAmountSchema,
      }),
    ),
    /** Issued in the period or paid in it, by issue date then number. */
    invoices: z.array(
      z.object({
        id: z.uuid(),
        /** `INV-…`. */
        number: z.string(),
        client: namedSchema,
        issuedOn: calendarDateSchema,
        currency: currencySchema,
        totalMinor: minorAmountSchema,
        sypPerUsd: exchangeRateSchema.nullable(),
        totalUsdMinor: minorAmountSchema,
        /** Non-void payments with `paid_on` in the period, in USD at their own rate. */
        collectedUsdMinor: minorAmountSchema,
      }),
    ),
  })
  .meta({ id: 'RevenueReport' });

export type RevenueReport = z.infer<typeof revenueReportSchema>;

// Overdue invoices (rule 16)

export const overdueInvoicesQuerySchema = z.object({
  accountManagerId: z.uuid().optional(),
  currency: currencySchema.optional(),
});

export type OverdueInvoicesQuery = z.infer<typeof overdueInvoicesQuerySchema>;

export const overdueInvoicesReportSchema = z
  .object({
    today: calendarDateSchema,
    /** Most days overdue first. */
    invoices: z.array(
      z.object({
        id: z.uuid(),
        number: z.string(),
        client: namedSchema,
        accountManager: namedSchema.nullable(),
        currency: currencySchema,
        totalMinor: minorAmountSchema,
        paidMinor: minorAmountSchema,
        balanceMinor: minorAmountSchema,
        /** At the invoice's rate. */
        balanceUsdMinor: minorAmountSchema,
        dueOn: calendarDateSchema,
        daysOverdue: countSchema,
        bucket: agingBucketSchema,
      }),
    ),
    totals: z.object({
      count: countSchema,
      byCurrency: z.array(currencyAmountSchema),
      usdMinor: minorAmountSchema,
    }),
  })
  .meta({ id: 'OverdueInvoicesReport' });

export type OverdueInvoicesReport = z.infer<typeof overdueInvoicesReportSchema>;

// Monthly client report (rules 17–20)

export const CLIENT_REPORT_SUMMARY_MAX = 4000;

export const clientReportQuerySchema = z.object({ month: reportMonthSchema });

export type ClientReportQuery = z.infer<typeof clientReportQuerySchema>;

/** Rule 19: replaces the month's summary; an empty text clears it. */
export const updateClientReportSummarySchema = z
  .object({
    month: reportMonthSchema,
    summary: z.string().trim().max(CLIENT_REPORT_SUMMARY_MAX),
  })
  .meta({ id: 'UpdateClientReportSummary' });

export type UpdateClientReportSummary = z.infer<typeof updateClientReportSummarySchema>;

const campaignMetricsSchema = z.object({
  /** USD. */
  spendMinor: minorAmountSchema,
  reach: countSchema,
  clicks: countSchema,
  results: countSchema,
  costPerResultMinor: minorAmountSchema.nullable(),
});

export const clientMonthlyReportSchema = z
  .object({
    client: namedSchema,
    month: reportMonthSchema,
    period: reportPeriodSchema,
    /** The current month (rule 17). */
    preliminary: z.boolean(),
    /** Section 1; null when no text is stored. */
    summary: z
      .object({ text: z.string(), updatedBy: namedSchema, updatedAt: z.iso.datetime() })
      .nullable(),
    /** Section 2: non-archived retainers with a cycle in the month, by name. */
    retainers: z.array(
      z.object({
        retainer: namedSchema,
        status: cycleStatusSchema,
        lines: z.array(
          z.object({
            kind: deliverableKindSchema,
            label: z.string().nullable(),
            committed: countSchema,
            /** Frozen at close for a closed cycle, live for an open one. */
            delivered: countSchema,
            /** R13 over the line alone: whole percent, rounded down; null with nothing committed. */
            percent: z.number().int().min(0).max(100).nullable(),
          }),
        ),
        /** Rule 6. */
        completion: completionSchema,
      }),
    ),
    /** Section 3: non-archived projects open at some point in the month, by name. */
    projects: z.array(
      z.object({
        project: namedSchema,
        status: projectStatusSchema,
        deliveredTasks: countSchema,
        totalTasks: countSchema,
        milestonesDone: z.array(z.object({ name: z.string(), doneOn: calendarDateSchema })),
      }),
    ),
    /** Section 4, by delivery date. */
    deliveredWork: z.array(
      z.object({
        taskId: z.uuid(),
        /** The latest approval item's client-facing title, else the task's. */
        title: z.string(),
        department: departmentCodeSchema,
        departmentName: z.string(),
        deliveredOn: calendarDateSchema,
      }),
    ),
    /** Section 5, by publish date. */
    posts: z.array(
      z.object({
        id: z.uuid(),
        publishedOn: calendarDateSchema,
        platforms: z.array(postPlatformSchema),
        title: z.string(),
        links: z.array(publishedLinkSchema),
      }),
    ),
    /** Section 6, by date. */
    shoots: z.array(
      z.object({ id: z.uuid(), date: calendarDateSchema, title: z.string(), location: z.string() }),
    ),
    /** Section 7: items closed in the month as approved or changes requested. */
    approvals: z.object({
      approved: countSchema,
      changesRequested: countSchema,
      /** From the request's creation to the item's close; null without closed items. */
      averageResponseHours: z.number().min(0).nullable(),
    }),
    /** Section 8; null without `campaigns.read` over the client. */
    campaigns: z
      .object({
        rows: z.array(
          campaignMetricsSchema.extend({
            id: z.uuid(),
            platform: adPlatformSchema,
            name: z.string(),
            objective: adObjectiveSchema,
          }),
        ),
        totals: campaignMetricsSchema,
      })
      .nullable(),
    /** Section 9, USD; null without `campaigns.read` or without wallet activity. */
    adBudget: z
      .object({
        openingMinor: signedMinorAmountSchema,
        depositsMinor: minorAmountSchema,
        refundsMinor: minorAmountSchema,
        spendMinor: minorAmountSchema,
        closingMinor: signedMinorAmountSchema,
      })
      .nullable(),
    /** Section 10. */
    nextMonth: z.object({
      posts: z.array(z.object({ date: calendarDateSchema, title: z.string() })),
      shoots: z.array(z.object({ date: calendarDateSchema, title: z.string() })),
    }),
    /** Every section is empty: the report says there was no activity. */
    empty: z.boolean(),
  })
  .meta({ id: 'ClientMonthlyReport' });

export type ClientMonthlyReport = z.infer<typeof clientMonthlyReportSchema>;

/** The render payload of the monthly report PDF (rule 20): the report with the company details. */
export const clientReportSnapshotSchema = clientMonthlyReportSchema.extend({
  companyDetails: z.string(),
});

export type ClientReportSnapshot = z.infer<typeof clientReportSnapshotSchema>;
