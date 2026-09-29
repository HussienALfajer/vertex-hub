import { bigint, timestamp, uuid } from 'drizzle-orm/pg-core';
import { newId } from '../id.js';

/*
 * Column building blocks shared by every schema file (ADR 0013). A business table is
 * `{ id: id(), ...fields, ...timestamps(), archivedAt: archivedAt() }`.
 */

/** Primary key: a UUIDv7 generated in the application. */
export const id = () => uuid('id').primaryKey().$defaultFn(newId);

/** Creation and last-update times, in UTC. */
export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Set when a business record is archived; business records are never hard-deleted. */
export const archivedAt = () => timestamp('archived_at', { withTimezone: true });

/** A money amount in minor units of the record's currency (ADR 0006), as `<name>_minor`. */
export const minorAmount = (name: `${string}_minor`) => bigint(name, { mode: 'number' });
