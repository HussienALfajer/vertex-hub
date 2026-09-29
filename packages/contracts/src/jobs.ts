/*
 * Scheduled jobs the worker registers in pg-boss and the API runs (ADR 0008): the worker owns the
 * schedule, the API process works the queue through its module services.
 */

/** F05 R2: closes past retainer cycles and opens the current month's, once a day. */
export const RETAINER_CYCLES_JOB = {
  queue: 'retainers.cycles',
  cron: '5 0 * * *',
  tz: 'Asia/Damascus',
} as const;
