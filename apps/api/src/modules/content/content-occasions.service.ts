import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CalendarDate,
  type ConfirmOccasionDate,
  type ContentOccasion,
  type ContentOccasionList,
  type ContentOccasionListQuery,
  type CreateContentOccasion,
  type OccasionOccurrence,
  occasionApplies,
  occasionDates,
  occasionRuleProblem,
  type UpdateContentOccasion,
} from '@vertex-hub/contracts';
import {
  contentOccasionDates,
  contentOccasions,
  type Database,
  type Transaction,
} from '@vertex-hub/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory, type ClientSummary, clientRef } from '../clients/index.js';
import { type ClientPlanningSettings, ContentSettingsService } from './content-settings.service.js';
import { actorOf, coversClient, holdsAll } from './post-access.js';

type Executor = Database | Transaction;

type OccasionRow = typeof contentOccasions.$inferSelect;

/** An occasion with its occurrences in a range. */
export interface DatedOccasion {
  row: OccasionRow;
  occurrences: OccasionOccurrence[];
}

/**
 * Occasions of the content calendar (spec F08B rules C4–C6): yearly Gregorian or Hijri days and
 * one-time dates, with a manager's confirmed start per year. Agency occasions belong to
 * `content.review` holders of scope all; a client's own also to `content.manage` covering it.
 */
@Injectable()
export class ContentOccasionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly settings: ContentSettingsService,
  ) {}

  async list(
    actor: CurrentUserInfo,
    query: ContentOccasionListQuery,
  ): Promise<ContentOccasionList> {
    if (!holdsAll(actor, 'content.read')) throw new ForbiddenException();
    const rows = await this.db
      .select()
      .from(contentOccasions)
      .where(query.includeArchived ? undefined : isNull(contentOccasions.archivedAt))
      .orderBy(asc(contentOccasions.name));
    let shown = rows;
    if (query.clientId) {
      const client = await this.clients.summary(query.clientId);
      if (!client) throw new NotFoundException();
      const { excludedOccasionIds: _, ...settings } = await this.settings.planningSettings(client);
      // The list shows excluded occasions too: the settings screen turns them back on.
      shown = rows.filter((row) =>
        occasionApplies(row, { id: client.id, ...settings, excludedOccasionIds: [] }),
      );
    }
    const dated = await this.dated(shown, query.from, query.to);
    const clients = await this.clients.summaries(shown.flatMap((row) => row.clientId ?? []));
    const firstStart = (item: DatedOccasion) => item.occurrences[0]?.start ?? '9999-12-31';
    return {
      items: dated
        .sort((a, b) => firstStart(a).localeCompare(firstStart(b)))
        .map((item) =>
          this.toOccasion(item, item.row.clientId ? clientRef(clients, item.row.clientId) : null),
        ),
    };
  }

  /**
   * Rule C4: the live occasions applying to each client, dated in `[from, to]` with their hint
   * windows; skips are left to the caller.
   */
  async applying(
    clients: readonly {
      id: string;
      settings: Pick<ClientPlanningSettings, 'occasionCategories' | 'excludedOccasionIds'>;
    }[],
    from: CalendarDate,
    to: CalendarDate,
    executor: Executor = this.db,
  ): Promise<Map<string, DatedOccasion[]>> {
    const rows = await executor
      .select()
      .from(contentOccasions)
      .where(isNull(contentOccasions.archivedAt));
    const dated = (await this.dated(rows, from, to, executor)).filter(
      (item) => item.occurrences.length > 0,
    );
    return new Map(
      clients.map((client) => [
        client.id,
        dated.filter((item) => occasionApplies(item.row, { id: client.id, ...client.settings })),
      ]),
    );
  }

  /** The live occasions dated in `[from, to]`, for the agency calendar (no client asked). */
  async inRange(from: CalendarDate, to: CalendarDate): Promise<DatedOccasion[]> {
    const rows = await this.db
      .select()
      .from(contentOccasions)
      .where(isNull(contentOccasions.archivedAt));
    return (await this.dated(rows, from, to)).filter((item) => item.occurrences.length > 0);
  }

  /** Occasions by id, archived or not: name and state, for posts and ideas. */
  async refs(ids: readonly string[], executor: Executor = this.db) {
    if (ids.length === 0) return new Map<string, { id: string; name: string; archived: boolean }>();
    const rows = await executor
      .select({
        id: contentOccasions.id,
        name: contentOccasions.name,
        archivedAt: contentOccasions.archivedAt,
      })
      .from(contentOccasions)
      .where(inArray(contentOccasions.id, [...new Set(ids)]));
    return new Map(
      rows.map((row) => [row.id, { id: row.id, name: row.name, archived: !!row.archivedAt }]),
    );
  }

  /**
   * A live occasion a post or an idea of `clientId` may carry: the client's own or one applying
   * to it; without a client, any agency occasion. `INVALID_LINK` otherwise.
   */
  async assertUsable(
    executor: Executor,
    id: string,
    client:
      | (Pick<ClientSummary, 'id'> & {
          settings: Pick<ClientPlanningSettings, 'occasionCategories' | 'excludedOccasionIds'>;
        })
      | null,
  ): Promise<void> {
    const [row] = await executor
      .select()
      .from(contentOccasions)
      .where(and(eq(contentOccasions.id, id), isNull(contentOccasions.archivedAt)));
    const usable =
      row && (client ? occasionApplies(row, { id: client.id, ...client.settings }) : !row.clientId);
    if (!usable) {
      throw new CodedException(
        400,
        'INVALID_LINK',
        'The occasion is archived or not of this client',
      );
    }
  }

  async create(actor: CurrentUserInfo, input: CreateContentOccasion): Promise<ContentOccasion> {
    const client = input.clientId ? await this.clients.summary(input.clientId) : null;
    if (input.clientId && !client) throw new CodedException(400, 'INVALID_LINK', 'Unknown client');
    this.assertMayEdit(actor, client);
    const problem = occasionRuleProblem(input);
    if (problem) throw new CodedException(400, 'INVALID_DATES', problem);
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(contentOccasions)
        .values({ ...input, createdById: actor.id })
        .returning();
      if (!row) throw new Error('Occasion insert returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'content_occasion.created',
        entityType: 'content_occasion',
        entityId: row.id,
        after: this.auditable(row),
      });
      return row.id;
    });
    return this.one(id);
  }

  async update(
    actor: CurrentUserInfo,
    id: string,
    input: UpdateContentOccasion,
  ): Promise<ContentOccasion> {
    await this.db.transaction(async (tx) => {
      const row = await this.editable(tx, actor, id);
      const diff = changedFields(this.auditable(row), input);
      if (!diff) return;
      const problem = occasionRuleProblem({ ...row, ...diff.after });
      if (problem) throw new CodedException(400, 'INVALID_DATES', problem);
      await tx.update(contentOccasions).set(diff.after).where(eq(contentOccasions.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'content_occasion.updated',
        entityType: 'content_occasion',
        entityId: id,
        before: diff.before,
        after: diff.after,
      });
    });
    return this.one(id);
  }

  /** Archived: no longer on the calendar or in checks; posts keep it (edge case 11). */
  async setArchived(
    actor: CurrentUserInfo,
    id: string,
    archived: boolean,
  ): Promise<ContentOccasion> {
    await this.db.transaction(async (tx) => {
      const row = await this.editable(tx, actor, id);
      if (!!row.archivedAt === archived) return;
      await tx
        .update(contentOccasions)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(contentOccasions.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: archived ? 'content_occasion.archived' : 'content_occasion.restored',
        entityType: 'content_occasion',
        entityId: id,
        after: { name: row.name },
      });
    });
    return this.one(id);
  }

  /** Rule C5 and edge case 12: a confirmed start for a year, replacing the computed one. */
  async confirmDate(
    actor: CurrentUserInfo,
    id: string,
    year: number,
    input: ConfirmOccasionDate,
  ): Promise<ContentOccasion> {
    if (!holdsAll(actor, 'content.review')) throw new ForbiddenException();
    if (!input.startDate.startsWith(`${year}-`)) {
      throw new CodedException(400, 'INVALID_DATES', 'The start falls in the year it confirms');
    }
    await this.db.transaction(async (tx) => {
      const row = await this.occasionRow(tx, id);
      if (row.calendar === 'once') {
        throw new CodedException(400, 'INVALID_DATES', 'A one-time occasion has its date');
      }
      const [live] = await tx
        .select()
        .from(contentOccasionDates)
        .where(this.liveDate(id, year))
        .for('update');
      if (live?.startDate === input.startDate) return;
      if (live) {
        await tx
          .update(contentOccasionDates)
          .set({ startDate: input.startDate, confirmedById: actor.id })
          .where(eq(contentOccasionDates.id, live.id));
      } else {
        await tx
          .insert(contentOccasionDates)
          .values({ occasionId: id, year, startDate: input.startDate, confirmedById: actor.id });
      }
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'content_occasion.date_confirmed',
        entityType: 'content_occasion',
        entityId: id,
        before: live ? { startDate: live.startDate } : undefined,
        after: { year, startDate: input.startDate },
      });
    });
    return this.one(id);
  }

  /** Back to the computed date: the confirmed row is archived. */
  async clearDate(actor: CurrentUserInfo, id: string, year: number): Promise<ContentOccasion> {
    if (!holdsAll(actor, 'content.review')) throw new ForbiddenException();
    await this.db.transaction(async (tx) => {
      await this.occasionRow(tx, id);
      const [live] = await tx
        .select()
        .from(contentOccasionDates)
        .where(this.liveDate(id, year))
        .for('update');
      if (!live) return;
      await tx
        .update(contentOccasionDates)
        .set({ archivedAt: new Date() })
        .where(eq(contentOccasionDates.id, live.id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'content_occasion.date_cleared',
        entityType: 'content_occasion',
        entityId: id,
        before: { year, startDate: live.startDate },
      });
    });
    return this.one(id);
  }

  /** The occasion with its occurrences this year and next. */
  private async one(id: string): Promise<ContentOccasion> {
    const row = await this.occasionRow(this.db, id);
    const year = new Date().getUTCFullYear();
    const [dated] = await this.dated([row], `${year}-01-01`, `${year + 1}-12-31`);
    const clients = row.clientId ? await this.clients.summaries([row.clientId]) : new Map();
    return this.toOccasion(
      dated ?? { row, occurrences: [] },
      row.clientId ? clientRef(clients, row.clientId) : null,
    );
  }

  private async dated(
    rows: readonly OccasionRow[],
    from: CalendarDate,
    to: CalendarDate,
    executor: Executor = this.db,
  ): Promise<DatedOccasion[]> {
    const confirmed =
      rows.length === 0
        ? []
        : await executor
            .select()
            .from(contentOccasionDates)
            .where(
              and(
                inArray(
                  contentOccasionDates.occasionId,
                  rows.map((row) => row.id),
                ),
                isNull(contentOccasionDates.archivedAt),
              ),
            );
    return rows.map((row) => ({
      row,
      occurrences: occasionDates(
        row,
        from,
        to,
        new Map(
          confirmed
            .filter((item) => item.occasionId === row.id)
            .map((item) => [item.year, item.startDate]),
        ),
      ),
    }));
  }

  private toOccasion(
    { row, occurrences }: DatedOccasion,
    client: ContentOccasion['client'],
  ): ContentOccasion {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      client,
      calendar: row.calendar,
      month: row.month,
      day: row.day,
      date: row.date,
      durationDays: row.durationDays,
      leadDays: row.leadDays,
      archived: !!row.archivedAt,
      occurrences: occurrences.map((item) => ({
        year: item.year,
        startDate: item.start,
        endDate: item.end,
        confirmed: item.confirmed,
      })),
    };
  }

  private auditable(row: OccasionRow) {
    return {
      name: row.name,
      category: row.category,
      calendar: row.calendar,
      month: row.month,
      day: row.day,
      date: row.date,
      durationDays: row.durationDays,
      leadDays: row.leadDays,
      ...(row.clientId && { clientId: row.clientId }),
    };
  }

  private liveDate(id: string, year: number) {
    return and(
      eq(contentOccasionDates.occasionId, id),
      eq(contentOccasionDates.year, year),
      isNull(contentOccasionDates.archivedAt),
    );
  }

  private async occasionRow(executor: Executor, id: string): Promise<OccasionRow> {
    const [row] = await executor.select().from(contentOccasions).where(eq(contentOccasions.id, id));
    if (!row) throw new NotFoundException();
    return row;
  }

  private async editable(
    tx: Transaction,
    actor: CurrentUserInfo,
    id: string,
  ): Promise<OccasionRow> {
    const [row] = await tx
      .select()
      .from(contentOccasions)
      .where(eq(contentOccasions.id, id))
      .for('update');
    if (!row) throw new NotFoundException();
    const client = row.clientId ? await this.clients.summary(row.clientId, tx) : null;
    this.assertMayEdit(actor, client);
    return row;
  }

  private assertMayEdit(actor: CurrentUserInfo, client: ClientSummary | null | undefined): void {
    const allowed =
      holdsAll(actor, 'content.review') ||
      (!!client && coversClient(actor, 'content.manage', client));
    if (!allowed) throw new ForbiddenException();
  }
}
