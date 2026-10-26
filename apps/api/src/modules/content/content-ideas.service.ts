import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  type ContentIdea,
  type ContentIdeaListQuery,
  type ContentIdeaPage,
  type CreateContentIdea,
  contentIdeasSubjectId,
  type DropContentIdea,
  hasPermission,
  type IdeaStatus,
  NOTIFICATION_EXCERPT_MAX,
  type UpdateContentIdea,
} from '@vertex-hub/contracts';
import { contentIdeas, contentPosts, type Database, type Transaction } from '@vertex-hub/db';
import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, personRef, UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary, clientRef } from '../clients/index.js';
import type { Notice } from '../notifications/index.js';
import { ContentOccasionsService } from './content-occasions.service.js';
import { ContentSettingsService } from './content-settings.service.js';
import { actorOf, coversClient, holdsAll } from './post-access.js';
import { type NoticePost, PostNotices } from './post-notices.js';

type IdeaRow = typeof contentIdeas.$inferSelect;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

const statusOf = (row: IdeaRow): IdeaStatus =>
  row.postId ? 'used' : row.archivedAt ? 'dropped' : 'open';

const STATUS_SQL: Record<IdeaStatus, SQL> = {
  open: and(isNull(contentIdeas.postId), isNull(contentIdeas.archivedAt)) as SQL,
  used: isNotNull(contentIdeas.postId),
  dropped: isNotNull(contentIdeas.archivedAt),
};

const excerpt = (text: string) => text.slice(0, NOTIFICATION_EXCERPT_MAX);

const ideaUsed = () => new CodedException(409, 'IDEA_USED', 'The idea already became a post');

/**
 * The ideas bank (spec F08B rule C12): any active user adds an idea; its author edits or drops it
 * while open; `content.manage` holders covering its client (every holder for an idea without a
 * client) edit, drop, restore and use it. An idea becomes a post once, in the post's save.
 */
@Injectable()
export class ContentIdeasService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly settings: ContentSettingsService,
    private readonly occasions: ContentOccasionsService,
    private readonly notices: PostNotices,
  ) {}

  async list(actor: CurrentUserInfo, query: ContentIdeaListQuery): Promise<ContentIdeaPage> {
    if (!holdsAll(actor, 'content.read')) throw new ForbiddenException();
    const where = and(
      STATUS_SQL[query.status],
      query.clientId ? eq(contentIdeas.clientId, query.clientId) : undefined,
      query.mine ? eq(contentIdeas.createdById, actor.id) : undefined,
      query.q ? ilike(contentIdeas.text, `%${escapeLike(query.q)}%`) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(contentIdeas)
        .where(where)
        .orderBy(desc(contentIdeas.createdAt), desc(contentIdeas.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(contentIdeas).where(where),
    ]);
    return {
      items: await this.present(actor, rows),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(actor: CurrentUserInfo, input: CreateContentIdea): Promise<ContentIdea> {
    const row = await this.db.transaction(async (tx) => {
      const client = input.clientId ? await this.liveClient(tx, input.clientId) : null;
      await this.assertLinks(tx, input, client);
      const [created] = await tx
        .insert(contentIdeas)
        .values({ ...input, createdById: actor.id })
        .returning();
      if (!created) throw new Error('Idea insert returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'content_idea.created',
        entityType: 'content_idea',
        entityId: created.id,
        after: this.auditable(created),
      });
      // F08B Part D: Content Management hears of it, merged per day.
      const members = await this.users.activeMembers(['content_management'], tx);
      await this.notices.send(tx, [
        {
          type: 'content_idea_added',
          recipients: members.map((member) => member.id).filter((id) => id !== actor.id),
          actorId: actor.id,
          subjectId: contentIdeasSubjectId(businessDate()),
          data: { idea: excerpt(created.text), client: client?.name ?? null },
        } as Notice,
      ]);
      return created;
    });
    return this.one(actor, row.id);
  }

  async update(actor: CurrentUserInfo, id: string, input: UpdateContentIdea): Promise<ContentIdea> {
    await this.db.transaction(async (tx) => {
      const { row, client } = await this.editable(tx, actor, id, 'edit');
      const diff = changedFields(this.auditable(row), input);
      if (!diff) return;
      const nextClient =
        diff.after.clientId !== undefined
          ? diff.after.clientId
            ? await this.liveClient(tx, diff.after.clientId)
            : null
          : client;
      // Moving the idea to a client the actor does not cover is not theirs to do.
      if (nextClient && nextClient.id !== client?.id && !this.covers(actor, nextClient)) {
        if (row.createdById !== actor.id) throw new ForbiddenException();
      }
      await this.assertLinks(tx, { ...this.auditable(row), ...diff.after }, nextClient);
      await tx.update(contentIdeas).set(diff.after).where(eq(contentIdeas.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'content_idea.updated',
        entityType: 'content_idea',
        entityId: id,
        before: diff.before,
        after: diff.after,
      });
    });
    return this.one(actor, id);
  }

  async drop(actor: CurrentUserInfo, id: string, input: DropContentIdea): Promise<ContentIdea> {
    await this.db.transaction(async (tx) => {
      const { row } = await this.editable(tx, actor, id, 'edit');
      await tx
        .update(contentIdeas)
        .set({ archivedAt: new Date(), dropReason: input.reason ?? null })
        .where(eq(contentIdeas.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'content_idea.dropped',
        entityType: 'content_idea',
        entityId: id,
        after: { text: excerpt(row.text), ...(input.reason && { reason: input.reason }) },
      });
    });
    return this.one(actor, id);
  }

  async restore(actor: CurrentUserInfo, id: string): Promise<ContentIdea> {
    await this.db.transaction(async (tx) => {
      const { row } = await this.editable(tx, actor, id, 'restore');
      await tx
        .update(contentIdeas)
        .set({ archivedAt: null, dropReason: null })
        .where(eq(contentIdeas.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'content_idea.restored',
        entityType: 'content_idea',
        entityId: id,
        after: { text: excerpt(row.text) },
      });
    });
    return this.one(actor, id);
  }

  /**
   * Rule C12: marks the idea used by the post in the post's transaction (`IDEA_USED` when it
   * was used meanwhile, edge case 10) and tells its author.
   */
  async use(tx: Transaction, actor: CurrentUserInfo, id: string, post: NoticePost): Promise<void> {
    const [row] = await tx.select().from(contentIdeas).where(eq(contentIdeas.id, id)).for('update');
    if (!row) throw new CodedException(400, 'INVALID_LINK', 'Unknown idea');
    if (row.postId) throw ideaUsed();
    if (row.archivedAt || (row.clientId && row.clientId !== post.client.id)) {
      throw new CodedException(400, 'INVALID_LINK', 'The idea was dropped or is of another client');
    }
    if (!this.covers(actor, post.client)) throw new ForbiddenException();
    await tx.update(contentIdeas).set({ postId: post.id }).where(eq(contentIdeas.id, id));
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'content_idea.used',
      entityType: 'content_idea',
      entityId: id,
      after: { postId: post.id, text: excerpt(row.text) },
    });
    if (row.createdById !== actor.id) {
      await this.notices.send(tx, [
        this.notices.notice(post, 'content_idea_used', [row.createdById], actor.id, {
          idea: excerpt(row.text),
        }),
      ]);
    }
  }

  private async one(actor: CurrentUserInfo, id: string): Promise<ContentIdea> {
    const [row] = await this.db.select().from(contentIdeas).where(eq(contentIdeas.id, id));
    if (!row) throw new NotFoundException();
    const [idea] = await this.present(actor, [row]);
    if (!idea) throw new Error(`Idea ${id} was not presented`);
    return idea;
  }

  private async present(actor: CurrentUserInfo, rows: IdeaRow[]): Promise<ContentIdea[]> {
    const [clients, people, pillars, occasions, posts] = await Promise.all([
      this.clients.summaries(rows.flatMap((row) => row.clientId ?? [])),
      this.users.summaries(rows.map((row) => row.createdById)),
      this.settings.pillarsById(rows.flatMap((row) => row.pillarId ?? [])),
      this.occasions.refs(rows.flatMap((row) => row.occasionId ?? [])),
      this.postTitles(rows.flatMap((row) => row.postId ?? [])),
    ]);
    return rows.map((row) => {
      const status = statusOf(row);
      const client = row.clientId ? clients.get(row.clientId) : null;
      const covers = this.covers(actor, client ?? null);
      const author = row.createdById === actor.id && hasPermission(actor.access, 'content.suggest');
      return {
        id: row.id,
        text: row.text,
        client: row.clientId ? clientRef(clients, row.clientId) : null,
        pillar: row.pillarId ? (pillars.get(row.pillarId) ?? null) : null,
        occasion: row.occasionId ? (occasions.get(row.occasionId) ?? null) : null,
        status,
        post: row.postId ? { id: row.postId, title: posts.get(row.postId) ?? '' } : null,
        dropReason: row.dropReason,
        createdBy: personRef(people, row.createdById),
        createdAt: row.createdAt.toISOString(),
        permissions: {
          canEdit: status === 'open' && (author || covers),
          canDrop: status === 'open' && (author || covers),
          canRestore: status === 'dropped' && covers,
          canUse: status === 'open' && covers,
        },
      };
    });
  }

  private async postTitles(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: contentPosts.id, title: contentPosts.title })
      .from(contentPosts)
      .where(inArray(contentPosts.id, ids));
    return new Map(rows.map((row) => [row.id, row.title]));
  }

  /** Rule C12: `content.manage` covering the client; any holder for an idea without one. */
  private covers(actor: CurrentUserInfo, client: ClientSummary | null): boolean {
    return client
      ? coversClient(actor, 'content.manage', client)
      : hasPermission(actor.access, 'content.manage');
  }

  /**
   * `edit`: the author while it is open, or a holder covering its client; `IDEA_USED` once
   * used. `restore`: a dropped idea, by a holder covering its client.
   */
  private async editable(
    tx: Transaction,
    actor: CurrentUserInfo,
    id: string,
    action: 'edit' | 'restore',
  ): Promise<{ row: IdeaRow; client: ClientSummary | null }> {
    const [row] = await tx.select().from(contentIdeas).where(eq(contentIdeas.id, id)).for('update');
    if (!row || !holdsAll(actor, 'content.read')) throw new NotFoundException();
    const client = row.clientId ? ((await this.clients.summary(row.clientId, tx)) ?? null) : null;
    const covers = this.covers(actor, client);
    const author = row.createdById === actor.id && hasPermission(actor.access, 'content.suggest');
    if (action === 'restore' ? !covers : !(covers || author)) throw new ForbiddenException();
    if (row.postId) throw ideaUsed();
    if (action === 'edit' && row.archivedAt) {
      throw new CodedException(409, 'INVALID_TRANSITION', 'The idea was dropped: restore it first');
    }
    if (action === 'restore' && !row.archivedAt) {
      throw new CodedException(409, 'INVALID_TRANSITION', 'The idea is open');
    }
    return { row, client };
  }

  /** A client that takes ideas: not archived (`CLIENT_ARCHIVED`). */
  private async liveClient(tx: Transaction, clientId: string): Promise<ClientSummary> {
    const client = await this.clients.summary(clientId, tx);
    if (!client) throw new CodedException(400, 'INVALID_LINK', 'Unknown client');
    if (client.archived) throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
    return client;
  }

  /** The pillar is live; the occasion is live and the client's own or applying to it. */
  private async assertLinks(
    tx: Transaction,
    input: Pick<CreateContentIdea, 'pillarId' | 'occasionId'>,
    client: ClientSummary | null,
  ): Promise<void> {
    if (input.pillarId) await this.settings.assertLivePillar(tx, input.pillarId);
    if (input.occasionId) {
      const settings = client ? await this.settings.planningSettings(client, tx) : null;
      await this.occasions.assertUsable(
        tx,
        input.occasionId,
        client && settings ? { id: client.id, settings } : null,
      );
    }
  }

  private auditable(row: IdeaRow) {
    return {
      text: row.text,
      clientId: row.clientId,
      pillarId: row.pillarId,
      occasionId: row.occasionId,
    };
  }
}
