import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type DepartmentCode, OPEN_QUOTE_STATUSES } from '@vertex-hub/contracts';
import { quoteLineItems, quoteLines, quotes, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { DepartmentTransfers, type TransferPreview } from '../auth/index.js';

const PREVIEW_ITEMS = 5;

const open = inArray(quotes.status, [...OPEN_QUOTE_STATUSES]);

/** SQL: the line, or one of its items, names the department. */
const namesDepartment = (code: DepartmentCode) =>
  or(
    eq(quoteLines.department, code),
    sql`exists (select 1 from ${quoteLineItems}
      where ${quoteLineItems.lineId} = ${quoteLines.id} and ${quoteLineItems.department} = ${code})`,
  ) as SQL;

/**
 * F23 rule 10: the lines of open quotes (`OPEN_QUOTE_STATUSES`) and their package items move to
 * the services target with the catalog services; accepted, rejected and superseded quotes keep
 * the archived department (rule 11).
 */
@Injectable()
export class QuoteDepartmentTransfers implements OnModuleInit {
  constructor(private readonly transfers: DepartmentTransfers) {}

  onModuleInit(): void {
    this.transfers.register({
      category: 'services',
      preview: (tx, code) => this.preview(tx, code),
      move: (tx, from, to, actor) => this.move(tx, from, to, actor),
    });
  }

  /** Counts lines and items; lists the quotes. */
  private async preview(tx: Transaction, code: DepartmentCode): Promise<TransferPreview> {
    const [lines] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(quoteLines)
      .innerJoin(quotes, eq(quotes.id, quoteLines.quoteId))
      .where(and(open, eq(quoteLines.department, code)));
    const [items] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(quoteLineItems)
      .innerJoin(quoteLines, eq(quoteLines.id, quoteLineItems.lineId))
      .innerJoin(quotes, eq(quotes.id, quoteLines.quoteId))
      .where(and(open, eq(quoteLineItems.department, code)));
    const listed = await tx
      .selectDistinct({ id: quotes.id, name: quotes.title })
      .from(quotes)
      .innerJoin(quoteLines, eq(quoteLines.quoteId, quotes.id))
      .where(and(open, namesDepartment(code)))
      .orderBy(asc(quotes.title), asc(quotes.id))
      .limit(PREVIEW_ITEMS);
    return { count: (lines?.value ?? 0) + (items?.value ?? 0), items: listed };
  }

  /** One `quote.updated` entry per quote touched. */
  private async move(
    tx: Transaction,
    from: DepartmentCode,
    to: DepartmentCode,
    actor: AuditActor,
  ): Promise<number> {
    const openIds = tx.select({ id: quotes.id }).from(quotes).where(open);
    const lines = await tx
      .update(quoteLines)
      .set({ department: to })
      .where(and(eq(quoteLines.department, from), inArray(quoteLines.quoteId, openIds)))
      .returning({ quoteId: quoteLines.quoteId });
    const openLineIds = tx
      .select({ id: quoteLines.id })
      .from(quoteLines)
      .where(inArray(quoteLines.quoteId, openIds));
    const items = await tx
      .update(quoteLineItems)
      .set({ department: to })
      .where(and(eq(quoteLineItems.department, from), inArray(quoteLineItems.lineId, openLineIds)))
      .returning({ lineId: quoteLineItems.lineId });
    const itemQuotes =
      items.length === 0
        ? []
        : await tx
            .select({ quoteId: quoteLines.quoteId })
            .from(quoteLines)
            .where(
              inArray(
                quoteLines.id,
                items.map((item) => item.lineId),
              ),
            );
    const touched = new Set([...lines, ...itemQuotes].map((row) => row.quoteId));
    for (const quoteId of touched) {
      await recordAudit(tx, {
        actor,
        action: 'quote.updated',
        entityType: 'quote',
        entityId: quoteId,
        before: { department: from },
        after: { department: to, reason: 'department_archived' },
      });
    }
    return lines.length + items.length;
  }
}
