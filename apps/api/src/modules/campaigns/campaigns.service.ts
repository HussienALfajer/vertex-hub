import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AD_CAMPAIGN_TRANSITIONS,
  acceptsUpdates,
  budgetUsed,
  businessDate,
  type Campaign,
  type CampaignDetail,
  type CampaignListQuery,
  type CampaignMonth,
  type CampaignPage,
  type CampaignStatusChange,
  type CampaignUpdate,
  type CreateCampaign,
  canChangeCampaignStatus,
  costPerResult,
  daysWithoutUpdate,
  type UpdateCampaign,
} from '@vertex-hub/contracts';
import { adCampaigns, adCampaignUpdates, type Database, type Transaction } from '@vertex-hub/db';
import { and, asc, count, desc, eq, inArray, isNull, max, or, type SQL, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { TaskLinks } from '../tasks/index.js';
import { AdWalletBalances } from './ad-wallet-balances.js';
import { actorOf, covers, readsAll } from './campaign-access.js';

export type CampaignRow = typeof adCampaigns.$inferSelect;

export type CampaignUpdateRow = typeof adCampaignUpdates.$inferSelect;

type Executor = Database | Transaction;

type Links = Pick<CampaignRow, 'projectId' | 'retainerId' | 'taskId'>;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** What every campaign audit entry carries. */
export const identity = (row: CampaignRow) => ({ clientId: row.clientId, name: row.name });

/** The fields a whole-campaign save may change, as audited (rule 5). */
const editable = (row: Omit<UpdateCampaign, 'updatedAt'> | CampaignRow) => ({
  name: row.name,
  platform: row.platform,
  objective: row.objective,
  funding: row.funding,
  budgetMinor: row.budgetMinor,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  ownerId: row.ownerId,
  projectId: row.projectId,
  retainerId: row.retainerId,
  taskId: row.taskId,
  notes: row.notes,
});

/** Spend, reach, clicks and results summed, with cost per result (rule 11). */
function metricsOf(updates: readonly CampaignUpdateRow[]) {
  const sum = (pick: (update: CampaignUpdateRow) => number) =>
    updates.reduce((total, update) => total + pick(update), 0);
  const spendMinor = sum((update) => update.spendMinor);
  const results = sum((update) => update.results);
  return {
    spendMinor,
    reach: sum((update) => update.reach),
    clicks: sum((update) => update.clicks),
    results,
    costPerResultMinor: costPerResult(spendMinor, results),
  };
}

/**
 * Ad campaigns (spec F12): list, detail, create, whole-campaign save, status changes, archive and
 * restore. Clients, users, engagements and tasks are read through their modules' directories.
 */
@Injectable()
export class CampaignsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly users: UserDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly tasks: TaskLinks,
    private readonly wallets: AdWalletBalances,
  ) {}

  async list(actor: CurrentUserInfo, query: CampaignListQuery): Promise<CampaignPage> {
    const filters: (SQL | undefined)[] = [
      isNull(adCampaigns.archivedAt),
      readsAll(actor) ? undefined : this.clients.managedBy(adCampaigns.clientId, actor.id),
      inArray(adCampaigns.status, query.status),
    ];
    if (query.search) {
      filters.push(
        or(
          sql`${adCampaigns.name} ilike ${`%${escapeLike(query.search)}%`}`,
          this.clients.nameContains(adCampaigns.clientId, query.search),
        ),
      );
    }
    if (query.clientId) filters.push(eq(adCampaigns.clientId, query.clientId));
    if (query.platform) filters.push(eq(adCampaigns.platform, query.platform));
    if (query.funding) filters.push(eq(adCampaigns.funding, query.funding));
    if (query.ownerId) filters.push(eq(adCampaigns.ownerId, query.ownerId));
    if (query.mine) filters.push(eq(adCampaigns.ownerId, actor.id));
    if (query.accountManagerId) {
      filters.push(this.clients.managedBy(adCampaigns.clientId, query.accountManagerId));
    }
    const where = and(...filters);
    const order = query.order === 'desc' ? desc : asc;
    const sort =
      query.sort === 'name'
        ? order(sql`lower(${adCampaigns.name})`)
        : query.sort === 'startsOn'
          ? order(adCampaigns.startsOn)
          : order(adCampaigns.updatedAt);
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(adCampaigns)
        .where(where)
        .orderBy(sort, asc(adCampaigns.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(adCampaigns).where(where),
    ]);
    return {
      items: await this.summaries(rows),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Rule 25: 404 outside read access; an archived campaign only for campaign managers (rule 7). */
  async detail(actor: CurrentUserInfo, id: string, executor: Executor = this.db) {
    const [row] = await executor.select().from(adCampaigns).where(eq(adCampaigns.id, id));
    const client = row ? await this.clients.summary(row.clientId, executor) : null;
    if (!row || !client || !this.readable(actor, row, client)) throw new NotFoundException();
    return this.toDetail(actor, row, client, executor);
  }

  /** Rules 1–4. */
  async create(actor: CurrentUserInfo, input: CreateCampaign): Promise<CampaignDetail> {
    return this.db.transaction(async (tx) => {
      const client = await this.clients.summary(input.clientId, tx);
      if (!client || !covers(actor, 'campaigns.read', client)) throw new NotFoundException();
      if (!covers(actor, 'campaigns.manage', client)) throw new ForbiddenException();
      if (client.archived) {
        throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
      }
      assertDates(input.startsOn, input.endsOn);
      await this.assertOwner(tx, input.ownerId);
      await this.assertLinks(tx, client.id, input, null);
      const { clientId: _, ...fields } = input;
      const [row] = await tx
        .insert(adCampaigns)
        .values({ ...fields, clientId: client.id, createdById: actor.id })
        .returning();
      if (!row) throw new Error('The campaign was not created');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'ad_campaign.created',
        entityType: 'ad_campaign',
        entityId: row.id,
        after: { ...identity(row), ...editable(row), status: row.status },
      });
      return this.toDetail(actor, row, client, tx);
    });
  }

  /** Rules 3–6: the whole campaign at once. */
  async update(actor: CurrentUserInfo, id: string, input: UpdateCampaign): Promise<CampaignDetail> {
    return this.db.transaction(async (tx) => {
      const { campaign, client } = await this.lockForChange(tx, actor, id);
      if (campaign.archivedAt || campaign.status === 'cancelled') {
        throw new CodedException(409, 'INVALID_TRANSITION', 'The campaign cannot be edited');
      }
      if (campaign.updatedAt.getTime() !== new Date(input.updatedAt).getTime()) {
        throw new CodedException(
          409,
          'CONCURRENT_CHANGE',
          'The campaign changed since it was loaded',
        );
      }
      const { updatedAt: _, ...fields } = input;
      if (fields.funding !== campaign.funding && (await this.hasUpdates(tx, id))) {
        throw new CodedException(409, 'FUNDING_LOCKED', 'The campaign already has updates');
      }
      assertDates(fields.startsOn, fields.endsOn);
      // Edge case 8: an archived owner stays until the owner field changes.
      if (fields.ownerId !== campaign.ownerId) await this.assertOwner(tx, fields.ownerId);
      // Rule 3: a link archived later stays; only a changed link is checked.
      await this.assertLinks(tx, campaign.clientId, fields, campaign);
      const changes = changedFields(editable(campaign), editable(fields));
      if (!changes) return this.toDetail(actor, campaign, client, tx);
      // Rule 17: a funding change moves the campaign into or out of the wallet.
      const wallet =
        fields.funding !== campaign.funding ? await this.wallets.lock(tx, campaign.clientId) : null;
      const [updated] = await tx
        .update(adCampaigns)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(adCampaigns.id, id))
        .returning();
      if (!updated) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'ad_campaign.updated',
        entityType: 'ad_campaign',
        entityId: id,
        before: { ...identity(campaign), ...changes.before },
        after: { ...identity(updated), ...changes.after },
      });
      if (wallet) await this.wallets.settle(tx, actorOf(actor), wallet, client);
      return this.toDetail(actor, updated, client, tx);
    });
  }

  async changeStatus(
    actor: CurrentUserInfo,
    id: string,
    input: CampaignStatusChange,
  ): Promise<CampaignDetail> {
    return this.db.transaction(async (tx) => {
      const { campaign, client } = await this.lockForChange(tx, actor, id);
      if (campaign.archivedAt || !canChangeCampaignStatus(campaign.status, input.to)) {
        throw new CodedException(
          409,
          'INVALID_TRANSITION',
          `A campaign in ${campaign.status} cannot become ${input.to}`,
        );
      }
      const reason = input.to === 'cancelled' ? input.reason || null : null;
      if (input.to === 'cancelled' && !reason) {
        throw new CodedException(400, 'NOTE_REQUIRED', 'Cancelling needs a reason');
      }
      const [updated] = await tx
        .update(adCampaigns)
        .set({ status: input.to, cancelReason: reason, updatedAt: new Date() })
        .where(eq(adCampaigns.id, id))
        .returning();
      if (!updated) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'ad_campaign.status_changed',
        entityType: 'ad_campaign',
        entityId: id,
        before: { ...identity(campaign), status: campaign.status },
        after: { ...identity(updated), status: updated.status, ...(reason ? { reason } : {}) },
      });
      return this.toDetail(actor, updated, client, tx);
    });
  }

  /** Rule 7: planned or cancelled campaigns without updates, entered by mistake. */
  async archive(actor: CurrentUserInfo, id: string): Promise<CampaignDetail> {
    return this.db.transaction(async (tx) => {
      const { campaign, client } = await this.lockForChange(tx, actor, id);
      if (
        campaign.archivedAt ||
        (campaign.status !== 'planned' && campaign.status !== 'cancelled')
      ) {
        throw new CodedException(
          409,
          'INVALID_TRANSITION',
          'Only a planned or cancelled campaign is archived',
        );
      }
      if (await this.hasUpdates(tx, id)) {
        throw new CodedException(409, 'CAMPAIGN_HAS_UPDATES', 'The campaign has updates');
      }
      return this.setArchived(tx, actor, campaign, client, true);
    });
  }

  async restore(actor: CurrentUserInfo, id: string): Promise<CampaignDetail> {
    return this.db.transaction(async (tx) => {
      const { campaign, client } = await this.lockForChange(tx, actor, id);
      if (!campaign.archivedAt) {
        throw new CodedException(409, 'INVALID_TRANSITION', 'The campaign is not archived');
      }
      return this.setArchived(tx, actor, campaign, client, false);
    });
  }

  /**
   * Locks a campaign row for a change (rule 10: the campaign first): 404 outside read access, 403
   * without `campaigns.manage` over the client.
   */
  async lockForChange(
    tx: Transaction,
    actor: CurrentUserInfo,
    id: string,
  ): Promise<{ campaign: CampaignRow; client: ClientSummary }> {
    const [campaign] = await tx
      .select()
      .from(adCampaigns)
      .where(eq(adCampaigns.id, id))
      .for('update');
    const client = campaign ? await this.clients.summary(campaign.clientId, tx) : null;
    if (!campaign || !client || !this.readable(actor, campaign, client)) {
      throw new NotFoundException();
    }
    if (!covers(actor, 'campaigns.manage', client)) throw new ForbiddenException();
    return { campaign, client };
  }

  /** The campaign's non-archived updates, newest period first. */
  async liveUpdates(executor: Executor, campaignId: string): Promise<CampaignUpdateRow[]> {
    return executor
      .select()
      .from(adCampaignUpdates)
      .where(
        and(eq(adCampaignUpdates.campaignId, campaignId), isNull(adCampaignUpdates.archivedAt)),
      )
      .orderBy(desc(adCampaignUpdates.periodStart), desc(adCampaignUpdates.id));
  }

  async toDetail(
    actor: CurrentUserInfo,
    row: CampaignRow,
    client: ClientSummary,
    executor: Executor = this.db,
  ): Promise<CampaignDetail> {
    const updates = await this.liveUpdates(executor, row.id);
    // One after another: inside a transaction they share one connection.
    const users = await this.users.summaries(
      [row.ownerId, row.createdById, ...updates.map((update) => update.enteredById)],
      executor,
    );
    const projects = await this.engagements.projects(
      row.projectId ? [row.projectId] : [],
      executor,
    );
    const retainers = await this.engagements.retainers(
      row.retainerId ? [row.retainerId] : [],
      executor,
    );
    const tasks = await this.tasks.summaries(row.taskId ? [row.taskId] : [], executor);
    const wallet =
      row.funding === 'wallet' ? await this.wallets.totalsOf(executor, row.clientId) : null;
    const person = (userId: string) => {
      const user = users.get(userId);
      return { id: userId, name: user?.name ?? '' };
    };
    const totals = metricsOf(updates);
    const lastUpdateEnd = updates.reduce<string | null>(
      (last, update) => (last === null || update.periodEnd > last ? update.periodEnd : last),
      null,
    );
    const project = row.projectId ? projects.get(row.projectId) : undefined;
    const retainer = row.retainerId ? retainers.get(row.retainerId) : undefined;
    const engagement = project
      ? { type: 'project' as const, ...project }
      : retainer
        ? { type: 'retainer' as const, ...retainer }
        : null;
    const task = row.taskId ? tasks.get(row.taskId) : undefined;
    const manage = covers(actor, 'campaigns.manage', client);
    const archived = !!row.archivedAt;
    const live = manage && !archived;
    return {
      ...this.summary(row, client, users.get(row.ownerId), totals, lastUpdateEnd),
      engagement: engagement && {
        type: engagement.type,
        id: engagement.id,
        name: engagement.name,
        archived: engagement.archived,
      },
      task: task
        ? { id: task.id, name: task.title, status: task.status, archived: task.archived }
        : null,
      notes: row.notes,
      cancelReason: row.cancelReason,
      totals: { ...totals, budgetUsed: budgetUsed(totals.spendMinor, row.budgetMinor) },
      months: monthsOf(updates),
      walletBalanceMinor: wallet?.balanceMinor ?? null,
      updates: updates.map(
        (update): CampaignUpdate => ({
          id: update.id,
          periodStart: update.periodStart,
          periodEnd: update.periodEnd,
          spendMinor: update.spendMinor,
          reach: update.reach,
          clicks: update.clicks,
          results: update.results,
          costPerResultMinor: costPerResult(update.spendMinor, update.results),
          note: update.note,
          enteredBy: person(update.enteredById),
          createdAt: update.createdAt.toISOString(),
          updatedAt: update.updatedAt.toISOString(),
        }),
      ),
      createdBy: person(row.createdById),
      createdAt: row.createdAt.toISOString(),
      permissions: {
        canEdit: live && row.status !== 'cancelled',
        canChangeFunding: live && row.status !== 'cancelled' && updates.length === 0,
        transitions: live ? [...AD_CAMPAIGN_TRANSITIONS[row.status]] : [],
        canAddUpdate: live && acceptsUpdates(row.status),
        canEditUpdates: live,
        canArchive:
          live && (row.status === 'planned' || row.status === 'cancelled') && updates.length === 0,
        canRestore: manage && archived,
      },
    };
  }

  /** List items, with each campaign's totals over its non-archived updates. */
  private async summaries(rows: CampaignRow[]): Promise<Campaign[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [clients, users, totals] = await Promise.all([
      this.clients.summaries(rows.map((row) => row.clientId)),
      this.users.summaries(rows.map((row) => row.ownerId)),
      this.db
        .select({
          campaignId: adCampaignUpdates.campaignId,
          spendMinor: sql<number>`coalesce(sum(${adCampaignUpdates.spendMinor}), 0)`.mapWith(
            Number,
          ),
          results: sql<number>`coalesce(sum(${adCampaignUpdates.results}), 0)`.mapWith(Number),
          lastUpdateEnd: max(adCampaignUpdates.periodEnd),
        })
        .from(adCampaignUpdates)
        .where(
          and(inArray(adCampaignUpdates.campaignId, ids), isNull(adCampaignUpdates.archivedAt)),
        )
        .groupBy(adCampaignUpdates.campaignId),
    ]);
    const byCampaign = new Map(totals.map((total) => [total.campaignId, total]));
    return rows.flatMap((row) => {
      const client = clients.get(row.clientId);
      if (!client) return [];
      const total = byCampaign.get(row.id);
      const spendMinor = total?.spendMinor ?? 0;
      const results = total?.results ?? 0;
      return [
        this.summary(
          row,
          client,
          users.get(row.ownerId),
          { spendMinor, results, costPerResultMinor: costPerResult(spendMinor, results) },
          total?.lastUpdateEnd ?? null,
        ),
      ];
    });
  }

  private summary(
    row: CampaignRow,
    client: ClientSummary,
    owner: { name: string; archived: boolean } | undefined,
    totals: { spendMinor: number; results: number; costPerResultMinor: number | null },
    lastUpdateEnd: string | null,
  ): Campaign {
    const today = businessDate();
    return {
      id: row.id,
      name: row.name,
      client: { id: client.id, name: client.name },
      platform: row.platform,
      objective: row.objective,
      funding: row.funding,
      status: row.status,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      owner: { id: row.ownerId, name: owner?.name ?? '', archived: owner?.archived ?? false },
      budgetMinor: row.budgetMinor,
      spendMinor: totals.spendMinor,
      budgetUsed: budgetUsed(totals.spendMinor, row.budgetMinor),
      results: totals.results,
      costPerResultMinor: totals.costPerResultMinor,
      lastUpdateEnd,
      daysWithoutUpdate: daysWithoutUpdate({
        status: row.status,
        startsOn: row.startsOn,
        lastUpdateEnd,
        today,
      }),
      endPassed: row.status === 'active' && row.endsOn !== null && row.endsOn < today,
      updatedAt: row.updatedAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
    };
  }

  private readable(actor: CurrentUserInfo, row: CampaignRow, client: ClientSummary): boolean {
    if (!covers(actor, 'campaigns.read', client)) return false;
    return !row.archivedAt || covers(actor, 'campaigns.manage', client);
  }

  private async hasUpdates(executor: Executor, campaignId: string): Promise<boolean> {
    const [row] = await executor
      .select({ id: adCampaignUpdates.id })
      .from(adCampaignUpdates)
      .where(
        and(eq(adCampaignUpdates.campaignId, campaignId), isNull(adCampaignUpdates.archivedAt)),
      )
      .limit(1);
    return !!row;
  }

  /** Rule 2: any active user may own a campaign. */
  private async assertOwner(executor: Executor, ownerId: string): Promise<void> {
    if (!(await this.users.activeUser(ownerId, executor))) {
      throw new CodedException(400, 'INVALID_OWNER', 'The owner must be an active user');
    }
  }

  /**
   * Rule 3: a non-archived project or retainer of the client, and a non-archived task of the
   * client. With `current`, only the links that change are checked.
   */
  private async assertLinks(
    executor: Executor,
    clientId: string,
    links: Links,
    current: Links | null,
  ): Promise<void> {
    const changed = (key: keyof Links) => links[key] !== null && links[key] !== current?.[key];
    const invalid = () =>
      new CodedException(
        400,
        'INVALID_ENGAGEMENT',
        'The project, retainer or task is not a live one of the client',
      );
    if (changed('projectId') && links.projectId) {
      const project = (await this.engagements.projects([links.projectId], executor)).get(
        links.projectId,
      );
      if (!project || project.archived || project.clientId !== clientId) throw invalid();
    }
    if (changed('retainerId') && links.retainerId) {
      const retainer = (await this.engagements.retainers([links.retainerId], executor)).get(
        links.retainerId,
      );
      if (!retainer || retainer.archived || retainer.clientId !== clientId) throw invalid();
    }
    if (changed('taskId') && links.taskId) {
      const task = (await this.tasks.summaries([links.taskId], executor)).get(links.taskId);
      if (!task || task.archived || task.clientId !== clientId) throw invalid();
    }
  }

  private async setArchived(
    tx: Transaction,
    actor: CurrentUserInfo,
    campaign: CampaignRow,
    client: ClientSummary,
    archive: boolean,
  ): Promise<CampaignDetail> {
    // Rule 17: an archived campaign leaves the wallet.
    const wallet =
      campaign.funding === 'wallet' ? await this.wallets.lock(tx, campaign.clientId) : null;
    const [updated] = await tx
      .update(adCampaigns)
      .set({
        archivedAt: archive ? new Date() : null,
        archivedById: archive ? actor.id : null,
      })
      .where(eq(adCampaigns.id, campaign.id))
      .returning();
    if (!updated) throw new NotFoundException();
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: archive ? 'ad_campaign.archived' : 'ad_campaign.restored',
      entityType: 'ad_campaign',
      entityId: campaign.id,
      before: { ...identity(campaign), archived: !archive },
      after: { ...identity(campaign), archived: archive },
    });
    if (wallet) await this.wallets.settle(tx, actorOf(actor), wallet, client);
    return this.toDetail(actor, updated, client, tx);
  }
}

/** Rule 4. */
function assertDates(startsOn: string, endsOn: string | null): void {
  if (endsOn !== null && endsOn < startsOn) {
    throw new CodedException(400, 'INVALID_DATES', 'The end date is before the start date');
  }
}

/** Totals per calendar month, oldest first (rule 9 keeps each update in one month). */
function monthsOf(updates: readonly CampaignUpdateRow[]): CampaignMonth[] {
  const byMonth = new Map<string, CampaignUpdateRow[]>();
  for (const update of updates) {
    const month = update.periodStart.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), update]);
  }
  return [...byMonth]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, rows]) => ({ month, ...metricsOf(rows) }));
}
