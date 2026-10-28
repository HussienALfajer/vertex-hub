import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { DepartmentCode } from '@vertex-hub/contracts';
import { catalogServices, type Transaction } from '@vertex-hub/db';
import { asc, count, eq } from 'drizzle-orm';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { DepartmentTransfers, type TransferPreview } from '../auth/index.js';

const PREVIEW_ITEMS = 5;

/**
 * F23 rule 10: the services an archived department performs, active and archived, move to the
 * services target.
 */
@Injectable()
export class CatalogDepartmentTransfers implements OnModuleInit {
  constructor(private readonly transfers: DepartmentTransfers) {}

  onModuleInit(): void {
    this.transfers.register({
      category: 'services',
      preview: (tx, code) => this.preview(tx, code),
      move: (tx, from, to, actor) => this.move(tx, from, to, actor),
    });
  }

  private async preview(tx: Transaction, code: DepartmentCode): Promise<TransferPreview> {
    const [total] = await tx
      .select({ value: count() })
      .from(catalogServices)
      .where(eq(catalogServices.department, code));
    const items = await tx
      .select({ id: catalogServices.id, name: catalogServices.name })
      .from(catalogServices)
      .where(eq(catalogServices.department, code))
      .orderBy(asc(catalogServices.name), asc(catalogServices.id))
      .limit(PREVIEW_ITEMS);
    return { count: total?.value ?? 0, items };
  }

  private async move(
    tx: Transaction,
    from: DepartmentCode,
    to: DepartmentCode,
    actor: AuditActor,
  ): Promise<number> {
    const moved = await tx
      .update(catalogServices)
      .set({ department: to })
      .where(eq(catalogServices.department, from))
      .returning({ id: catalogServices.id });
    for (const service of moved) {
      await recordAudit(tx, {
        actor,
        action: 'catalog_service.updated',
        entityType: 'catalog_service',
        entityId: service.id,
        before: { department: from },
        after: { department: to, reason: 'department_archived' },
      });
    }
    return moved.length;
  }
}
