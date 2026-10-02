import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { hasPermission, type QuoteSettings, type UpdateQuoteSettings } from '@vertex-hub/contracts';
import { type Database, quoteSettings, type Transaction } from '@vertex-hub/db';
import { DATABASE } from '../../core/database/database.module.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { actorOf } from './quote-access.js';

type SettingsRow = typeof quoteSettings.$inferSelect;

/** The audit entity id of the single settings row, which has no id of its own. */
export const QUOTE_SETTINGS_ENTITY_ID = '01a0e97d-0000-7000-8000-00000000f004';

const auditFields = (row: SettingsRow) => ({
  companyDetails: row.companyDetails,
  defaultTerms: row.defaultTerms,
  defaultValidityDays: row.defaultValidityDays,
  discountThresholdPercent: row.discountThresholdPercent,
});

/** Quote settings (F04): company details, default terms and validity, discount threshold. */
@Injectable()
export class QuoteSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
  ) {}

  /** The settings row, seeded by its migration; `forUpdate` locks it. */
  async row(
    executor: Database | Transaction = this.db,
    options: { forUpdate?: boolean } = {},
  ): Promise<SettingsRow> {
    const query = executor.select().from(quoteSettings);
    const [row] = options.forUpdate ? await query.for('update') : await query;
    if (!row) throw new Error('The quote settings row is missing; run the migrations');
    return row;
  }

  async get(actor: CurrentUserInfo): Promise<QuoteSettings> {
    return this.toResponse(actor, await this.row());
  }

  /** Texts and validity need `catalog.manage`; the threshold needs `quotes.approve_discount`. */
  async update(actor: CurrentUserInfo, input: UpdateQuoteSettings): Promise<QuoteSettings> {
    const { discountThresholdPercent, ...texts } = input;
    const editsTexts = Object.values(texts).some((value) => value !== undefined);
    if (
      (editsTexts || discountThresholdPercent === undefined) &&
      !hasPermission(actor.access, 'catalog.manage')
    ) {
      throw new ForbiddenException();
    }
    if (
      discountThresholdPercent !== undefined &&
      !hasPermission(actor.access, 'quotes.approve_discount')
    ) {
      throw new ForbiddenException();
    }
    const row = await this.db.transaction(async (tx) => {
      const current = await this.row(tx, { forUpdate: true });
      const changes = changedFields(auditFields(current), input);
      if (!changes) return current;
      const [updated] = await tx
        .update(quoteSettings)
        .set({ ...changes.after, updatedAt: new Date(), updatedById: actor.id })
        .returning();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'quote_settings.updated',
        entityType: 'quote_settings',
        entityId: QUOTE_SETTINGS_ENTITY_ID,
        before: changes.before,
        after: changes.after,
      });
      return updated ?? current;
    });
    return this.toResponse(actor, row);
  }

  private async toResponse(actor: CurrentUserInfo, row: SettingsRow): Promise<QuoteSettings> {
    const users = await this.users.summaries(row.updatedById ? [row.updatedById] : []);
    const updatedBy = row.updatedById ? users.get(row.updatedById) : undefined;
    return {
      ...auditFields(row),
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: updatedBy ? { id: updatedBy.id, name: updatedBy.name } : null,
      canEdit: hasPermission(actor.access, 'catalog.manage'),
      canEditThreshold: hasPermission(actor.access, 'quotes.approve_discount'),
    };
  }
}
