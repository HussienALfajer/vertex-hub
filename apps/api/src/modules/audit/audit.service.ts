import { Inject, Injectable } from '@nestjs/common';
import type { AuditListQuery, AuditPage } from '@vertex-hub/contracts';
import { auditEntries, type Database } from '@vertex-hub/db';
import { and, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';

/** F17: the pay fields of HR entries, left out for readers without `salaries.read`. */
const PAY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  salary_change: ['amountMinor'],
  employee_file: ['payoutMethod', 'payoutInstitution', 'payoutAccount', 'payoutHolder'],
};

function withoutPay(
  entityType: string,
  fields: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const hidden = PAY_FIELDS[entityType];
  if (!fields || !hidden) return fields;
  return Object.fromEntries(Object.entries(fields).filter(([key]) => !hidden.includes(key)));
}

@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Entries matching the filters, newest first (ids are UUIDv7, so they sort by time too). */
  async list(query: AuditListQuery, options: { showsPay: boolean }): Promise<AuditPage> {
    const filters: SQL[] = [];
    if (query.entityType) filters.push(eq(auditEntries.entityType, query.entityType));
    if (query.entityId) filters.push(eq(auditEntries.entityId, query.entityId));
    if (query.actorId) filters.push(eq(auditEntries.actorId, query.actorId));
    if (query.action) filters.push(eq(auditEntries.action, query.action));
    if (query.from) filters.push(gte(auditEntries.occurredAt, new Date(query.from)));
    if (query.to) filters.push(lte(auditEntries.occurredAt, new Date(query.to)));
    const where = and(...filters);

    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(auditEntries)
        .where(where)
        .orderBy(desc(auditEntries.occurredAt), desc(auditEntries.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(auditEntries).where(where),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        actorId: row.actorId,
        actorName: row.actorName,
        // Written only through `recordAudit`, which takes the contract types.
        action: row.action as AuditPage['items'][number]['action'],
        entityType: row.entityType as AuditPage['items'][number]['entityType'],
        entityId: row.entityId,
        before: options.showsPay ? row.before : withoutPay(row.entityType, row.before),
        after: options.showsPay ? row.after : withoutPay(row.entityType, row.after),
      })),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
