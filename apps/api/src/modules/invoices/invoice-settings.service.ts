import { Inject, Injectable } from '@nestjs/common';
import {
  hasPermission,
  type InvoiceSettings,
  rateIsStale,
  type UpdateInvoiceSettings,
} from '@vertex-hub/contracts';
import { type Database, invoiceSettings, type Transaction } from '@vertex-hub/db';
import { DATABASE } from '../../core/database/database.module.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { actorOf } from './invoice-access.js';

export type InvoiceSettingsRow = typeof invoiceSettings.$inferSelect;

/** The audit entity id of the single settings row, which has no id of its own. */
export const INVOICE_SETTINGS_ENTITY_ID = '01a0e97d-0000-7000-8000-00000000f013';

const auditFields = (row: InvoiceSettingsRow) => ({
  sypPerUsd: row.sypPerUsd,
  paymentTermsDays: row.paymentTermsDays,
  paymentDetails: row.paymentDetails,
  invoiceFooter: row.invoiceFooter,
});

/** `118.5` and `118.5000` are the same rate. */
export const sameRate = (a: string | null, b: string | null) =>
  a === b || (a !== null && b !== null && Number(a) === Number(b));

/** Invoice settings (F13): the current rate, payment terms, payment details and footer. */
@Injectable()
export class InvoiceSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
  ) {}

  /** The settings row, seeded by its migration; `forUpdate` locks it. */
  async row(
    executor: Database | Transaction = this.db,
    options: { forUpdate?: boolean } = {},
  ): Promise<InvoiceSettingsRow> {
    const query = executor.select().from(invoiceSettings);
    const [row] = options.forUpdate ? await query.for('update') : await query;
    if (!row) throw new Error('The invoice settings row is missing; run the migrations');
    return row;
  }

  async get(actor: CurrentUserInfo): Promise<InvoiceSettings> {
    return this.toResponse(actor, await this.row());
  }

  /** A new rate records who set it and when (rule 10). */
  async update(actor: CurrentUserInfo, input: UpdateInvoiceSettings): Promise<InvoiceSettings> {
    const row = await this.db.transaction(async (tx) => {
      const current = await this.row(tx, { forUpdate: true });
      const rateChanges =
        input.sypPerUsd !== undefined && !sameRate(current.sypPerUsd, input.sypPerUsd);
      const changes = changedFields(auditFields(current), {
        ...input,
        sypPerUsd: rateChanges ? input.sypPerUsd : undefined,
      });
      if (!changes) return current;
      const now = new Date();
      const [updated] = await tx
        .update(invoiceSettings)
        .set({
          ...changes.after,
          ...(rateChanges && { rateUpdatedAt: now, rateUpdatedById: actor.id }),
          updatedAt: now,
          updatedById: actor.id,
        })
        .returning();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'invoice_settings.updated',
        entityType: 'invoice_settings',
        entityId: INVOICE_SETTINGS_ENTITY_ID,
        before: changes.before,
        after: changes.after,
      });
      return updated ?? current;
    });
    return this.toResponse(actor, row);
  }

  private async toResponse(
    actor: CurrentUserInfo,
    row: InvoiceSettingsRow,
  ): Promise<InvoiceSettings> {
    const users = await this.users.summaries(
      [row.updatedById, row.rateUpdatedById].filter((id): id is string => !!id),
    );
    const person = (id: string | null) => {
      const user = id ? users.get(id) : undefined;
      return user ? { id: user.id, name: user.name } : null;
    };
    return {
      ...auditFields(row),
      rateUpdatedAt: row.rateUpdatedAt?.toISOString() ?? null,
      rateUpdatedBy: person(row.rateUpdatedById),
      rateStale: rateIsStale(row.rateUpdatedAt),
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: person(row.updatedById),
      canEdit: hasPermission(actor.access, 'invoices.manage'),
    };
  }
}
