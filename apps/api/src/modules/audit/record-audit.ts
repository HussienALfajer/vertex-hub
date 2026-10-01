import type { AuditAction, AuditEntityType } from '@vertex-hub/contracts';
import { auditEntries, type Database, type Transaction } from '@vertex-hub/db';

/** Who made a change; `null` in an entry means the system or a CLI command. */
export interface AuditActor {
  id: string;
  name: string;
}

export interface NewAuditEntry {
  actor: AuditActor | null;
  /** Without an actor: the client contact who answered through an approval link (F09). */
  actorName?: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  /** Only the changed fields. Never pass password hashes, tokens, links or 2FA secrets. */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Appends an audit entry. Pass the transaction that makes the change, so the change and its
 * entry commit or roll back together (ADR 0013).
 */
export async function recordAudit(
  executor: Database | Transaction,
  entry: NewAuditEntry,
): Promise<void> {
  await executor.insert(auditEntries).values({
    actorId: entry.actor?.id ?? null,
    actorName: entry.actor?.name ?? entry.actorName ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}

/**
 * The fields that differ between two versions of a record, as `before` and `after` for an audit
 * entry; `null` when nothing changed.
 */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T> } | null {
  const changed = (Object.keys(after) as (keyof T)[]).filter(
    (key) => after[key] !== undefined && JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  if (changed.length === 0) return null;
  return {
    before: Object.fromEntries(changed.map((key) => [key, before[key]])) as Partial<T>,
    after: Object.fromEntries(changed.map((key) => [key, after[key]])) as Partial<T>,
  };
}
