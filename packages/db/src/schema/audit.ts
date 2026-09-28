import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { id } from './columns.js';

/**
 * Append-only record of every change to a business record (ADR 0013), owned by the api `audit`
 * module. Rows are never updated or deleted. `actor_name` keeps the actor's name at the time of
 * the change; a null actor is the system or a CLI command.
 */
export const auditEntries = pgTable(
  'audit_entries',
  {
    id: id(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id').references(() => users.id),
    actorName: text('actor_name'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
  },
  (table) => [
    index('audit_entries_entity_idx').on(table.entityType, table.entityId),
    index('audit_entries_actor_id_idx').on(table.actorId),
    index('audit_entries_occurred_at_idx').on(table.occurredAt),
  ],
);
