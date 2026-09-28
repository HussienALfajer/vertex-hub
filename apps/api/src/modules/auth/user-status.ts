import type { UserStatus } from '@vertex-hub/contracts';
import { accounts, type Transaction, users } from '@vertex-hub/db';
import { sql } from 'drizzle-orm';

/** SQL: the user in `users` has set a password. */
export const hasPassword = sql<boolean>`exists (
  select 1 from ${accounts}
  where ${accounts.userId} = ${users.id}
    and ${accounts.providerId} = 'credential'
    and ${accounts.password} is not null)`;

/** SQL: the derived status of the user in `users` (never stored, F01). */
export const statusOf = sql<UserStatus>`case
  when ${users.archivedAt} is not null then 'archived'
  when ${hasPassword} then 'active'
  else 'invited' end`;

/**
 * Serializes every change to users, roles, memberships and department managers, so rules that
 * span rows (the last active General Manager, a manager is an active member, archiving waits
 * for responsibilities) hold under concurrent requests. Small team: one lock is enough.
 */
export async function lockAccessChanges(tx: Transaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${7_140_014})`);
}
