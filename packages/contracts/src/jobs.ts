/*
 * Scheduled jobs the worker registers in pg-boss and the API runs (ADR 0008): the worker owns the
 * schedule, the API process works the queue through its module services.
 */

import { BUSINESS_TIME_ZONE } from './dates.js';

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

/** F10 rule 18: renders the thumbnail and preview of an image upload; queued on attach. */
export const FILES_PREVIEW_JOB = { queue: 'files.preview', retryLimit: 3 } as const;

/** F10: deletes uploads left unattached for 24 hours, and their content, daily at 03:00. */
export const FILES_PURGE_UPLOADS_JOB = {
  queue: 'files.purge-uploads',
  cron: '0 3 * * *',
  tz: BUSINESS_TIME_ZONE,
} as const;
