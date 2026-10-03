import { Inject, Injectable } from '@nestjs/common';
import {
  type InvoiceStatus,
  invoiceDisplayNumber,
  OPEN_INVOICE_STATUSES,
  permissionScopes,
} from '@vertex-hub/contracts';
import { type Database, invoices } from '@vertex-hub/db';
import { and, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';

/** An open invoice's due date on the company calendar (F13 "Changes to other endpoints"). */
export interface InvoiceDueDate {
  kind: 'invoice_due';
  date: string;
  /** `INV-2026-0012`; never an amount. */
  title: string;
  targetId: string;
  clientId: string;
  invoiceStatus: InvoiceStatus;
}

/**
 * The due dates of open invoices (`sent`, `partially_paid`, `overdue`) for the `calendar` module,
 * only for invoices the caller may read: `invoices.read` `all`, or `own_clients` as the client's
 * account manager. Everyone else gets none.
 */
@Injectable()
export class InvoiceDueDates {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
  ) {}

  async keyDates(
    actor: CurrentUserInfo,
    query: { from: string; to: string; clientId?: string; userId?: string },
  ): Promise<InvoiceDueDate[]> {
    const scopes = permissionScopes(actor.access, 'invoices.read');
    if (scopes.length === 0) return [];
    const rows = await this.db
      .select({
        id: invoices.id,
        clientId: invoices.clientId,
        year: invoices.year,
        number: invoices.number,
        dueOn: invoices.dueOn,
        status: invoices.status,
      })
      .from(invoices)
      .where(
        and(
          isNull(invoices.archivedAt),
          inArray(invoices.status, [...OPEN_INVOICE_STATUSES]),
          isNotNull(invoices.dueOn),
          gte(invoices.dueOn, query.from),
          lte(invoices.dueOn, query.to),
          scopes.includes('all') ? undefined : this.clients.managedBy(invoices.clientId, actor.id),
          query.clientId ? eq(invoices.clientId, query.clientId) : undefined,
          query.userId ? this.clients.managedBy(invoices.clientId, query.userId) : undefined,
        ),
      );
    return rows.flatMap((row) =>
      row.dueOn && row.year && row.number
        ? [
            {
              kind: 'invoice_due' as const,
              date: row.dueOn,
              title: invoiceDisplayNumber({ year: row.year, number: row.number }),
              targetId: row.id,
              clientId: row.clientId,
              invoiceStatus: row.status,
            },
          ]
        : [],
    );
  }
}
