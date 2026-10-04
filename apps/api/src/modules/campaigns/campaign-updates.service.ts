import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  acceptsUpdates,
  businessDate,
  type CampaignDetail,
  type CampaignUpdateInput,
  type PatchCampaignUpdate,
  periodInOneMonth,
  periodsOverlap,
} from '@vertex-hub/contracts';
import { adCampaignUpdates, type Database, type Transaction } from '@vertex-hub/db';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { actorOf } from './campaign-access.js';
import { type CampaignRow, CampaignsService, type CampaignUpdateRow } from './campaigns.service.js';

/** What every update audit entry carries: its client, campaign, period and spend. */
const identity = (campaign: CampaignRow, update: CampaignUpdateRow) => ({
  clientId: campaign.clientId,
  campaignId: campaign.id,
  periodStart: update.periodStart,
  periodEnd: update.periodEnd,
  spendMinor: update.spendMinor,
});

const metrics = (row: CampaignUpdateInput | CampaignUpdateRow) => ({
  periodStart: row.periodStart,
  periodEnd: row.periodEnd,
  spendMinor: row.spendMinor,
  reach: row.reach,
  clicks: row.clicks,
  results: row.results,
  note: row.note,
});

/**
 * Periodic updates of a campaign's spend and results (spec F12, rules 9–11). Every write locks the
 * campaign row first, so overlapping periods entered at once are refused in turn.
 */
@Injectable()
export class CampaignUpdatesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly campaigns: CampaignsService,
  ) {}

  async add(
    actor: CurrentUserInfo,
    campaignId: string,
    input: CampaignUpdateInput,
  ): Promise<CampaignDetail> {
    return this.db.transaction(async (tx) => {
      const { campaign, client } = await this.campaigns.lockForChange(tx, actor, campaignId);
      if (campaign.archivedAt || !acceptsUpdates(campaign.status)) {
        throw new CodedException(
          409,
          'INVALID_TRANSITION',
          `A ${campaign.status} campaign takes no updates`,
        );
      }
      await this.assertPeriod(tx, campaign.id, input, null);
      const [row] = await tx
        .insert(adCampaignUpdates)
        .values({ ...input, campaignId: campaign.id, enteredById: actor.id })
        .returning();
      if (!row) throw new Error('The update was not created');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'ad_campaign_update.created',
        entityType: 'ad_campaign_update',
        entityId: row.id,
        after: { ...identity(campaign, row), ...metrics(row) },
      });
      return this.campaigns.toDetail(actor, campaign, client, tx);
    });
  }

  async patch(
    actor: CurrentUserInfo,
    id: string,
    input: PatchCampaignUpdate,
  ): Promise<CampaignDetail> {
    return this.db.transaction(async (tx) => {
      const { update, campaign, client } = await this.lockForChange(tx, actor, id);
      const next = { ...metrics(update), ...input };
      await this.assertPeriod(tx, campaign.id, next, update.id);
      const changes = changedFields(metrics(update), next);
      if (!changes) return this.campaigns.toDetail(actor, campaign, client, tx);
      const [updated] = await tx
        .update(adCampaignUpdates)
        .set({ ...input, updatedById: actor.id, updatedAt: new Date() })
        .where(eq(adCampaignUpdates.id, id))
        .returning();
      if (!updated) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'ad_campaign_update.updated',
        entityType: 'ad_campaign_update',
        entityId: id,
        before: { ...identity(campaign, update), ...changes.before },
        after: { ...identity(campaign, updated), ...changes.after },
      });
      return this.campaigns.toDetail(actor, campaign, client, tx);
    });
  }

  /** An update entered by mistake leaves every total (and the wallet). */
  async archive(actor: CurrentUserInfo, id: string): Promise<CampaignDetail> {
    return this.db.transaction(async (tx) => {
      const { update, campaign, client } = await this.lockForChange(tx, actor, id);
      await tx
        .update(adCampaignUpdates)
        .set({ archivedAt: new Date(), archivedById: actor.id })
        .where(eq(adCampaignUpdates.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'ad_campaign_update.archived',
        entityType: 'ad_campaign_update',
        entityId: id,
        before: { ...identity(campaign, update), archived: false },
        after: { ...identity(campaign, update), archived: true },
      });
      return this.campaigns.toDetail(actor, campaign, client, tx);
    });
  }

  /**
   * Locks the update's campaign, then reads the update: 404 when either is outside the caller's
   * read access, 403 without `campaigns.manage`. An archived update, or an update of an archived
   * campaign, takes no change (`INVALID_TRANSITION`).
   */
  private async lockForChange(tx: Transaction, actor: CurrentUserInfo, id: string) {
    const [found] = await tx
      .select({ campaignId: adCampaignUpdates.campaignId })
      .from(adCampaignUpdates)
      .where(eq(adCampaignUpdates.id, id));
    if (!found) throw new NotFoundException();
    const { campaign, client } = await this.campaigns.lockForChange(tx, actor, found.campaignId);
    const [update] = await tx
      .select()
      .from(adCampaignUpdates)
      .where(eq(adCampaignUpdates.id, id))
      .for('update');
    if (!update) throw new NotFoundException();
    if (update.archivedAt || campaign.archivedAt) {
      throw new CodedException(409, 'INVALID_TRANSITION', 'The update is archived');
    }
    return { update, campaign, client };
  }

  /**
   * Rules 9 and 10: the period ends on or before today, lies in one calendar month and overlaps
   * none of the campaign's other non-archived updates.
   */
  private async assertPeriod(
    tx: Transaction,
    campaignId: string,
    period: { periodStart: string; periodEnd: string },
    updateId: string | null,
  ): Promise<void> {
    if (period.periodStart > period.periodEnd || period.periodEnd > businessDate()) {
      throw new CodedException(400, 'INVALID_DATES', 'The period must end on or before today');
    }
    if (!periodInOneMonth(period)) {
      throw new CodedException(400, 'PERIOD_CROSSES_MONTH', 'The period crosses a month');
    }
    const others = await tx
      .select({
        periodStart: adCampaignUpdates.periodStart,
        periodEnd: adCampaignUpdates.periodEnd,
      })
      .from(adCampaignUpdates)
      .where(
        and(
          eq(adCampaignUpdates.campaignId, campaignId),
          isNull(adCampaignUpdates.archivedAt),
          updateId ? ne(adCampaignUpdates.id, updateId) : undefined,
        ),
      );
    if (others.some((other) => periodsOverlap(other, period))) {
      throw new CodedException(409, 'PERIOD_OVERLAP', 'The period overlaps another update');
    }
  }
}
