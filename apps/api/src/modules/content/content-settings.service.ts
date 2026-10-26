import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type ClientContentSettings,
  CONTENT_PLANNING_LIMITS,
  type ContentAgencySettings,
  type ContentPillar,
  type ContentPillarList,
  type ContentPillarOrder,
  type ContentSnippet,
  type ContentSnippetList,
  type ContentSnippetListQuery,
  type CreateContentPillar,
  type CreateContentSnippet,
  defaultOccasionCategories,
  effectivePostingTimes,
  type OccasionSkip,
  type PostingWindow,
  type UpdateClientContentSettings,
  type UpdateContentAgencySettings,
  type UpdateContentPillar,
  type UpdateContentSnippet,
} from '@vertex-hub/contracts';
import {
  contentOccasions,
  contentPillars,
  contentPlanningSettings,
  contentSnippets,
  type Database,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { actorOf, coversClient, holdsAll } from './post-access.js';

type Executor = Database | Transaction;

type PillarRow = typeof contentPillars.$inferSelect;
type SettingsRow = typeof contentPlanningSettings.$inferSelect;

/** The settings a client without a row of its own has (data table). */
export interface ClientPlanningSettings {
  saved: boolean;
  postingTimes: PostingWindow[];
  pillarTargets: SettingsRow['pillarTargets'];
  maxGapDays: number;
  occasionCategories: SettingsRow['occasionCategories'];
  excludedOccasionIds: string[];
  skippedOccasions: OccasionSkip[];
  xLongPosts: boolean;
}

const toPillar = (row: PillarRow): ContentPillar => ({
  id: row.id,
  name: row.name,
  color: row.color,
  position: row.position,
  archived: !!row.archivedAt,
});

/** Serializes changes to the pillar list (the count and the positions). */
const lockPillars = (tx: Transaction) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('content.pillars', 0))`);

/**
 * Pillars, best publishing times, client settings and snippets of the content calendar (spec
 * F08B rules A10 and C1–C7). Agency-wide settings belong to `content.review` holders of scope
 * all; a client's to `content.manage` holders covering it.
 */
@Injectable()
export class ContentSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
  ) {}

  // Pillars (rule C1)

  async pillars(executor: Executor = this.db): Promise<ContentPillarList> {
    const rows = await executor
      .select()
      .from(contentPillars)
      .orderBy(
        sql`${contentPillars.archivedAt} is not null`,
        asc(contentPillars.position),
        asc(contentPillars.name),
      );
    return { items: rows.map(toPillar) };
  }

  /** Pillars by id, archived or not. */
  async pillarsById(ids: readonly string[], executor: Executor = this.db) {
    if (ids.length === 0) return new Map<string, ContentPillar>();
    const rows = await executor
      .select()
      .from(contentPillars)
      .where(inArray(contentPillars.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, toPillar(row)]));
  }

  async createPillar(actor: CurrentUserInfo, input: CreateContentPillar): Promise<ContentPillar> {
    this.assertAgency(actor);
    return this.db.transaction(async (tx) => {
      await lockPillars(tx);
      const live = await this.livePillars(tx);
      if (live.length >= CONTENT_PLANNING_LIMITS.pillars) throw pillarLimit();
      await this.assertNameFree(tx, input.name);
      const [row] = await tx
        .insert(contentPillars)
        .values({ ...input, position: live.length + 1 })
        .returning();
      if (!row) throw new Error('Pillar insert returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'content_pillar.created',
        entityType: 'content_pillar',
        entityId: row.id,
        after: { name: row.name, color: row.color, position: row.position },
      });
      return toPillar(row);
    });
  }

  async updatePillar(
    actor: CurrentUserInfo,
    id: string,
    input: UpdateContentPillar,
  ): Promise<ContentPillar> {
    this.assertAgency(actor);
    return this.db.transaction(async (tx) => {
      await lockPillars(tx);
      const row = await this.pillarRow(tx, id);
      const diff = changedFields({ name: row.name, color: row.color }, input);
      if (!diff) return toPillar(row);
      if (diff.after.name && !row.archivedAt) await this.assertNameFree(tx, diff.after.name, id);
      const [updated] = await tx
        .update(contentPillars)
        .set(diff.after)
        .where(eq(contentPillars.id, id))
        .returning();
      if (!updated) throw new Error(`Pillar ${id} not updated`);
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'content_pillar.updated',
        entityType: 'content_pillar',
        entityId: id,
        before: diff.before,
        after: diff.after,
      });
      return toPillar(updated);
    });
  }

  /** Every non-archived pillar once (`INVALID_ORDER`), positions dense from 1. */
  async orderPillars(
    actor: CurrentUserInfo,
    input: ContentPillarOrder,
  ): Promise<ContentPillarList> {
    this.assertAgency(actor);
    await this.db.transaction(async (tx) => {
      await lockPillars(tx);
      const live = await this.livePillars(tx);
      if (
        input.ids.length !== live.length ||
        input.ids.some((id) => !live.some((pillar) => pillar.id === id))
      ) {
        throw new CodedException(400, 'INVALID_ORDER', 'The order lists every pillar once');
      }
      for (const [index, id] of input.ids.entries()) {
        const before = live.find((pillar) => pillar.id === id)?.position;
        if (before === index + 1) continue;
        await tx
          .update(contentPillars)
          .set({ position: index + 1 })
          .where(eq(contentPillars.id, id));
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'content_pillar.reordered',
          entityType: 'content_pillar',
          entityId: id,
          before: { position: before },
          after: { position: index + 1 },
        });
      }
    });
    return this.pillars();
  }

  /** Archived: no longer offered; posts keep it, targets on it are ignored (edge case 13). */
  async archivePillar(actor: CurrentUserInfo, id: string): Promise<ContentPillar> {
    return this.setPillarArchived(actor, id, true);
  }

  async restorePillar(actor: CurrentUserInfo, id: string): Promise<ContentPillar> {
    return this.setPillarArchived(actor, id, false);
  }

  private async setPillarArchived(
    actor: CurrentUserInfo,
    id: string,
    archived: boolean,
  ): Promise<ContentPillar> {
    this.assertAgency(actor);
    return this.db.transaction(async (tx) => {
      await lockPillars(tx);
      const row = await this.pillarRow(tx, id);
      if (!!row.archivedAt === archived) return toPillar(row);
      const live = await this.livePillars(tx);
      if (!archived) {
        if (live.length >= CONTENT_PLANNING_LIMITS.pillars) throw pillarLimit();
        await this.assertNameFree(tx, row.name, id);
      }
      const [updated] = await tx
        .update(contentPillars)
        .set({
          archivedAt: archived ? new Date() : null,
          position: archived ? row.position : live.length + 1,
        })
        .where(eq(contentPillars.id, id))
        .returning();
      if (!updated) throw new Error(`Pillar ${id} not updated`);
      if (archived) {
        // The others close up, keeping their order.
        for (const [index, pillar] of live.filter((item) => item.id !== id).entries()) {
          if (pillar.position !== index + 1) {
            await tx
              .update(contentPillars)
              .set({ position: index + 1 })
              .where(eq(contentPillars.id, pillar.id));
          }
        }
      }
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: archived ? 'content_pillar.archived' : 'content_pillar.restored',
        entityType: 'content_pillar',
        entityId: id,
        after: { name: row.name },
      });
      return toPillar(updated);
    });
  }

  /** A non-archived pillar, else `INVALID_LINK` (rule C1). */
  async assertLivePillar(executor: Executor, id: string): Promise<void> {
    const [row] = await executor
      .select({ id: contentPillars.id })
      .from(contentPillars)
      .where(and(eq(contentPillars.id, id), isNull(contentPillars.archivedAt)));
    if (!row) throw new CodedException(400, 'INVALID_LINK', 'The pillar is archived or unknown');
  }

  private async livePillars(tx: Transaction): Promise<PillarRow[]> {
    return tx
      .select()
      .from(contentPillars)
      .where(isNull(contentPillars.archivedAt))
      .orderBy(asc(contentPillars.position), asc(contentPillars.id));
  }

  private async pillarRow(tx: Transaction, id: string): Promise<PillarRow> {
    const [row] = await tx
      .select()
      .from(contentPillars)
      .where(eq(contentPillars.id, id))
      .for('update');
    if (!row) throw new NotFoundException();
    return row;
  }

  private async assertNameFree(tx: Transaction, name: string, exceptId?: string): Promise<void> {
    const [taken] = await tx
      .select({ id: contentPillars.id })
      .from(contentPillars)
      .where(
        and(
          isNull(contentPillars.archivedAt),
          sql`lower(${contentPillars.name}) = lower(${name})`,
          exceptId ? sql`${contentPillars.id} <> ${exceptId}` : undefined,
        ),
      );
    if (taken) throw new CodedException(409, 'NAME_TAKEN', 'Another pillar has this name');
  }

  // Settings (rules C1, C3, C4, C7)

  async agencySettings(executor: Executor = this.db): Promise<ContentAgencySettings> {
    const row = await this.agencyRow(executor);
    return { postingTimes: row?.postingTimes ?? [] };
  }

  async updateAgencySettings(
    actor: CurrentUserInfo,
    input: UpdateContentAgencySettings,
  ): Promise<ContentAgencySettings> {
    this.assertAgency(actor);
    await this.db.transaction(async (tx) => {
      const row = await this.agencyRow(tx, true);
      const diff = changedFields({ postingTimes: row?.postingTimes ?? [] }, input);
      if (!diff) return;
      const [saved] = row
        ? await tx
            .update(contentPlanningSettings)
            .set(diff.after)
            .where(eq(contentPlanningSettings.id, row.id))
            .returning()
        : await tx
            .insert(contentPlanningSettings)
            .values({ clientId: null, postingTimes: input.postingTimes })
            .returning();
      if (!saved) throw new Error('Agency settings not saved');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'content_settings.updated',
        entityType: 'content_settings',
        entityId: saved.id,
        before: diff.before,
        after: diff.after,
      });
    });
    return this.agencySettings();
  }

  /** The client's settings, or the defaults while none are saved (data table). */
  async planningSettings(
    client: Pick<ClientSummary, 'id' | 'isHealthcare'>,
    executor: Executor = this.db,
  ): Promise<ClientPlanningSettings> {
    return (await this.planningSettingsOf([client], executor)).get(
      client.id,
    ) as ClientPlanningSettings;
  }

  async planningSettingsOf(
    clients: readonly Pick<ClientSummary, 'id' | 'isHealthcare'>[],
    executor: Executor = this.db,
  ): Promise<Map<string, ClientPlanningSettings>> {
    const ids = clients.map((client) => client.id);
    const rows =
      ids.length === 0
        ? []
        : await executor
            .select()
            .from(contentPlanningSettings)
            .where(inArray(contentPlanningSettings.clientId, ids));
    const byClient = new Map(rows.map((row) => [row.clientId, row]));
    return new Map(
      clients.map((client) => {
        const row = byClient.get(client.id);
        return [
          client.id,
          row
            ? {
                saved: true,
                postingTimes: row.postingTimes,
                pillarTargets: row.pillarTargets,
                maxGapDays: row.maxGapDays,
                occasionCategories: row.occasionCategories,
                excludedOccasionIds: row.excludedOccasionIds,
                skippedOccasions: row.skippedOccasions,
                xLongPosts: row.xLongPosts,
              }
            : {
                saved: false,
                postingTimes: [],
                pillarTargets: [],
                maxGapDays: 3,
                occasionCategories: defaultOccasionCategories(client.isHealthcare),
                excludedOccasionIds: [],
                skippedOccasions: [],
                xLongPosts: false,
              },
        ];
      }),
    );
  }

  /** The clients with settings saved (rule C10). */
  async clientsWithSettings(executor: Executor = this.db): Promise<string[]> {
    const rows = await executor
      .select({ clientId: contentPlanningSettings.clientId })
      .from(contentPlanningSettings)
      .where(sql`${contentPlanningSettings.clientId} is not null`);
    return rows.flatMap((row) => row.clientId ?? []);
  }

  async clientSettings(actor: CurrentUserInfo, clientId: string): Promise<ClientContentSettings> {
    if (!holdsAll(actor, 'content.read')) throw new ForbiddenException();
    const client = await this.clients.summary(clientId);
    if (!client) throw new NotFoundException();
    return this.presentClientSettings(client);
  }

  async updateClientSettings(
    actor: CurrentUserInfo,
    clientId: string,
    input: UpdateClientContentSettings,
  ): Promise<ClientContentSettings> {
    const client = await this.manageableClient(actor, clientId);
    await this.db.transaction(async (tx) => {
      const total = input.pillarTargets.reduce((sum, target) => sum + target.percent, 0);
      if (input.pillarTargets.length > 0 && total !== 100) {
        throw new CodedException(400, 'INVALID_TARGETS', 'The targets sum to 100', { total });
      }
      const pillars = await this.pillarsById(
        input.pillarTargets.map((target) => target.pillarId),
        tx,
      );
      if (input.pillarTargets.some((target) => pillars.get(target.pillarId)?.archived !== false)) {
        throw new CodedException(
          400,
          'INVALID_LINK',
          'A target names an archived or unknown pillar',
        );
      }
      if (input.excludedOccasionIds.length > 0) {
        const [known] = await tx
          .select({ value: count() })
          .from(contentOccasions)
          .where(inArray(contentOccasions.id, input.excludedOccasionIds));
        if ((known?.value ?? 0) !== input.excludedOccasionIds.length) {
          throw new CodedException(400, 'INVALID_LINK', 'An excluded occasion is unknown');
        }
      }
      const current = await this.planningSettings(client, tx);
      const { saved: _, skippedOccasions: __, ...before } = current;
      const diff = changedFields(before, input);
      await this.upsertClientRow(tx, client.id, input);
      if (diff || !current.saved) {
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'content_settings.updated',
          entityType: 'content_settings',
          entityId: client.id,
          before: diff?.before,
          after: { clientId: client.id, ...diff?.after },
        });
      }
    });
    return this.presentClientSettings(client);
  }

  /** "No post this year" for an occasion of the client (rule C6). */
  async skipOccasion(
    actor: CurrentUserInfo,
    clientId: string,
    skip: OccasionSkip,
    skipped: boolean,
  ): Promise<ClientContentSettings> {
    const client = await this.manageableClient(actor, clientId);
    await this.db.transaction(async (tx) => {
      const [occasion] = await tx
        .select({ id: contentOccasions.id })
        .from(contentOccasions)
        .where(eq(contentOccasions.id, skip.occasionId));
      if (!occasion) throw new NotFoundException();
      const current = await this.planningSettings(client, tx);
      const same = (item: OccasionSkip) =>
        item.occasionId === skip.occasionId && item.year === skip.year;
      const had = current.skippedOccasions.some(same);
      if (had === skipped) return;
      const skippedOccasions = skipped
        ? [...current.skippedOccasions, skip]
        : current.skippedOccasions.filter((item) => !same(item));
      const { saved: _, ...fields } = current;
      await this.upsertClientRow(tx, client.id, { ...fields, skippedOccasions });
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'content_settings.updated',
        entityType: 'content_settings',
        entityId: client.id,
        before: { skippedOccasions: current.skippedOccasions },
        after: { clientId: client.id, skippedOccasions },
      });
    });
    return this.presentClientSettings(client);
  }

  private async upsertClientRow(
    tx: Transaction,
    clientId: string,
    values: Partial<Omit<ClientPlanningSettings, 'saved'>>,
  ): Promise<void> {
    await tx
      .insert(contentPlanningSettings)
      .values({ clientId, ...values })
      .onConflictDoUpdate({
        target: contentPlanningSettings.clientId,
        set: { ...values, updatedAt: new Date() },
      });
  }

  private async presentClientSettings(client: ClientSummary): Promise<ClientContentSettings> {
    const [settings, agency] = await Promise.all([
      this.planningSettings(client),
      this.agencySettings(),
    ]);
    return {
      clientId: client.id,
      saved: settings.saved,
      postingTimes: settings.postingTimes,
      pillarTargets: settings.pillarTargets,
      maxGapDays: settings.maxGapDays,
      occasionCategories: settings.occasionCategories,
      excludedOccasionIds: settings.excludedOccasionIds,
      skippedOccasions: settings.skippedOccasions,
      xLongPosts: settings.xLongPosts,
      effectivePostingTimes: effectivePostingTimes(agency.postingTimes, settings.postingTimes),
    };
  }

  private async agencyRow(executor: Executor, forUpdate = false): Promise<SettingsRow | undefined> {
    const query = executor
      .select()
      .from(contentPlanningSettings)
      .where(isNull(contentPlanningSettings.clientId));
    const [row] = forUpdate ? await query.for('update') : await query;
    return row;
  }

  // Snippets (rule A10)

  async snippets(
    actor: CurrentUserInfo,
    query: ContentSnippetListQuery,
  ): Promise<ContentSnippetList> {
    if (!holdsAll(actor, 'content.read')) throw new ForbiddenException();
    const rows = await this.db
      .select()
      .from(contentSnippets)
      .where(
        and(
          isNull(contentSnippets.archivedAt),
          query.clientId
            ? or(isNull(contentSnippets.clientId), eq(contentSnippets.clientId, query.clientId))
            : isNull(contentSnippets.clientId),
          query.kind ? eq(contentSnippets.kind, query.kind) : undefined,
        ),
      )
      .orderBy(sql`${contentSnippets.clientId} is null`, asc(contentSnippets.name));
    const clients = await this.clients.summaries(rows.flatMap((row) => row.clientId ?? []));
    return {
      items: rows.map((row) =>
        this.toSnippet(actor, row, row.clientId ? clients.get(row.clientId) : null),
      ),
    };
  }

  async createSnippet(
    actor: CurrentUserInfo,
    input: CreateContentSnippet,
  ): Promise<ContentSnippet> {
    const client = input.clientId ? await this.manageableClient(actor, input.clientId) : null;
    if (!client) this.assertAgency(actor);
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`content.snippets:${input.clientId ?? 'agency'}:${input.kind}`}, 0))`,
      );
      const [existing] = await tx
        .select({ value: count() })
        .from(contentSnippets)
        .where(
          and(
            isNull(contentSnippets.archivedAt),
            eq(contentSnippets.kind, input.kind),
            client ? eq(contentSnippets.clientId, client.id) : isNull(contentSnippets.clientId),
          ),
        );
      if ((existing?.value ?? 0) >= CONTENT_PLANNING_LIMITS.snippets) {
        throw new CodedException(
          409,
          'LIMIT_REACHED',
          `At most ${CONTENT_PLANNING_LIMITS.snippets} snippets of a kind`,
        );
      }
      const [row] = await tx
        .insert(contentSnippets)
        .values({ ...input, createdById: actor.id })
        .returning();
      if (!row) throw new Error('Snippet insert returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'content_snippet.created',
        entityType: 'content_snippet',
        entityId: row.id,
        after: { clientId: row.clientId, kind: row.kind, name: row.name, length: row.body.length },
      });
      return this.toSnippet(actor, row, client);
    });
  }

  async updateSnippet(
    actor: CurrentUserInfo,
    id: string,
    input: UpdateContentSnippet,
  ): Promise<ContentSnippet> {
    return this.db.transaction(async (tx) => {
      const { row, client } = await this.editableSnippet(tx, actor, id);
      const body = input.body ?? row.body;
      if (body.length > CONTENT_PLANNING_LIMITS.snippetBody[row.kind]) {
        throw new BadRequestException('The text is too long for this kind');
      }
      const diff = changedFields({ name: row.name, body: row.body }, input);
      if (!diff) return this.toSnippet(actor, row, client);
      const [updated] = await tx
        .update(contentSnippets)
        .set(diff.after)
        .where(eq(contentSnippets.id, id))
        .returning();
      if (!updated) throw new Error(`Snippet ${id} not updated`);
      const lengths = (fields: Partial<{ name: string; body: string }>) => ({
        ...(fields.name !== undefined && { name: fields.name }),
        ...(fields.body !== undefined && { length: fields.body.length }),
      });
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'content_snippet.updated',
        entityType: 'content_snippet',
        entityId: id,
        before: lengths(diff.before),
        after: lengths(diff.after),
      });
      return this.toSnippet(actor, updated, client);
    });
  }

  async archiveSnippet(actor: CurrentUserInfo, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { row } = await this.editableSnippet(tx, actor, id);
      await tx
        .update(contentSnippets)
        .set({ archivedAt: new Date() })
        .where(eq(contentSnippets.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'content_snippet.archived',
        entityType: 'content_snippet',
        entityId: id,
        after: { name: row.name },
      });
    });
  }

  private async editableSnippet(tx: Transaction, actor: CurrentUserInfo, id: string) {
    const [row] = await tx
      .select()
      .from(contentSnippets)
      .where(and(eq(contentSnippets.id, id), isNull(contentSnippets.archivedAt)))
      .for('update');
    if (!row) throw new NotFoundException();
    const client = row.clientId ? await this.clients.summary(row.clientId, tx) : null;
    if (!this.mayEditSnippet(actor, client)) throw new ForbiddenException();
    return { row, client };
  }

  private mayEditSnippet(actor: CurrentUserInfo, client: ClientSummary | null | undefined) {
    return client
      ? coversClient(actor, 'content.manage', client)
      : holdsAll(actor, 'content.review');
  }

  private toSnippet(
    actor: CurrentUserInfo,
    row: typeof contentSnippets.$inferSelect,
    client: ClientSummary | null | undefined,
  ): ContentSnippet {
    return {
      id: row.id,
      client:
        row.clientId && client
          ? { id: client.id, name: client.name, imageId: client.imageId }
          : null,
      kind: row.kind,
      name: row.name,
      body: row.body,
      canEdit: this.mayEditSnippet(actor, client),
    };
  }

  // Access

  /** Agency-wide settings: `content.review` with scope all. */
  assertAgency(actor: CurrentUserInfo): void {
    if (!holdsAll(actor, 'content.review')) throw new ForbiddenException();
  }

  /** A client under the actor's `content.manage`; 404 for an unknown one. */
  async manageableClient(actor: CurrentUserInfo, clientId: string): Promise<ClientSummary> {
    const client = await this.clients.summary(clientId);
    if (!client) throw new NotFoundException();
    if (!coversClient(actor, 'content.manage', client)) throw new ForbiddenException();
    return client;
  }
}

const pillarLimit = () =>
  new CodedException(
    409,
    'LIMIT_REACHED',
    `At most ${CONTENT_PLANNING_LIMITS.pillars} pillars are offered`,
  );
