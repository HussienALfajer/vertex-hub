import { z } from 'zod';
import { calendarDateSchema } from './dates.js';
import { pageQuerySchema, pageSchema, queryListSchema, sortOrderSchema } from './lists.js';
import { currencySchema, exchangeRateSchema, minorAmountSchema } from './money.js';
import { milestoneStatusSchema } from './projects.js';
import { optionalText } from './text.js';

/*
 * Invoices (spec F13, ADR 0024): one client, one currency, optionally one project or retainer;
 * drafted by hand or automatically, numbered and frozen on issue, voided instead of corrected.
 */

export const INVOICE_STATUSES = [
  'draft',
  'sent',
  'partially_paid',
  'paid',
  'overdue',
  'void',
] as const;

export const invoiceStatusSchema = z.enum(INVOICE_STATUSES).meta({ id: 'InvoiceStatus' });

export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

/** Issued invoices with a balance still expected: the list's default and its "Open" tab. */
export const OPEN_INVOICE_STATUSES = [
  'sent',
  'partially_paid',
  'overdue',
] as const satisfies InvoiceStatus[];

/** How a draft started (rules 2–6). */
export const INVOICE_ORIGINS = [
  'quote_accepted',
  'milestone_done',
  'cycle_opened',
  'manual',
] as const;

export const invoiceOriginSchema = z.enum(INVOICE_ORIGINS).meta({ id: 'InvoiceOrigin' });

export type InvoiceOrigin = z.infer<typeof invoiceOriginSchema>;

/** What a line can bill: one source is on at most one live invoice (rule 4). */
export const INVOICE_SOURCE_TYPES = ['milestone', 'retainer_cycle', 'extra_work'] as const;

export const invoiceSourceTypeSchema = z
  .enum(INVOICE_SOURCE_TYPES)
  .meta({ id: 'InvoiceSourceType' });

export type InvoiceSourceType = z.infer<typeof invoiceSourceTypeSchema>;

export const INVOICE_LIMITS = {
  lines: 50,
  quantity: 999,
  paymentTermsDays: 90,
  /** The current rate is "stale" after this many days (rule 10). */
  rateStaleDays: 7,
} as const;

/** `INV-2026-0012`. */
export function invoiceDisplayNumber(invoice: { year: number; number: number }) {
  return `INV-${invoice.year}-${String(invoice.number).padStart(4, '0')}`;
}

/** `RC-2026-0007`, a payment's receipt. */
export function receiptDisplayNumber(payment: { year: number; number: number }) {
  return `RC-${payment.year}-${String(payment.number).padStart(4, '0')}`;
}

/** The current rate warns when it was last set more than 7 days ago (rule 10). */
export function rateIsStale(rateUpdatedAt: Date | null, now: Date = new Date()): boolean {
  if (!rateUpdatedAt) return false;
  return now.getTime() - rateUpdatedAt.getTime() > INVOICE_LIMITS.rateStaleDays * 86_400_000;
}

/**
 * The status of an issued, non-void invoice (rule 21): `paid` when fully paid; else `overdue`
 * when past due; else `partially_paid` with a payment; else `sent`. Drafts and void invoices
 * keep their status.
 */
export function invoiceStatus(invoice: {
  status: InvoiceStatus;
  totalMinor: number;
  paidMinor: number;
  dueOn: string | null;
  today: string;
}): InvoiceStatus {
  if (invoice.status === 'draft' || invoice.status === 'void') return invoice.status;
  if (invoice.paidMinor >= invoice.totalMinor) return 'paid';
  if (invoice.dueOn !== null && invoice.dueOn < invoice.today) return 'overdue';
  if (invoice.paidMinor > 0) return 'partially_paid';
  return 'sent';
}

// Settings

const settingsFieldsSchema = z.object({
  /** The current rate offered on new documents; null until first set. */
  sypPerUsd: exchangeRateSchema.nullable(),
  paymentTermsDays: z.number().int().min(0).max(INVOICE_LIMITS.paymentTermsDays),
  /** Bank and wallet details printed on invoices. */
  paymentDetails: z.string().trim().max(2000),
  invoiceFooter: z.string().trim().max(2000),
});

export const updateInvoiceSettingsSchema = settingsFieldsSchema
  .extend({ sypPerUsd: exchangeRateSchema })
  .partial()
  .meta({ id: 'UpdateInvoiceSettings' });

export type UpdateInvoiceSettings = z.infer<typeof updateInvoiceSettingsSchema>;

const personSchema = z.object({ id: z.uuid(), name: z.string() });

export const invoiceSettingsSchema = settingsFieldsSchema
  .extend({
    rateUpdatedAt: z.iso.datetime().nullable(),
    rateUpdatedBy: personSchema.nullable(),
    /** The rate is older than 7 days: a warning, not a refusal (rule 10). */
    rateStale: z.boolean(),
    updatedAt: z.iso.datetime(),
    updatedBy: personSchema.nullable(),
    canEdit: z.boolean(),
  })
  .meta({ id: 'InvoiceSettings' });

export type InvoiceSettings = z.infer<typeof invoiceSettingsSchema>;

// Drafting

export const invoiceSourceSchema = z
  .object({ type: invoiceSourceTypeSchema, id: z.uuid() })
  .meta({ id: 'InvoiceSource' });

export type InvoiceSource = z.infer<typeof invoiceSourceSchema>;

const oneEngagement = <T extends { projectId?: string | null; retainerId?: string | null }>(
  value: T,
) => !(value.projectId && value.retainerId);

const engagementMessage = { message: 'A project or a retainer, not both', path: ['retainerId'] };

/**
 * A manual draft (rule 6): the client and currency, the sources to bill with their default
 * amounts, and for a free-line invoice the engagement it belongs to.
 */
export const createInvoiceSchema = z
  .object({
    clientId: z.uuid(),
    currency: currencySchema,
    projectId: z.uuid().nullable().default(null),
    retainerId: z.uuid().nullable().default(null),
    sources: z.array(invoiceSourceSchema).max(INVOICE_LIMITS.lines).default([]),
  })
  .refine(oneEngagement, engagementMessage)
  .meta({ id: 'CreateInvoice' });

export type CreateInvoice = z.infer<typeof createInvoiceSchema>;

export type CreateInvoiceInput = z.input<typeof createInvoiceSchema>;

const invoiceLineInputSchema = z.object({
  /** A line already on the draft; a new line has none. */
  id: z.uuid().optional(),
  description: z.string().trim().min(1).max(300),
  quantity: z.number().int().min(1).max(INVOICE_LIMITS.quantity),
  unitPriceMinor: minorAmountSchema,
  source: invoiceSourceSchema.nullable().default(null),
});

export type InvoiceLineInput = z.infer<typeof invoiceLineInputSchema>;

/**
 * The whole draft, saved at once (rule 7). The sources of the lines set the engagement; a
 * free-line draft may name one. More than 50 lines is `LIMIT_REACHED`.
 */
export const invoiceDraftSchema = z
  .object({
    /** The `updatedAt` the editor loaded; another save since then is `STALE_INVOICE`. */
    updatedAt: z.iso.datetime(),
    projectId: z.uuid().nullable(),
    retainerId: z.uuid().nullable(),
    paymentTermsDays: z.number().int().min(0).max(INVOICE_LIMITS.paymentTermsDays),
    notes: optionalText(2000),
    lines: z.array(invoiceLineInputSchema),
  })
  .refine(oneEngagement, engagementMessage)
  .meta({ id: 'InvoiceDraft' });

export type InvoiceDraft = z.infer<typeof invoiceDraftSchema>;

export type InvoiceDraftInput = z.input<typeof invoiceDraftSchema>;

/**
 * Rule 9. The due date defaults to today + the draft's payment terms and is ≥ today
 * (`INVALID_DATES`); the rate defaults to the current one (`RATE_REQUIRED` when none is set).
 */
export const issueInvoiceSchema = z
  .object({
    updatedAt: z.iso.datetime(),
    dueOn: calendarDateSchema.nullable().default(null),
    sypPerUsd: exchangeRateSchema.nullable().default(null),
  })
  .meta({ id: 'IssueInvoice' });

export type IssueInvoice = z.infer<typeof issueInvoiceSchema>;

export type IssueInvoiceInput = z.input<typeof issueInvoiceSchema>;

const reasonSchema = z.string().trim().min(1).max(500);

/** Rule 13: a date ≥ today (`INVALID_DATES`). */
export const changeInvoiceDueDateSchema = z
  .object({ dueOn: calendarDateSchema, reason: reasonSchema })
  .meta({ id: 'ChangeInvoiceDueDate' });

export type ChangeInvoiceDueDate = z.infer<typeof changeInvoiceDueDateSchema>;

export const voidInvoiceSchema = z.object({ reason: reasonSchema }).meta({ id: 'VoidInvoice' });

export type VoidInvoice = z.infer<typeof voidInvoiceSchema>;

// Payments (rules 16–22)

/** How the money arrived (owner decision: required). */
export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'e_wallet'] as const;

export const paymentMethodSchema = z.enum(PAYMENT_METHODS).meta({ id: 'PaymentMethod' });

export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/**
 * Rules 17 and 19. `paidOn` ≤ today (`INVALID_DATES`), possibly before the issue date; the rate
 * defaults to the current one (`RATE_REQUIRED` when none is set); the applied amount above the
 * balance is `OVERPAYMENT`. The proof is the actor's upload, kept as a document of the invoice.
 */
export const recordPaymentSchema = z
  .object({
    paidOn: calendarDateSchema,
    amountMinor: minorAmountSchema.min(1),
    currency: currencySchema,
    sypPerUsd: exchangeRateSchema.nullable().default(null),
    method: paymentMethodSchema,
    /** Bank or wallet name and transaction number. */
    reference: optionalText(200).default(null),
    note: optionalText(500).default(null),
    proofUploadId: z.uuid().nullable().default(null),
  })
  .meta({ id: 'RecordPayment' });

export type RecordPayment = z.infer<typeof recordPaymentSchema>;

export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;

/** Rule 22: a payment recorded by mistake. */
export const voidPaymentSchema = z.object({ reason: reasonSchema }).meta({ id: 'VoidPayment' });

export type VoidPayment = z.infer<typeof voidPaymentSchema>;

// Billable items (rule 6)

export const billableItemsQuerySchema = z.object({ clientId: z.uuid(), currency: currencySchema });

export type BillableItemsQuery = z.infer<typeof billableItemsQuerySchema>;

const namedSchema = z.object({ id: z.uuid(), name: z.string() });

export const billableItemsSchema = z
  .object({
    /** Non-archived milestones with an installment, not on a live invoice. */
    milestones: z.array(
      z.object({
        id: z.uuid(),
        project: namedSchema,
        name: z.string(),
        status: milestoneStatusSchema,
        installmentMinor: minorAmountSchema,
      }),
    ),
    /** Cycles not on a live invoice; the default amount is the retainer's current fee. */
    cycles: z.array(
      z.object({
        id: z.uuid(),
        retainer: namedSchema,
        /** The first day of the month. */
        month: calendarDateSchema,
        feeMinor: minorAmountSchema.nullable(),
      }),
    ),
    /** `unbilled` extra work not on a live invoice; the default amount is its estimate. */
    extraWork: z.array(
      z.object({
        id: z.uuid(),
        project: namedSchema.nullable(),
        retainer: namedSchema.nullable(),
        title: z.string(),
        estimateMinor: minorAmountSchema.nullable(),
      }),
    ),
  })
  .meta({ id: 'BillableItems' });

export type BillableItems = z.infer<typeof billableItemsSchema>;

// Responses

const engagementSchema = z
  .object({ type: z.enum(['project', 'retainer']), id: z.uuid(), name: z.string() })
  .meta({ id: 'InvoiceEngagement' });

export const invoiceSchema = z
  .object({
    id: z.uuid(),
    /** `INV-2026-0012`; null on drafts. */
    displayNumber: z.string().nullable(),
    client: namedSchema,
    accountManager: personSchema,
    engagement: engagementSchema.nullable(),
    origin: invoiceOriginSchema,
    currency: currencySchema,
    status: invoiceStatusSchema,
    issuedOn: calendarDateSchema.nullable(),
    dueOn: calendarDateSchema.nullable(),
    totalMinor: minorAmountSchema,
    paidMinor: minorAmountSchema,
    balanceMinor: minorAmountSchema,
    /** Days past the due date while `overdue`; null otherwise. */
    daysOverdue: z.number().int().min(1).nullable(),
    updatedAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Invoice' });

export type Invoice = z.infer<typeof invoiceSchema>;

export const invoiceLineSchema = z
  .object({
    id: z.uuid(),
    description: z.string(),
    quantity: z.number().int().min(1),
    unitPriceMinor: minorAmountSchema,
    totalMinor: minorAmountSchema,
    /** The billed milestone, cycle or extra work item, with where it lives. */
    source: invoiceSourceSchema
      .extend({
        name: z.string(),
        project: namedSchema.nullable(),
        retainer: namedSchema.nullable(),
      })
      .nullable(),
  })
  .meta({ id: 'InvoiceLine' });

export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

export const paymentSchema = z
  .object({
    id: z.uuid(),
    /** `RC-2026-0007`; kept by a void payment. */
    receiptNumber: z.string(),
    paidOn: calendarDateSchema,
    amountMinor: minorAmountSchema,
    currency: currencySchema,
    sypPerUsd: exchangeRateSchema,
    /** In the invoice's currency (rule 19). */
    appliedMinor: minorAmountSchema,
    method: paymentMethodSchema,
    reference: z.string().nullable(),
    note: z.string().nullable(),
    /** The proof, a document of the invoice. */
    proof: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    recordedBy: personSchema,
    createdAt: z.iso.datetime(),
    voided: z.object({ at: z.iso.datetime(), by: personSchema, reason: z.string() }).nullable(),
  })
  .meta({ id: 'Payment' });

export type Payment = z.infer<typeof paymentSchema>;

export const invoicePermissionsSchema = z
  .object({
    /** A draft: edit, preview and discard. */
    canEdit: z.boolean(),
    canIssue: z.boolean(),
    canArchive: z.boolean(),
    canChangeDueDate: z.boolean(),
    /** `sent` or `overdue`; payments block it (`INVOICE_HAS_PAYMENTS`). */
    canVoid: z.boolean(),
    /** `payments.manage` on a `sent`, `partially_paid` or `overdue` invoice (rule 16). */
    canRecordPayment: z.boolean(),
    /** `payments.manage`: void a non-void payment of an issued invoice (rule 22). */
    canVoidPayments: z.boolean(),
  })
  .meta({ id: 'InvoicePermissions', description: 'What the caller may do, for the UI' });

export type InvoicePermissions = z.infer<typeof invoicePermissionsSchema>;

export const invoiceDetailSchema = invoiceSchema
  .extend({
    /** The name printed on the invoice: the billing name, else the trade name. */
    billingName: z.string(),
    billingAddress: z.string().nullable(),
    year: z.number().int().nullable(),
    number: z.number().int().min(1).nullable(),
    quote: z.object({ id: z.uuid(), displayNumber: z.string() }).nullable(),
    paymentTermsDays: z.number().int().min(0),
    /** Fixed on issue (ADR 0006); null on drafts. */
    sypPerUsd: exchangeRateSchema.nullable(),
    /** USD equivalents at the invoice's rate; null until issued. */
    usd: z
      .object({
        totalMinor: minorAmountSchema,
        paidMinor: minorAmountSchema,
        balanceMinor: minorAmountSchema,
      })
      .nullable(),
    notes: z.string().nullable(),
    lines: z.array(invoiceLineSchema),
    /** Oldest first, void ones included. */
    payments: z.array(paymentSchema),
    issuedBy: personSchema.nullable(),
    voided: z.object({ at: z.iso.datetime(), by: personSchema, reason: z.string() }).nullable(),
    /** Null for automatic drafts. */
    createdBy: personSchema.nullable(),
    createdAt: z.iso.datetime(),
    permissions: invoicePermissionsSchema,
  })
  .meta({ id: 'InvoiceDetail' });

export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;

export const INVOICE_SORTS = ['updatedAt', 'number', 'dueOn'] as const;

export const invoiceListQuerySchema = pageQuerySchema.extend({
  /** Matches the number (`INV-2026-0012` or `12`) or the client's trade name. */
  search: z.string().trim().min(1).max(100).optional(),
  status: queryListSchema(invoiceStatusSchema).default(['draft', ...OPEN_INVOICE_STATUSES]),
  clientId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  retainerId: z.uuid().optional(),
  currency: currencySchema.optional(),
  origin: invoiceOriginSchema.optional(),
  accountManagerId: z.uuid().optional(),
  dueFrom: calendarDateSchema.optional(),
  dueTo: calendarDateSchema.optional(),
  sort: z.enum(INVOICE_SORTS).default('updatedAt'),
  order: sortOrderSchema.default('desc'),
});

export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

const outstandingSchema = z.object({
  /** Balances of `sent`, `partially_paid` and `overdue` invoices. */
  outstandingMinor: minorAmountSchema,
  /** Balances of `overdue` invoices. */
  overdueMinor: minorAmountSchema,
});

export const invoicePageSchema = pageSchema(invoiceSchema)
  .extend({
    /** Over every invoice the filters match, whatever the status filter. */
    totals: z
      .object({
        byCurrency: z.array(outstandingSchema.extend({ currency: currencySchema })),
        /** Each balance converted with its invoice's rate. */
        usd: outstandingSchema,
      })
      .meta({ id: 'InvoiceTotals' }),
  })
  .meta({ id: 'InvoicePage' });

export type InvoicePage = z.infer<typeof invoicePageSchema>;

// The frozen render payload of an issued invoice (rule 15)

export const invoiceSnapshotSchema = z
  .object({
    displayNumber: z.string(),
    companyDetails: z.string(),
    billingName: z.string(),
    billingAddress: z.string().nullable(),
    currency: currencySchema,
    issuedOn: calendarDateSchema,
    dueOn: calendarDateSchema,
    lines: z.array(
      z.object({
        description: z.string(),
        quantity: z.number().int(),
        unitPriceMinor: minorAmountSchema,
        totalMinor: minorAmountSchema,
      }),
    ),
    totalMinor: minorAmountSchema,
    notes: z.string().nullable(),
    paymentDetails: z.string(),
    footer: z.string(),
  })
  .meta({ id: 'InvoiceSnapshot' });

export type InvoiceSnapshot = z.infer<typeof invoiceSnapshotSchema>;
