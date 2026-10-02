import { z } from 'zod';
import { CATALOG_BILLINGS, CATALOG_LIMITS } from './catalog.js';
import { addDays, calendarDateSchema } from './dates.js';
import { departmentCodeSchema } from './departments.js';
import {
  pageQuerySchema,
  pageSchema,
  queryBooleanSchema,
  queryListSchema,
  sortOrderSchema,
} from './lists.js';
import { currencySchema, minorAmountSchema } from './money.js';
import { deliverableKindSchema } from './retainers.js';
import { TASK_LIMITS } from './tasks.js';
import { optionalText } from './text.js';

/*
 * Quotes (spec F04): a quote for a client in one currency with a one-off and a monthly section,
 * built from the catalog, approved when its discount crosses the threshold, sent, versioned and
 * expired. One row per version.
 */

export const QUOTE_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'superseded',
] as const;

export const quoteStatusSchema = z.enum(QUOTE_STATUSES).meta({ id: 'QuoteStatus' });

export type QuoteStatus = z.infer<typeof quoteStatusSchema>;

/** The statuses a quote list shows by default. */
export const OPEN_QUOTE_STATUSES = ['draft', 'sent', 'expired'] as const satisfies QuoteStatus[];

/** Discount approval of a draft (rule 7). */
export const DISCOUNT_APPROVALS = ['none', 'pending', 'approved', 'returned'] as const;

export const discountApprovalSchema = z.enum(DISCOUNT_APPROVALS).meta({ id: 'DiscountApproval' });

export type DiscountApproval = z.infer<typeof discountApprovalSchema>;

/** A quote's sections follow the catalog billings: a line sits in its item's billing. */
export const QUOTE_SECTIONS = CATALOG_BILLINGS;

export const quoteSectionSchema = z.enum(QUOTE_SECTIONS).meta({ id: 'QuoteSection' });

export type QuoteSection = z.infer<typeof quoteSectionSchema>;

export const QUOTE_REJECTION_REASONS = [
  'price',
  'timing',
  'competitor',
  'scope',
  'no_response',
  'other',
] as const;

export const quoteRejectionReasonSchema = z
  .enum(QUOTE_REJECTION_REASONS)
  .meta({ id: 'QuoteRejectionReason' });

export type QuoteRejectionReason = z.infer<typeof quoteRejectionReasonSchema>;

export const QUOTE_LIMITS = {
  lines: 50,
  lineItems: CATALOG_LIMITS.packageItems,
  quantity: CATALOG_LIMITS.quantity,
  installments: 10,
  validityDays: 90,
  termMonths: 36,
  /** A quote "expires soon" this many days or fewer before its last valid day. */
  expiresSoonDays: 3,
} as const;

/** `Q-2026-0007`, and ` v2` from the second version. */
export function quoteDisplayNumber(quote: { year: number; number: number; version: number }) {
  const base = `Q-${quote.year}-${String(quote.number).padStart(4, '0')}`;
  return quote.version > 1 ? `${base} v${quote.version}` : base;
}

/** The last valid day of a quote sent on `sentOn` (rule 6). */
export function quoteValidUntil(sentOn: string, validityDays: number): string {
  return addDays(sentOn, validityDays);
}

// Totals (rule 5)

export interface QuoteTotalsInput {
  lines: readonly {
    section: QuoteSection;
    quantity: number;
    unitPriceMinor: number;
    /** Null when the catalog has no price in the quote's currency: the line's own price counts. */
    listUnitPriceMinor: number | null;
  }[];
  oneOffDiscountMinor: number;
  monthlyDiscountMinor: number;
  installments: readonly { percent: number }[];
  monthlyTermMonths: number | null;
}

export interface QuoteSectionTotals {
  subtotalMinor: number;
  discountMinor: number;
  /** Subtotal − discount; never below 0. */
  netMinor: number;
  /** The section at catalog prices. */
  listMinor: number;
  /** (list − net) ÷ list in hundredths of a percent; 0 when list is 0 or net is above it. */
  effectiveDiscountBasisPoints: number;
}

export interface QuoteTotals {
  lineTotalsMinor: number[];
  oneOff: QuoteSectionTotals;
  /** Per month. */
  monthly: QuoteSectionTotals;
  /** The monthly net × the term, when a term is set. */
  monthlyTermTotalMinor: number | null;
  /** Each installment's share of the one-off net; the last takes the remainder. */
  installmentAmountsMinor: number[];
}

/** Every amount of a quote, in its currency (rule 5); the API, the web app and the PDF use it. */
export function quoteTotals(input: QuoteTotalsInput): QuoteTotals {
  const lineTotalsMinor = input.lines.map((line) => line.quantity * line.unitPriceMinor);
  const section = (name: QuoteSection, discountMinor: number): QuoteSectionTotals => {
    let subtotalMinor = 0;
    let listMinor = 0;
    input.lines.forEach((line, index) => {
      if (line.section !== name) return;
      subtotalMinor += lineTotalsMinor[index] ?? 0;
      listMinor += line.quantity * (line.listUnitPriceMinor ?? line.unitPriceMinor);
    });
    const netMinor = Math.max(0, subtotalMinor - discountMinor);
    const effectiveDiscountBasisPoints =
      listMinor > 0 && netMinor < listMinor
        ? Math.round(((listMinor - netMinor) * 10000) / listMinor)
        : 0;
    return { subtotalMinor, discountMinor, netMinor, listMinor, effectiveDiscountBasisPoints };
  };
  const oneOff = section('one_off', input.oneOffDiscountMinor);
  const monthly = section('monthly', input.monthlyDiscountMinor);
  const installmentAmountsMinor = input.installments.map((installment) =>
    Math.floor((oneOff.netMinor * installment.percent) / 100),
  );
  const last = installmentAmountsMinor.length - 1;
  if (last >= 0) {
    const shared = installmentAmountsMinor.reduce((sum, amount) => sum + amount, 0);
    installmentAmountsMinor[last] = (installmentAmountsMinor[last] ?? 0) + oneOff.netMinor - shared;
  }
  return {
    lineTotalsMinor,
    oneOff,
    monthly,
    monthlyTermTotalMinor:
      input.monthlyTermMonths === null ? null : monthly.netMinor * input.monthlyTermMonths,
    installmentAmountsMinor,
  };
}

/** Rule 6: either section's effective discount reaches the threshold (a whole percentage). */
export function needsDiscountApproval(totals: QuoteTotals, thresholdPercent: number): boolean {
  const limit = thresholdPercent * 100;
  return (
    totals.oneOff.effectiveDiscountBasisPoints >= limit ||
    totals.monthly.effectiveDiscountBasisPoints >= limit
  );
}

/**
 * Installments are valid (`INVALID_INSTALLMENTS`): 1–10 summing to 100 % when the one-off section
 * has lines, none otherwise. A draft may still lack them; sending needs them.
 */
export function installmentsValid(
  installments: readonly { percent: number }[],
  hasOneOffLines: boolean,
  options: { draft: boolean },
): boolean {
  if (!hasOneOffLines) return installments.length === 0;
  if (installments.length === 0) return options.draft;
  return installments.reduce((sum, installment) => sum + installment.percent, 0) === 100;
}

// Settings

const settingsFieldsSchema = z.object({
  /** Printed in the PDF header and footer. */
  companyDetails: z.string().trim().max(600),
  /** Copied into each new quote. */
  defaultTerms: z.string().trim().max(4000),
  defaultValidityDays: z.number().int().min(1).max(QUOTE_LIMITS.validityDays),
  discountThresholdPercent: z.number().int().min(1).max(100),
});

/** `discountThresholdPercent` needs `quotes.approve_discount`; the rest `catalog.manage`. */
export const updateQuoteSettingsSchema = settingsFieldsSchema
  .partial()
  .meta({ id: 'UpdateQuoteSettings' });

export type UpdateQuoteSettings = z.infer<typeof updateQuoteSettingsSchema>;

export const quoteSettingsSchema = settingsFieldsSchema
  .extend({
    updatedAt: z.iso.datetime(),
    updatedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    canEdit: z.boolean(),
    canEditThreshold: z.boolean(),
  })
  .meta({ id: 'QuoteSettings' });

export type QuoteSettings = z.infer<typeof quoteSettingsSchema>;

// Building

const quoteTitleSchema = z.string().trim().min(1).max(120);

export const createQuoteSchema = z
  .object({
    clientId: z.uuid(),
    /** The addressee: a non-archived contact of the client (`UNKNOWN_CONTACT`). */
    contactId: z.uuid().nullable().default(null),
    title: quoteTitleSchema,
    currency: currencySchema.default('USD'),
  })
  .meta({ id: 'CreateQuote' });

export type CreateQuote = z.infer<typeof createQuoteSchema>;

export type CreateQuoteInput = z.input<typeof createQuoteSchema>;

const quantitySchema = z.number().int().min(1).max(QUOTE_LIMITS.quantity);

const revisionRoundsSchema = z.number().int().min(0).max(TASK_LIMITS.revisionLimit);

const quoteLineItemInputSchema = z.object({
  serviceId: z.uuid(),
  quantity: quantitySchema,
  revisionRounds: revisionRoundsSchema,
});

const quoteLineInputSchema = z
  .object({
    /** A line already on the draft keeps its copied name, template and list price. */
    id: z.uuid().optional(),
    section: quoteSectionSchema,
    serviceId: z.uuid().nullable().default(null),
    packageId: z.uuid().nullable().default(null),
    description: optionalText(1000).default(null),
    /** Always 1 on a package line. */
    quantity: quantitySchema,
    unitPriceMinor: minorAmountSchema,
    /** Service lines only. */
    revisionRounds: revisionRoundsSchema.nullable().default(null),
    /** Package lines only: every service of the package once, in order. */
    items: z.array(quoteLineItemInputSchema).max(QUOTE_LIMITS.lineItems).default([]),
  })
  .superRefine((line, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (!line.serviceId === !line.packageId)
      issue('serviceId', 'A line names a service or a package, not both');
    if (line.serviceId) {
      if (line.revisionRounds === null) issue('revisionRounds', 'A service line has rounds');
      if (line.items.length > 0) issue('items', 'Only package lines have items');
    }
    if (line.packageId) {
      if (line.quantity !== 1) issue('quantity', 'A package line has quantity 1');
      if (line.revisionRounds !== null) issue('revisionRounds', 'Set rounds on the items');
      if (line.items.length === 0) issue('items', 'A package line lists its services');
      if (new Set(line.items.map((item) => item.serviceId)).size !== line.items.length)
        issue('items', 'Each service is listed once');
    }
  });

export type QuoteLineInput = z.infer<typeof quoteLineInputSchema>;

const quoteInstallmentInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  percent: z.number().int().min(1).max(100),
});

/**
 * The whole draft, saved at once (edge case 1). The API checks the discounts against the section
 * subtotals (`INVALID_DISCOUNT`), the installments (`INVALID_INSTALLMENTS`), the contact and the
 * catalog items; a currency change re-prices every line from the catalog (rule 3).
 */
export const quoteDraftSchema = z
  .object({
    /** The `updatedAt` the editor loaded; another save since then is `STALE_QUOTE`. */
    updatedAt: z.iso.datetime(),
    contactId: z.uuid().nullable(),
    title: quoteTitleSchema,
    currency: currencySchema,
    validityDays: z.number().int().min(1).max(QUOTE_LIMITS.validityDays),
    oneOffDiscountMinor: minorAmountSchema,
    monthlyDiscountMinor: minorAmountSchema,
    monthlyTermMonths: z.number().int().min(1).max(QUOTE_LIMITS.termMonths).nullable(),
    clientNotes: optionalText(2000),
    terms: optionalText(4000),
    /** In order within each section; more than 50 is `LIMIT_REACHED`. */
    lines: z.array(quoteLineInputSchema),
    installments: z.array(quoteInstallmentInputSchema).max(QUOTE_LIMITS.installments),
  })
  .meta({ id: 'QuoteDraft' });

export type QuoteDraft = z.infer<typeof quoteDraftSchema>;

export type QuoteDraftInput = z.input<typeof quoteDraftSchema>;

export const quoteApprovalActionSchema = z
  .object({ action: z.enum(['request', 'withdraw']) })
  .meta({ id: 'QuoteApprovalAction' });

export type QuoteApprovalAction = z.infer<typeof quoteApprovalActionSchema>;

export const quoteApprovalDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'return']),
    /** Required when returning. */
    note: optionalText(500).default(null),
  })
  .refine((decision) => decision.decision !== 'return' || !!decision.note, {
    message: 'Returning needs a note',
    path: ['note'],
  })
  .meta({ id: 'QuoteApprovalDecision' });

export type QuoteApprovalDecision = z.infer<typeof quoteApprovalDecisionSchema>;

export const sendQuoteSchema = z
  .object({
    /** Lines priced 0 are sent only when confirmed (`ZERO_PRICE`). */
    confirmZeroPrice: z.boolean().default(false),
  })
  .meta({ id: 'SendQuote' });

export type SendQuote = z.infer<typeof sendQuoteSchema>;

/** Rule 10: today to today + 90 days (`INVALID_DATES`). */
export const extendQuoteSchema = z
  .object({ validUntil: calendarDateSchema })
  .meta({ id: 'ExtendQuote' });

export type ExtendQuote = z.infer<typeof extendQuoteSchema>;

/** Rule 11. The date is from the sent day to today (`INVALID_DATES`); `other` needs a note. */
export const rejectQuoteSchema = z
  .object({
    respondedOn: calendarDateSchema,
    contactId: z.uuid().nullable().default(null),
    reason: quoteRejectionReasonSchema,
    note: optionalText(1000).default(null),
  })
  .meta({ id: 'RejectQuote' });

export type RejectQuote = z.infer<typeof rejectQuoteSchema>;

// Responses

const personSchema = z.object({ id: z.uuid(), name: z.string() });

const sectionTotalsSchema = z
  .object({
    subtotalMinor: minorAmountSchema,
    discountMinor: minorAmountSchema,
    netMinor: minorAmountSchema,
    listMinor: minorAmountSchema,
    effectiveDiscountBasisPoints: z.number().int().min(0).max(10000),
  })
  .meta({ id: 'QuoteSectionTotals' });

export const quoteLineItemSchema = z
  .object({
    id: z.uuid(),
    serviceId: z.uuid(),
    name: z.string(),
    department: departmentCodeSchema,
    quantity: z.number().int().min(1),
    revisionRounds: z.number().int().min(0),
    deliverableKind: deliverableKindSchema.nullable(),
    deliverableLabel: z.string().nullable(),
    templateId: z.uuid().nullable(),
  })
  .meta({ id: 'QuoteLineItem' });

export const quoteLineSchema = z
  .object({
    id: z.uuid(),
    section: quoteSectionSchema,
    serviceId: z.uuid().nullable(),
    packageId: z.uuid().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    /** Service lines only. */
    department: departmentCodeSchema.nullable(),
    quantity: z.number().int().min(1),
    unitPriceMinor: minorAmountSchema,
    listUnitPriceMinor: minorAmountSchema.nullable(),
    totalMinor: minorAmountSchema,
    revisionRounds: z.number().int().min(0).nullable(),
    deliverableKind: deliverableKindSchema.nullable(),
    deliverableLabel: z.string().nullable(),
    templateId: z.uuid().nullable(),
    /** The service or package was archived since: a warning on drafts (rule 4). */
    catalogArchived: z.boolean(),
    items: z.array(quoteLineItemSchema),
  })
  .meta({ id: 'QuoteLine' });

export type QuoteLine = z.infer<typeof quoteLineSchema>;

export const quotePermissionsSchema = z
  .object({
    canEdit: z.boolean(),
    canRequestApproval: z.boolean(),
    canWithdrawApproval: z.boolean(),
    canDecideApproval: z.boolean(),
    canSend: z.boolean(),
    canExtend: z.boolean(),
    canReject: z.boolean(),
    canCreateVersion: z.boolean(),
    canArchive: z.boolean(),
  })
  .meta({ id: 'QuotePermissions', description: 'What the caller may do, for the UI' });

export type QuotePermissions = z.infer<typeof quotePermissionsSchema>;

export const quoteSchema = z
  .object({
    id: z.uuid(),
    /** `Q-2026-0007 v2`. */
    displayNumber: z.string(),
    year: z.number().int(),
    number: z.number().int().min(1),
    version: z.number().int().min(1),
    title: z.string(),
    client: z.object({ id: z.uuid(), name: z.string() }),
    accountManager: personSchema,
    currency: currencySchema,
    status: quoteStatusSchema,
    discountApproval: discountApprovalSchema,
    oneOffNetMinor: minorAmountSchema,
    /** Per month. */
    monthlyNetMinor: minorAmountSchema,
    validUntil: calendarDateSchema.nullable(),
    /** Sent, and its last valid day is at most 3 days away. */
    expiresSoon: z.boolean(),
    updatedAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Quote' });

export type Quote = z.infer<typeof quoteSchema>;

export const quoteDetailSchema = quoteSchema
  .extend({
    contact: z.object({ id: z.uuid(), name: z.string(), archived: z.boolean() }).nullable(),
    discountDecision: z
      .object({ by: personSchema, at: z.iso.datetime(), note: z.string().nullable() })
      .nullable(),
    oneOffDiscountMinor: minorAmountSchema,
    monthlyDiscountMinor: minorAmountSchema,
    monthlyTermMonths: z.number().int().min(1).nullable(),
    validityDays: z.number().int().min(1),
    clientNotes: z.string().nullable(),
    terms: z.string().nullable(),
    sentAt: z.iso.datetime().nullable(),
    sentBy: personSchema.nullable(),
    response: z
      .object({
        respondedOn: calendarDateSchema,
        contact: z.object({ id: z.uuid(), name: z.string() }).nullable(),
        note: z.string().nullable(),
        by: personSchema,
        rejectionReason: quoteRejectionReasonSchema.nullable(),
      })
      .nullable(),
    createdBy: personSchema,
    createdAt: z.iso.datetime(),
    /** By section, then position. */
    lines: z.array(quoteLineSchema),
    installments: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        percent: z.number().int(),
        amountMinor: minorAmountSchema,
      }),
    ),
    totals: z
      .object({
        oneOff: sectionTotalsSchema,
        monthly: sectionTotalsSchema,
        monthlyTermTotalMinor: minorAmountSchema.nullable(),
      })
      .meta({ id: 'QuoteTotals' }),
    /** The threshold in force now; a draft sent later is checked against the one then. */
    discountThresholdPercent: z.number().int(),
    needsDiscountApproval: z.boolean(),
    /** Every version of the quote's number, oldest first. */
    versions: z.array(
      z.object({ id: z.uuid(), version: z.number().int(), status: quoteStatusSchema }),
    ),
    permissions: quotePermissionsSchema,
  })
  .meta({ id: 'QuoteDetail' });

export type QuoteDetail = z.infer<typeof quoteDetailSchema>;

export const QUOTE_SORTS = ['updatedAt', 'number', 'validUntil'] as const;

export const quoteListQuerySchema = pageQuerySchema.extend({
  /** Matches the number (`Q-2026-0007` or `7`), the title or the client's trade name. */
  search: z.string().trim().min(1).max(100).optional(),
  status: queryListSchema(quoteStatusSchema).default([...OPEN_QUOTE_STATUSES]),
  clientId: z.uuid().optional(),
  accountManagerId: z.uuid().optional(),
  approval: z.enum(['pending']).optional(),
  /** `true` lists discarded drafts only; needs `quotes.read` with scope all. */
  archived: queryBooleanSchema.default(false),
  /** Only the newest version of each number. */
  latestOnly: queryBooleanSchema.default(true),
  sort: z.enum(QUOTE_SORTS).default('updatedAt'),
  order: sortOrderSchema.default('desc'),
});

export type QuoteListQuery = z.infer<typeof quoteListQuerySchema>;

export const quotePageSchema = pageSchema(quoteSchema).meta({ id: 'QuotePage' });

export type QuotePage = z.infer<typeof quotePageSchema>;

// The frozen render payload of a sent version (rule 12): no list prices (rule 14)

const snapshotLineSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  quantity: z.number().int(),
  unitPriceMinor: minorAmountSchema,
  totalMinor: minorAmountSchema,
  items: z.array(z.object({ name: z.string(), quantity: z.number().int() })),
});

const snapshotSectionSchema = z.object({
  lines: z.array(snapshotLineSchema),
  subtotalMinor: minorAmountSchema,
  discountMinor: minorAmountSchema,
  netMinor: minorAmountSchema,
});

export const quoteSnapshotSchema = z
  .object({
    displayNumber: z.string(),
    title: z.string(),
    companyDetails: z.string(),
    client: z.string(),
    addressee: z.string().nullable(),
    currency: currencySchema,
    sentOn: calendarDateSchema,
    validUntil: calendarDateSchema,
    oneOff: snapshotSectionSchema,
    monthly: snapshotSectionSchema.extend({
      termMonths: z.number().int().nullable(),
      termTotalMinor: minorAmountSchema.nullable(),
    }),
    installments: z.array(
      z.object({ name: z.string(), percent: z.number().int(), amountMinor: minorAmountSchema }),
    ),
    clientNotes: z.string().nullable(),
    terms: z.string().nullable(),
  })
  .meta({ id: 'QuoteSnapshot' });

export type QuoteSnapshot = z.infer<typeof quoteSnapshotSchema>;
