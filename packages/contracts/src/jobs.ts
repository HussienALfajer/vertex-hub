/*
 * Jobs shared by the API and the worker (ADR 0008): the worker owns the schedules, the API
 * process works their queues through its module services. The worker works the renders that need
 * no module state (`quotes.pdf`) and hands the result back to the API.
 */

import { z } from 'zod';
import { adDepositReceiptSnapshotSchema } from './campaigns.js';
import { BUSINESS_TIME_ZONE } from './dates.js';
import {
  EMAIL_LIMITS,
  emailAddressSchema,
  emailAttachmentSchema,
  emailKindSchema,
} from './emails.js';
import {
  invoiceDraftSnapshotSchema,
  invoiceSnapshotSchema,
  receiptSnapshotSchema,
  statementSnapshotSchema,
} from './invoices.js';
import { quoteSnapshotSchema } from './quotes.js';
import { clientReportSnapshotSchema } from './reports.js';

/** F05 R2: closes past retainer cycles and opens the current month's, once a day. */
export const RETAINER_CYCLES_JOB = {
  queue: 'retainers.cycles',
  cron: '5 0 * * *',
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

export const quotePdfJobSchema = z.object({
  quoteId: z.uuid(),
  /** A draft preview, printed with a "draft" watermark. */
  draft: z.boolean(),
  /** SHA-256 of the payload, hex. */
  hash: renderHashSchema,
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
    snapshot: invoiceSnapshotSchema,
  }),
  z.object({
    kind: z.literal('invoice_draft'),
    id: z.uuid(),
    hash: renderHashSchema,
    snapshot: invoiceDraftSnapshotSchema,
  }),
  z.object({
    kind: z.literal('receipt'),
    id: z.uuid(),
    hash: renderHashSchema,
    snapshot: receiptSnapshotSchema,
  }),
  z.object({
    kind: z.literal('statement'),
    id: z.uuid(),
    hash: renderHashSchema,
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
 * is the `client_report_pdfs` row the result goes back to.
 */
export const REPORTS_PDF_JOB = { queue: 'reports.pdf', retryLimit: 3 } as const;

export const reportPdfJobSchema = z.object({
  kind: z.literal('client_report'),
  id: z.uuid(),
  hash: renderHashSchema,
  snapshot: clientReportSnapshotSchema,
});

export type ReportPdfJob = z.infer<typeof reportPdfJobSchema>;

/** Where the worker writes the PDF of a `reports.pdf` render, under `FILES_ROOT`. */
export const reportPdfStorageKey = (job: Pick<ReportPdfJob, 'id' | 'hash'>) =>
  `objects/client-reports/${job.id}/${job.hash}.pdf`;

/** The result of a `reports.pdf` render, worked by the API: recorded on its row, or failed. */
export const REPORTS_PDF_READY_JOB = { queue: 'reports.pdf-ready' } as const;

export const reportPdfReadyJobSchema = reportPdfJobSchema
  .pick({ kind: true, id: true, hash: true })
  .extend({ file: renderedFileSchema });

export type ReportPdfReadyJob = z.infer<typeof reportPdfReadyJobSchema>;

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

/** F14 email rule 10: the morning digest, 08:00 on work days. Worked by the API. */
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
