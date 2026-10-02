/*
 * Jobs shared by the API and the worker (ADR 0008): the worker owns the schedules, the API
 * process works their queues through its module services. The worker works the renders that need
 * no module state (`quotes.pdf`) and hands the result back to the API.
 */

import { z } from 'zod';
import { BUSINESS_TIME_ZONE } from './dates.js';
import { quoteSnapshotSchema } from './quotes.js';

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
 * F04 rules 12 and 13: renders the PDF of a sent version or a draft preview. Queued by the API,
 * worked by the worker (Chromium). The job carries the frozen render payload and its hash, so
 * the worker reads no business table; the hash names the output, so a rerun writes nothing new.
 */
export const QUOTES_PDF_JOB = { queue: 'quotes.pdf', retryLimit: 3 } as const;

export const quotePdfJobSchema = z.object({
  quoteId: z.uuid(),
  /** A draft preview, printed with a "draft" watermark. */
  draft: z.boolean(),
  /** SHA-256 of the payload, hex. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
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
    file: z
      .object({
        storageKey: z.string().min(1),
        sizeBytes: z.number().int().min(1),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .nullable(),
  });

export type QuotePdfReadyJob = z.infer<typeof quotePdfReadyJobSchema>;
