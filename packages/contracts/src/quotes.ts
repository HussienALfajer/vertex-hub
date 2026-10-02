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
import { engagementDepartmentsSchema, projectNameSchema } from './projects.js';
import {
  type DeliverableKind,
  deliverableKey,
  deliverableKindSchema,
  retainerStatusSchema,
} from './retainers.js';
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

export type RejectQuoteInput = z.input<typeof rejectQuoteSchema>;

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

/**
 * The PDF of a sent version (rule 12) or of a draft preview (rule 13): queued, rendered and
 * attached, or failed after the worker's retries ("Render again").
 */
export const QUOTE_PDF_STATES = ['pending', 'ready', 'failed'] as const;

export const quotePdfStateSchema = z.enum(QUOTE_PDF_STATES).meta({ id: 'QuotePdfState' });

export type QuotePdfState = z.infer<typeof quotePdfStateSchema>;

export const quotePdfRenderSchema = z
  .object({ state: quotePdfStateSchema })
  .meta({ id: 'QuotePdfRender', description: 'The PDF state after asking for a render' });

export type QuotePdfRender = z.infer<typeof quotePdfRenderSchema>;

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
    /** A sent quote, with `projects.manage` over the client too (A1). */
    canAccept: z.boolean(),
    /** A draft: "Preview PDF"; a sent version whose PDF is not ready: "Render again". */
    canRenderPdf: z.boolean(),
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
    /** The engagements its acceptance created or renewed (A9). */
    project: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    retainer: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    /** The PDF of a version that was sent (rule 12); null for drafts. */
    pdf: z.object({ state: quotePdfStateSchema }).nullable(),
    /** The last draft preview (rule 13); null when none was asked for, and once sent. */
    draftPdf: z
      .object({
        state: quotePdfStateSchema,
        renderedAt: z.iso.datetime().nullable(),
        /** The draft changed since the preview was rendered. */
        outdated: z.boolean(),
      })
      .nullable(),
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
  /** Accepted quotes that created this project or created or renewed this retainer. */
  projectId: z.uuid().optional(),
  retainerId: z.uuid().optional(),
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

// Acceptance and A01 (A1–A12)

/** A counted line or package item of the monthly section (A6). */
export interface CountedQuoteItem {
  kind: DeliverableKind;
  label: string | null;
  quantity: number;
  revisionRounds: number;
}

/** A deliverable line of the retainer an accepted quote creates or renews. */
export interface AcceptedDeliverableLine {
  kind: DeliverableKind;
  label: string | null;
  monthlyQuantity: number;
  revisionLimit: number;
}

/**
 * A6: one deliverable line per `(kind, label)`, in first-seen order, quantities summed and the
 * highest revision rounds as its revision limit; the first label's spelling is kept.
 */
export function mergeDeliverableLines(
  items: readonly CountedQuoteItem[],
): AcceptedDeliverableLine[] {
  const lines = new Map<string, AcceptedDeliverableLine>();
  for (const item of items) {
    const key = deliverableKey(item);
    const line = lines.get(key);
    if (line) {
      line.monthlyQuantity += item.quantity;
      line.revisionLimit = Math.max(line.revisionLimit, item.revisionRounds);
    } else {
      lines.set(key, {
        kind: item.kind,
        label: item.label,
        monthlyQuantity: item.quantity,
        revisionLimit: item.revisionRounds,
      });
    }
  }
  return [...lines.values()];
}

/**
 * A3: the default milestone of each installment, as indexes into `milestones`: the first to the
 * first, the last to the last, the others in order (capped at the last).
 */
export function defaultInstallmentMilestones(installments: number, milestones: number): number[] {
  if (milestones === 0) return [];
  return Array.from({ length: installments }, (_, index) =>
    index === installments - 1 ? milestones - 1 : Math.min(index, milestones - 1),
  );
}

/** The dialog's current choices, so the plan follows them (A2–A5). */
export const acceptPlanQuerySchema = z.object({
  /** Default today. */
  projectStartDate: calendarDateSchema.optional(),
  /** `true`: `templateIds` is the dialog's choice, none included; otherwise the defaults (A2). */
  chooseTemplates: queryBooleanSchema.default(false),
  templateIds: queryListSchema(z.uuid()).default([]),
  /** Default today. */
  retainerStartDate: calendarDateSchema.optional(),
});

export type AcceptPlanQuery = z.infer<typeof acceptPlanQuerySchema>;

const acceptPersonSchema = z.object({ id: z.uuid(), name: z.string() });

export const acceptPlanSchema = z
  .object({
    /** The earliest response date: the sent day (A1). */
    sentOn: calendarDateSchema,
    /** The one-off section's project (A2–A4); null without one-off lines. */
    project: z
      .object({
        name: z.string(),
        /** The client's account manager. */
        projectManager: acceptPersonSchema,
        departments: z.array(departmentCodeSchema),
        startDate: calendarDateSchema,
        /** The latest due date of the selected templates' plans, or start + 30 days. */
        dueDate: calendarDateSchema,
        /** The section's non-archived project templates, in line order (A2, A4). */
        templates: z.array(
          acceptPersonSchema.extend({
            selected: z.boolean(),
            /** The highest revision rounds of the lines and items that bring it (A4). */
            revisionLimit: z.number().int().min(0),
          }),
        ),
        /** The new project's milestones: the selected templates' stages, or the installments. */
        milestones: z.array(z.object({ name: z.string(), dueDate: calendarDateSchema.nullable() })),
        installments: z.array(
          z.object({
            name: z.string(),
            percent: z.number().int(),
            amountMinor: minorAmountSchema,
            /** The default milestone, an index into `milestones`. */
            milestone: z.number().int().min(0),
          }),
        ),
      })
      .nullable(),
    /** The monthly section's retainer (A5–A7); null without monthly lines. */
    retainer: z
      .object({
        name: z.string(),
        departments: z.array(departmentCodeSchema),
        startDate: calendarDateSchema,
        /** Start + the term when a term is set. */
        renewalDate: calendarDateSchema.nullable(),
        /** The default monthly template; null when none is offered. */
        template: acceptPersonSchema.nullable(),
        currency: currencySchema,
        /** The monthly net. */
        monthlyFeeMinor: minorAmountSchema,
        /** The merged deliverable lines (A6); uncounted services are left out. */
        lines: z.array(
          z.object({
            kind: deliverableKindSchema,
            label: z.string().nullable(),
            monthlyQuantity: z.number().int().min(1),
            revisionLimit: z.number().int().min(0),
          }),
        ),
        /** The client's active or paused retainers in the quote's currency (A5, edge case 9). */
        renewable: z.array(acceptPersonSchema.extend({ status: retainerStatusSchema })),
      })
      .nullable(),
    /** Templates of the quote archived since: skipped, with a warning (C3, edge case 8). */
    archivedTemplates: z.array(acceptPersonSchema),
  })
  .meta({ id: 'AcceptPlan' });

export type AcceptPlan = z.infer<typeof acceptPlanSchema>;

const acceptRetainerSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('new'),
    name: projectNameSchema,
    departments: engagementDepartmentsSchema,
    startDate: calendarDateSchema,
    renewalDate: calendarDateSchema.nullable(),
    templateId: z.uuid().nullable(),
  }),
  z.object({
    mode: z.literal('renew'),
    retainerId: z.uuid(),
    /** Replaces the retainer's monthly template when set (A7). */
    templateId: z.uuid().nullable(),
  }),
]);

/**
 * A1–A9. `project` is required when the quote has one-off lines and `retainer` when it has
 * monthly lines; each is refused otherwise.
 */
export const acceptQuoteSchema = z
  .object({
    /** From the sent day to today (`INVALID_DATES`). */
    respondedOn: calendarDateSchema,
    contactId: z.uuid().nullable().default(null),
    note: optionalText(1000).default(null),
    /** An F10 upload, attached as a document of the quote. */
    proofUploadId: z.uuid().nullable().default(null),
    project: z
      .object({
        name: projectNameSchema,
        projectManagerId: z.uuid(),
        departments: engagementDepartmentsSchema,
        startDate: calendarDateSchema,
        dueDate: calendarDateSchema,
        /** Applied in this order; the milestones follow from them as in the plan (A3). */
        templateIds: z
          .array(z.uuid())
          .max(QUOTE_LIMITS.lines)
          .refine((ids) => new Set(ids).size === ids.length, 'Each template once'),
        /** Per installment, in order: its milestone, an index into the plan's milestones. */
        installmentMilestones: z.array(z.number().int().min(0)).max(QUOTE_LIMITS.installments),
      })
      .nullable()
      .default(null),
    retainer: acceptRetainerSchema.nullable().default(null),
  })
  .meta({ id: 'AcceptQuote' });

export type AcceptQuote = z.infer<typeof acceptQuoteSchema>;

export type AcceptQuoteInput = z.input<typeof acceptQuoteSchema>;
