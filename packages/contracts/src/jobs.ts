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
