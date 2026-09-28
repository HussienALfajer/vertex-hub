import type { AuditAction, AuditEntityType } from '@vertex-hub/contracts';
import { auditEntries, type Database, type Transaction } from '@vertex-hub/db';

/** Who made a change; `null` in an entry means the system or a CLI command. */
export interface AuditActor {
  id: string;
  name: string;
}

export interface NewAuditEntry {
  actor: AuditActor | null;
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
    actorName: entry.actor?.name ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
