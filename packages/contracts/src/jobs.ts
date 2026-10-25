/*
 * Jobs shared by the API and the worker (ADR 0008): the worker owns the schedules, the API
 * process works their queues through its module services. The worker works the renders that need
 * no module state (`quotes.pdf`) and hands the result back to the API.
 */

import { z } from 'zod';
import { adDepositReceiptSnapshotSchema } from './campaigns.js';
import { BUSINESS_TIME_ZONE } from './dates.js';
import { emailAddressSchema, emailKindSchema } from './email-basics.js';
import { EMAIL_LIMITS, emailAttachmentSchema } from './emails.js';
import {
  invoiceDraftSnapshotSchema,
  invoiceSnapshotSchema,
  receiptSnapshotSchema,
  statementSnapshotSchema,
} from './invoices.js';
import { PUSH_LIMITS, pushPayloadSchema } from './push.js';
import { quoteSnapshotSchema } from './quotes.js';
import { clientReportSnapshotSchema, cycleReportSnapshotSchema } from './reports.js';
import { annexSnapshotSchema, contractSnapshotSchema } from './retainer-contracts.js';

/** F05 R2: closes past retainer cycles and opens the current month's, once a day. */
export const RETAINER_CYCLES_JOB = {
  queue: 'retainers.cycles',
  cron: '5 0 * * *',
  tz: BUSINESS_TIME_ZONE,
} as const;

/**
 * F17: the HR day at 00:10. Part A: the contract and probation reminders (rule A7) and the
 * archiving of accounts whose service ended (rule A8); parts B–D add days, accruals and items.
 */
export const HR_DAILY_JOB = {
  queue: 'hr.daily',
  cron: '10 0 * * *',
  tz: BUSINESS_TIME_ZONE,
} as const;

/**
 * F14 rule 8: due-soon, overdue and renewal reminders, then the purge of old read notifications,
 * at 09:00 on work days (Saturday to Thursday).
 */
export const NOTIFICATIONS_DAILY_JOB = {
  queue: 'notifications.daily',
  cron: '0 9 * * 0-4,6',
  tz: BUSINESS_TIME_ZONE,
} as const;

/**
 * F09 rules 24 and 25 (A04): the 48-hour "no response" notice and the "link expired" notice of
 * approval requests, every hour.
 */
export const APPROVALS_REMINDERS_JOB = {
  queue: 'approvals.reminders',
  cron: '15 * * * *',
  tz: BUSINESS_TIME_ZONE,
} as const;

/** F10 rule 18: renders the thumbnail and preview of an image upload; queued on attach. */
export const FILES_PREVIEW_JOB = { queue: 'files.preview', retryLimit: 3 } as const;

/** F10: deletes uploads left unattached for 24 hours, and their content, daily at 03:00. */
export const FILES_PURGE_UPLOADS_JOB = {
  queue: 'files.purge-uploads',
  cron: '0 3 * * *',
  tz: BUSINESS_TIME_ZONE,
} as const;

/** F04 rule 9: expires sent quotes whose last valid day has passed, once a day. */
export const QUOTES_DAILY_JOB = {
  queue: 'quotes.daily',
  cron: '10 0 * * *',
  tz: BUSINESS_TIME_ZONE,
} as const;

/**
 * F13 A10: marks issued invoices past their due date `overdue` and alerts Finance, the Internal
 * Operations manager and the account manager, once a day.
 */
export const INVOICES_DAILY_JOB = {
  queue: 'invoices.daily',
  cron: '15 0 * * *',
  tz: BUSINESS_TIME_ZONE,
} as const;

/**
 * F04 rules 12 and 13: renders the PDF of a sent version or a draft preview. Queued by the API,
 * worked by the worker (Chromium). The job carries the frozen render payload and its hash, so
 * the worker reads no business table; the hash names the output, so a rerun writes nothing new.
 */
export const QUOTES_PDF_JOB = { queue: 'quotes.pdf', retryLimit: 3 } as const;

/** SHA-256 of a render payload, hex. */
const renderHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** The PDF a render stored, handed back to the API; null when the render failed for good. */
const renderedFileSchema = z
  .object({
    storageKey: z.string().min(1),
    sizeBytes: z.number().int().min(1),
    sha256: renderHashSchema,
  })
  .nullable();

/**
 * F01C rule 14: the storage key of the client's current logo under `FILES_ROOT`, printed beside
 * the client's name; null without one. Read when the job is queued, so a render keeps the logo it
 * was queued with. Outside the hash: the logo does not make another document.
 */
const clientLogoKeySchema = z.string().min(1).nullable().default(null);

/** A client-facing PDF job before it is queued: the API adds `clientLogoKey` when it sends it. */
export type UnqueuedPdfJob<Job> = Job extends unknown ? Omit<Job, 'clientLogoKey'> : never;

export const quotePdfJobSchema = z.object({
  quoteId: z.uuid(),
  /** A draft preview, printed with a "draft" watermark. */
  draft: z.boolean(),
  /** SHA-256 of the payload, hex. */
  hash: renderHashSchema,
  clientLogoKey: clientLogoKeySchema,
  snapshot: quoteSnapshotSchema,
});

export type QuotePdfJob = z.infer<typeof quotePdfJobSchema>;

/** Where the worker writes the PDF of a render, under `FILES_ROOT`. */
export const quotePdfStorageKey = (job: Pick<QuotePdfJob, 'quoteId' | 'hash'>) =>
  `objects/quotes/${job.quoteId}/${job.hash}.pdf`;

/**
 * F04 rules 12 and 13: the result of a `quotes.pdf` render, worked by the API: attached as a
 * document of the quote, kept as the draft preview, or marked failed after the last retry.
 */
export const QUOTES_PDF_READY_JOB = { queue: 'quotes.pdf-ready' } as const;

export const quotePdfReadyJobSchema = quotePdfJobSchema
  .pick({ quoteId: true, draft: true, hash: true })
  .extend({
    /** The stored PDF; null when the render failed for good. */
    file: renderedFileSchema,
  });

export type QuotePdfReadyJob = z.infer<typeof quotePdfReadyJobSchema>;

/**
 * F13 rules 15, 20 and 29: renders the PDF of an issued invoice, a draft preview, a payment's
 * receipt or a client statement, as `quotes.pdf` does. `id` is the record the result goes back
 * to: the invoice, the payment, or the statement render.
 */
export const INVOICES_PDF_JOB = { queue: 'invoices.pdf', retryLimit: 3 } as const;

export const INVOICE_PDF_KINDS = ['invoice', 'invoice_draft', 'receipt', 'statement'] as const;

export type InvoicePdfKind = (typeof INVOICE_PDF_KINDS)[number];

export const invoicePdfJobSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('invoice'),
    id: z.uuid(),
    hash: renderHashSchema,
    clientLogoKey: clientLogoKeySchema,
    snapshot: invoiceSnapshotSchema,
  }),
  z.object({
    kind: z.literal('invoice_draft'),
    id: z.uuid(),
    hash: renderHashSchema,
    clientLogoKey: clientLogoKeySchema,
    snapshot: invoiceDraftSnapshotSchema,
  }),
  z.object({
    kind: z.literal('receipt'),
    id: z.uuid(),
    hash: renderHashSchema,
    clientLogoKey: clientLogoKeySchema,
    snapshot: receiptSnapshotSchema,
  }),
  z.object({
    kind: z.literal('statement'),
    id: z.uuid(),
    hash: renderHashSchema,
    clientLogoKey: clientLogoKeySchema,
    snapshot: statementSnapshotSchema,
  }),
]);

export type InvoicePdfJob = z.infer<typeof invoicePdfJobSchema>;

const INVOICE_PDF_FOLDERS: Record<InvoicePdfKind, string> = {
  invoice: 'invoices',
  invoice_draft: 'invoices',
  receipt: 'receipts',
  statement: 'statements',
};

/** Where the worker writes the PDF of an `invoices.pdf` render, under `FILES_ROOT`. */
export const invoicePdfStorageKey = (job: Pick<InvoicePdfJob, 'kind' | 'id' | 'hash'>) =>
  `objects/${INVOICE_PDF_FOLDERS[job.kind]}/${job.id}/${job.hash}.pdf`;

/**
 * The result of an `invoices.pdf` render, worked by the API: attached as a document of the
 * invoice (invoices and receipts), kept as the draft preview, recorded as a statement render, or
 * marked failed after the last retry.
 */
export const INVOICES_PDF_READY_JOB = { queue: 'invoices.pdf-ready' } as const;

export const invoicePdfReadyJobSchema = z.object({
  kind: z.enum(INVOICE_PDF_KINDS),
  id: z.uuid(),
  hash: renderHashSchema,
  file: renderedFileSchema,
});

export type InvoicePdfReadyJob = z.infer<typeof invoicePdfReadyJobSchema>;

/**
 * F12 rule 19: renders the receipt PDF of an ad budget deposit, as `invoices.pdf` does. `id` is
 * the wallet entry the result goes back to.
 */
export const CAMPAIGNS_PDF_JOB = { queue: 'campaigns.pdf', retryLimit: 3 } as const;

export const campaignPdfJobSchema = z.object({
  kind: z.literal('ad_deposit_receipt'),
  id: z.uuid(),
  hash: renderHashSchema,
  clientLogoKey: clientLogoKeySchema,
  snapshot: adDepositReceiptSnapshotSchema,
});

export type CampaignPdfJob = z.infer<typeof campaignPdfJobSchema>;

/** Where the worker writes the PDF of a `campaigns.pdf` render, under `FILES_ROOT`. */
export const campaignPdfStorageKey = (job: Pick<CampaignPdfJob, 'id' | 'hash'>) =>
  `objects/ad-receipts/${job.id}/${job.hash}.pdf`;

/**
 * The result of a `campaigns.pdf` render, worked by the API: attached once as a document of the
 * wallet entry, or marked failed after the last retry.
 */
export const CAMPAIGNS_PDF_READY_JOB = { queue: 'campaigns.pdf-ready' } as const;

export const campaignPdfReadyJobSchema = campaignPdfJobSchema
  .pick({ kind: true, id: true, hash: true })
  .extend({ file: renderedFileSchema });

export type CampaignPdfReadyJob = z.infer<typeof campaignPdfReadyJobSchema>;

/**
 * F15 rule 20: renders the monthly client report PDF, as `invoices.pdf` renders a statement. `id`
 * is the `client_report_pdfs` row the result goes back to. F05C R1: also the cycle report PDF,
 * whose `id` is the cycle (its `retainer_cycle_reports` row).
 */
export const REPORTS_PDF_JOB = { queue: 'reports.pdf', retryLimit: 3 } as const;

export const REPORT_PDF_KINDS = ['client_report', 'cycle_report'] as const;

export const reportPdfJobSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('client_report'),
    id: z.uuid(),
    hash: renderHashSchema,
    clientLogoKey: clientLogoKeySchema,
    snapshot: clientReportSnapshotSchema,
  }),
  z.object({
    kind: z.literal('cycle_report'),
    id: z.uuid(),
    hash: renderHashSchema,
    clientLogoKey: clientLogoKeySchema,
    snapshot: cycleReportSnapshotSchema,
  }),
]);

export type ReportPdfJob = z.infer<typeof reportPdfJobSchema>;

const REPORT_PDF_FOLDERS: Record<ReportPdfJob['kind'], string> = {
  client_report: 'client-reports',
  cycle_report: 'cycle-reports',
};

/** Where the worker writes the PDF of a `reports.pdf` render, under `FILES_ROOT`. */
export const reportPdfStorageKey = (job: Pick<ReportPdfJob, 'kind' | 'id' | 'hash'>) =>
  `objects/${REPORT_PDF_FOLDERS[job.kind]}/${job.id}/${job.hash}.pdf`;

/** The result of a `reports.pdf` render, worked by the API: recorded on its row, or failed. */
export const REPORTS_PDF_READY_JOB = { queue: 'reports.pdf-ready' } as const;

export const reportPdfReadyJobSchema = z.object({
  kind: z.enum(REPORT_PDF_KINDS),
  id: z.uuid(),
  hash: renderHashSchema,
  file: renderedFileSchema,
});

export type ReportPdfReadyJob = z.infer<typeof reportPdfReadyJobSchema>;

/**
 * F05C K4, K10: renders the PDF of an issued contract, a draft preview or an annex, as
 * `invoices.pdf` does. `id` is the contract (`contract`, `contract_draft`) or the annex.
 */
export const CONTRACTS_PDF_JOB = { queue: 'contracts.pdf', retryLimit: 3 } as const;

export const CONTRACT_PDF_KINDS = ['contract', 'contract_draft', 'annex'] as const;

export const contractPdfJobSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('contract'),
    id: z.uuid(),
    hash: renderHashSchema,
    clientLogoKey: clientLogoKeySchema,
    snapshot: contractSnapshotSchema,
  }),
  z.object({
    kind: z.literal('contract_draft'),
    id: z.uuid(),
    hash: renderHashSchema,
    clientLogoKey: clientLogoKeySchema,
    snapshot: contractSnapshotSchema,
  }),
  z.object({
    kind: z.literal('annex'),
    id: z.uuid(),
    hash: renderHashSchema,
    clientLogoKey: clientLogoKeySchema,
    snapshot: annexSnapshotSchema,
  }),
]);

export type ContractPdfJob = z.infer<typeof contractPdfJobSchema>;

const CONTRACT_PDF_FOLDERS: Record<ContractPdfJob['kind'], string> = {
  contract: 'contracts',
  contract_draft: 'contracts',
  annex: 'contract-annexes',
};

/** Where the worker writes the PDF of a `contracts.pdf` render, under `FILES_ROOT`. */
export const contractPdfStorageKey = (job: Pick<ContractPdfJob, 'kind' | 'id' | 'hash'>) =>
  `objects/${CONTRACT_PDF_FOLDERS[job.kind]}/${job.id}/${job.hash}.pdf`;

/**
 * The result of a `contracts.pdf` render, worked by the API: attached as a document of the
 * contract, kept as the draft preview, or marked failed after the last retry.
 */
export const CONTRACTS_PDF_READY_JOB = { queue: 'contracts.pdf-ready' } as const;

export const contractPdfReadyJobSchema = z.object({
  kind: z.enum(CONTRACT_PDF_KINDS),
  id: z.uuid(),
  hash: renderHashSchema,
  file: renderedFileSchema,
});

export type ContractPdfReadyJob = z.infer<typeof contractPdfReadyJobSchema>;

/**
 * F05C R1: a cycle closed; the API prepares its report PDF once the closing transaction
 * committed (the snapshot reads the frozen counts). Queued in that transaction; a missed nudge is
 * caught by the next request of the PDF, which renders whatever is not current.
 */
export const REPORTS_CYCLE_REPORT_JOB = { queue: 'reports.cycle-report' } as const;

export const cycleReportJobSchema = z.object({ retainerId: z.uuid(), cycleId: z.uuid() });

export type CycleReportJob = z.infer<typeof cycleReportJobSchema>;

/**
 * F14 email (ADR 0028): sends one email of the outbox. Queued by `Mailer.queue` in the
 * transaction of the change, worked by the worker (render, SMTP). As the render jobs, it carries
 * everything the email needs, so the worker reads no table; the outcome goes back to the API
 * (`email.result`), which changes only a `queued` row.
 */
export const EMAIL_SEND_JOB = {
  queue: 'email.send',
  retryLimit: 3,
  /** Seconds before the first retry, doubled for each next one. */
  retryDelay: 60,
  retryBackoff: true,
} as const;

export const emailSendJobSchema = z.object({
  id: z.uuid(),
  kind: emailKindSchema,
  to: z.array(emailAddressSchema).min(1).max(EMAIL_LIMITS.to),
  cc: z.array(emailAddressSchema).max(EMAIL_LIMITS.cc),
  replyTo: z.email().nullable(),
  subject: z.string().min(1).max(EMAIL_LIMITS.subject),
  message: z.string().max(EMAIL_LIMITS.message).nullable(),
  /** Validated by the worker with the kind's schema in `EMAIL_DATA_SCHEMAS`. */
  data: z.record(z.string(), z.unknown()),
  attachments: z.array(emailAttachmentSchema),
  /**
   * The token links of `EMAIL_SECRET_FIELDS`, as JSON encrypted with AES-256-GCM under
   * `EMAIL_SECRET_KEY` (base64url of IV, tag and ciphertext); `data` holds `REDACTED` there.
   */
  sealed: z.string().nullable().default(null),
});

export type EmailSendJob = z.infer<typeof emailSendJobSchema>;

/** The outcome of an `email.send`, worked by the API: `sent`, or `failed` after the last retry. */
export const EMAIL_RESULT_JOB = { queue: 'email.result' } as const;

export const emailResultJobSchema = z.discriminatedUnion('status', [
  z.object({
    id: z.uuid(),
    status: z.literal('sent'),
    attempts: z.number().int().min(1),
    providerMessageId: z.string().nullable(),
    sentAt: z.iso.datetime(),
  }),
  z.object({
    id: z.uuid(),
    status: z.literal('failed'),
    attempts: z.number().int().min(1),
    error: z.string().max(EMAIL_LIMITS.error),
  }),
]);

export type EmailResultJob = z.infer<typeof emailResultJobSchema>;

/**
 * F14 email rules 6–7: every 5 minutes, emails each recipient's pending notifications in one
 * batch; acts only on work days from 08:10 to 20:00. Worked by the API.
 */
export const EMAIL_NOTIFICATIONS_JOB = {
  queue: 'email.notifications',
  cron: '*/5 * * * *',
  tz: BUSINESS_TIME_ZONE,
} as const;

/**
 * F16 rule B13: every minute, wakes snoozed notifications. Worked by the API. A run that finds
 * nothing does nothing; a missed minute is caught up by the next.
 */
export const NOTIFICATIONS_TIMED_JOB = {
  queue: 'notifications.timed',
  cron: '* * * * *',
  tz: BUSINESS_TIME_ZONE,
} as const;

/**
 * F14 email rule 10: the morning digest, 08:00 on work days, and the morning push summary (F16
 * rule B14). Worked by the API.
 */
export const EMAIL_DIGEST_JOB = {
  queue: 'email.digest',
  cron: '0 8 * * 0-4,6',
  tz: BUSINESS_TIME_ZONE,
} as const;

/** F14 rule 25: deletes staff emails older than 90 days, daily at 03:30. */
export const EMAIL_PURGE_JOB = {
  queue: 'email.purge',
  cron: '30 3 * * *',
  tz: BUSINESS_TIME_ZONE,
} as const;

/**
 * F16 rule A8 (ADR 0036): sends one push to one subscription. Queued by `NotificationCenter` in
 * the transaction of the notification, one job per device, so a retry resends only that message.
 * It carries the rendered payload and the subscription, so the worker reads no table; the outcome
 * goes back to the API (`push.result`).
 */
export const PUSH_SEND_JOB = {
  queue: 'push.send',
  retryLimit: 3,
  /** Seconds before the first retry, doubled for each next one. */
  retryDelay: 30,
  retryBackoff: true,
} as const;

export const pushSendJobSchema = z.object({
  subscription: z.object({
    endpoint: z.string().max(PUSH_LIMITS.endpoint),
    keys: z.object({ p256dh: z.string(), auth: z.string() }),
  }),
  urgency: z.enum(['high', 'normal', 'low']),
  ttlSeconds: z.number().int().min(0),
  payload: pushPayloadSchema,
});

export type PushSendJob = z.infer<typeof pushSendJobSchema>;

/**
 * The outcome of a `push.send`, worked by the API: `sent`; `gone` when the push service refused
 * the subscription for good (404, 410); `failed` after the last retry.
 */
export const PUSH_RESULT_JOB = { queue: 'push.result' } as const;

export const pushResultJobSchema = z.discriminatedUnion('status', [
  z.object({
    deliveryId: z.uuid(),
    status: z.literal('sent'),
    attempts: z.number().int().min(1),
    sentAt: z.iso.datetime(),
  }),
  z.object({
    deliveryId: z.uuid(),
    status: z.enum(['gone', 'failed']),
    attempts: z.number().int().min(1),
    error: z.string().max(PUSH_LIMITS.error),
  }),
]);

export type PushResultJob = z.infer<typeof pushResultJobSchema>;
