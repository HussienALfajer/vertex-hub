import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Last time each background worker process ran its heartbeat job. System data, not a business record. */
export const workerHeartbeats = pgTable('worker_heartbeats', {
  worker: text('worker').primaryKey(),
  beatAt: timestamp('beat_at', { withTimezone: true }).notNull(),
});
