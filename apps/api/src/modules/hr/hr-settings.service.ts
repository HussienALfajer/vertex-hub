import { Inject, Injectable } from '@nestjs/common';
import { type HrSettings, hrSettingsSchema } from '@vertex-hub/contracts';
import { type Database, hrSettings, type Transaction } from '@vertex-hub/db';
import { DATABASE } from '../../core/database/database.module.js';
import { type AuditActor, changedFields, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';

type SettingsRow = typeof hrSettings.$inferSelect;

/** The audit entity id of the single settings row, which has no id of its own. */
export const HR_SETTINGS_ENTITY_ID = '01a15bc1-0000-7000-8000-00000000f017';

const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

const SETTING_KEYS = Object.keys(hrSettingsSchema.shape) as (keyof HrSettings)[];

/** `jsonb` returns the tiers' keys sorted: rebuilt in the contract's order, so an unchanged save
 * compares equal and writes no audit entry. */
const toSettings = (row: SettingsRow): HrSettings => ({
  ...(Object.fromEntries(SETTING_KEYS.map((key) => [key, row[key]])) as HrSettings),
  latenessTiers: row.latenessTiers.map((tier) => ({
    upToMinutes: tier.upToMinutes,
    fraction: tier.fraction,
  })),
});

/** The HR settings (spec, `hr_settings`): read with `hr.read`, replaced with `hr.manage`. */
@Injectable()
export class HrSettingsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The settings row, seeded by its migration; `forUpdate` locks it. */
  async row(
    executor: Database | Transaction = this.db,
    options: { forUpdate?: boolean } = {},
  ): Promise<SettingsRow> {
    const query = executor.select().from(hrSettings);
    const [row] = options.forUpdate ? await query.for('update') : await query;
    if (!row) throw new Error('The HR settings row is missing; run the migrations');
    return row;
  }

  async get(): Promise<HrSettings> {
    return toSettings(await this.row());
  }

  async update(actor: CurrentUserInfo, input: HrSettings): Promise<HrSettings> {
    const row = await this.db.transaction(async (tx) => {
      const current = await this.row(tx, { forUpdate: true });
      const changes = changedFields(toSettings(current), input);
      if (!changes) return current;
      const [updated] = await tx
        .update(hrSettings)
        .set({ ...changes.after, updatedAt: new Date(), updatedById: actor.id })
        .returning();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'hr_settings.updated',
        entityType: 'hr_settings',
        entityId: HR_SETTINGS_ENTITY_ID,
        before: changes.before,
        after: changes.after,
      });
      return updated ?? current;
    });
    return toSettings(row);
  }
}
