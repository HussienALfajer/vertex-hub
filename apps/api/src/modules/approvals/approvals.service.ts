import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  APPROVAL_LIMITS,
  type ApprovalItem,
  type ApprovalReady,
  type ApprovalReadyQuery,
  type ApprovalRequest,
  type ApprovalRequestDetail,
  type ApprovalRequestListQuery,
  type ApprovalRequestPage,
  type ApprovalWithdrawnReason,
  approvalRequestState,
  type ClientApprovals,
  type ClientDecision,
  type CreateApprovalRequest,
  fileTypeOf,
  type IssuedApprovalRequest,
  type PageQuery,
  permissionScopes,
  type ReadyClient,
} from '@vertex-hub/contracts';
import { approvalItems, approvalRequests, type Database, type Transaction } from '@vertex-hub/db';
import { and, asc, count, desc, eq, getTableName, inArray, or, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { ENV, type Env } from '../../core/config/env.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { PostApprovals, PostReviewHooks } from '../content/index.js';
import { FileVersions, type SentVersion } from '../files/index.js';
import { ClientReviewHooks, type PendingApproval, TaskApprovals } from '../tasks/index.js';
import {
  closeItem,
  issueLink,
  lockRequest,
  type RequestRow,
  shownPost,
  stateSql,
} from './approval-items.js';

type Executor = Database | Transaction;

const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

/** Holds `tasks.manage` over every record: reads the requests of archived clients too. */
const holdsAll = (actor: CurrentUserInfo) =>
  permissionScopes(actor.access, 'tasks.manage').includes('all');

/** The item column that holds what an item sends: a task or a post. */
type SubjectColumn = typeof approvalItems.taskId | typeof approvalItems.postId;

/** A task or a post leaving `awaiting_client` by a path other than a response through its link. */
interface ClientExit {
  actor: AuditActor | null;
  /** The response recorded by hand that closes the pending item; null otherwise. */
  response: { id: string; decision: ClientDecision } | null;
}

/** A snapshot version as the agency sees it on a request. */
const toVersion = (version: SentVersion) => ({
  id: version.id,
  fileItemId: version.fileItemId,
  name: version.name,
  number: version.number,
  kind: version.kind,
  type: fileTypeOf(version.kind, version.mimeType),
  previewStatus: version.previewStatus,
});

/**
 * Approval requests (spec F09 rules 8–12 and 17, ADR 0020; F08 rules 20–25, ADR 0021): ready
 * tasks and posts of one client bundled into a link for a contact with final-approval authority.
 * Tells `tasks` and `content` about pending items and hears when a task or a post leaves
 * `awaiting_client`, through their `ClientReviewHooks` and `PostReviewHooks`.
 */
@Injectable()
export class ApprovalsService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly files: FileVersions,
    private readonly tasks: TaskApprovals,
    private readonly reviewHooks: ClientReviewHooks,
    private readonly posts: PostApprovals,
    private readonly postHooks: PostReviewHooks,
  ) {}

  onModuleInit(): void {
    this.reviewHooks.register({
      pending: (taskIds, executor) => this.pending(approvalItems.taskId, taskIds, executor),
      waitingSql: (column) => waitingSql(column, approvalItems.taskId),
      left: (tx, exit) => this.left(tx, approvalItems.taskId, exit.taskId, exit, 'task_moved'),
    });
    this.postHooks.register({
      pending: (postIds, executor) => this.pending(approvalItems.postId, postIds, executor),
      waitingSql: (column) => waitingSql(column, approvalItems.postId),
      left: (tx, exit) => this.left(tx, approvalItems.postId, exit.postId, exit, 'post_moved'),
    });
  }

  /**
   * Ready tasks (rule 8) and posts (F08 rule 20) under the actor's client scope, grouped by
   * client, by name.
   */
  async ready(actor: CurrentUserInfo, query: ApprovalReadyQuery): Promise<ApprovalReady> {
    const [tasks, posts] = await Promise.all([
      this.tasks.ready(actor, query.clientId),
      this.posts.ready(actor, query),
    ]);
    const clientIds = [
      ...new Set([
        ...tasks.flatMap((task) => (task.client ? [task.client.id] : [])),
        ...posts.map((post) => post.client.id),
      ]),
    ];
    const [clients, approvers] = await Promise.all([
      this.clients.summaries(clientIds),
      this.clients.approvers(clientIds),
    ]);
    const groups = clientIds.flatMap((id): ReadyClient[] => {
      const client = clients.get(id);
      if (!client) return [];
      return [
        {
          client: { id, name: client.name },
          isHealthcare: client.isHealthcare,
          contacts: approvers
            .filter((contact) => contact.clientId === id)
            .map(({ id: contactId, name, phone }) => ({ id: contactId, name, phone })),
          tasks: tasks.filter((task) => task.client?.id === id),
          posts: posts.filter((post) => post.client.id === id),
        },
      ];
    });
    return {
      clients: groups.sort((a, b) => a.client.name.localeCompare(b.client.name, 'ar')),
    };
  }

  async list(
    actor: CurrentUserInfo,
    query: ApprovalRequestListQuery,
  ): Promise<ApprovalRequestPage> {
    const now = new Date();
    return this.page(actor, query, now, [
      or(...query.state.map((state) => stateSql(state, now))),
      query.clientId ? eq(approvalRequests.clientId, query.clientId) : undefined,
      query.createdBy === 'me' ? eq(approvalRequests.createdById, actor.id) : undefined,
    ]);
  }

  /** A client's requests in every state and its responses, both newest first. */
  async clientApprovals(
    actor: CurrentUserInfo,
    clientId: string,
    query: PageQuery,
  ): Promise<ClientApprovals> {
    const client = await this.clients.summary(clientId);
    if (!client || (client.archived && !holdsAll(actor))) throw new NotFoundException();
    // Responses on tasks and on posts are one list: each side gives its newest up to this page.
    const upTo = { page: 1, pageSize: query.page * query.pageSize };
    const [requests, onTasks, onPosts] = await Promise.all([
      this.page(actor, query, new Date(), [eq(approvalRequests.clientId, clientId)]),
      this.tasks.clientResponses(clientId, upTo),
      this.posts.clientResponses(clientId, upTo),
    ]);
    return {
      requests,
      responses: {
        items: [...onTasks.items, ...onPosts.items]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice((query.page - 1) * query.pageSize, upTo.pageSize),
        total: onTasks.total + onPosts.total,
        page: query.page,
        pageSize: query.pageSize,
      },
    };
  }

  async detail(actor: CurrentUserInfo, id: string): Promise<ApprovalRequestDetail> {
    const [request] = await this.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id));
    const client = request ? await this.clients.summary(request.clientId) : null;
    // Edge case 7: the requests of an archived client stay readable to scope-all holders.
    if (!request || !client || (client.archived && !holdsAll(actor))) {
      throw new NotFoundException();
    }
    const now = new Date();
    const [[summary], items, contacts] = await Promise.all([
      this.present([request], now),
      this.db
        .select()
        .from(approvalItems)
        .where(eq(approvalItems.requestId, id))
        .orderBy(asc(approvalItems.position)),
      this.clients.contacts([request.contactId]),
    ]);
    if (!summary) throw new NotFoundException();
    const ids = (key: 'taskId' | 'postId' | 'reviewId' | 'postReviewId') =>
      items.flatMap((item) => item[key] ?? []);
    const [snapshots, titles, responses, postSnapshots, postTitles, postResponses] =
      await Promise.all([
        this.tasks.snapshots(ids('reviewId')),
        this.tasks.titles(ids('taskId')),
        this.tasks.responses(items.flatMap((item) => item.responseId ?? [])),
        this.posts.snapshots(ids('postReviewId')),
        this.posts.titles(ids('postId')),
        this.posts.responses(items.flatMap((item) => item.postResponseId ?? [])),
      ]);
    const versions = await this.files.sent(
      [...snapshots.values(), ...postSnapshots.values()].flatMap((snapshot) => snapshot.versionIds),
    );
    const sent = (versionIds: string[]) => versionIds.flatMap((id) => versions.get(id) ?? []);
    const { items: counts, ...basics } = summary;
    const scoped = this.tasks.hasClientScope(actor, client);
    const live = summary.state === 'open' || summary.state === 'expired';
    return {
      ...basics,
      counts,
      message: request.message,
      items: items.map((item): ApprovalItem => {
        const snapshot = item.reviewId ? snapshots.get(item.reviewId) : undefined;
        const postSnapshot = item.postReviewId ? postSnapshots.get(item.postReviewId) : undefined;
        const response = item.postId
          ? postResponses.get(item.postResponseId ?? '')
          : responses.get(item.responseId ?? '');
        return {
          id: item.id,
          position: item.position,
          kind: item.postId ? 'post' : 'task',
          title: item.title,
          task: item.taskId ? { id: item.taskId, title: titles.get(item.taskId) ?? '' } : null,
          post:
            item.postId && postSnapshot
              ? {
                  id: item.postId,
                  title: postTitles.get(item.postId) ?? '',
                  ...shownPost(postSnapshot),
                }
              : null,
          status: item.status,
          withdrawnReason: item.withdrawnReason,
          closedAt: item.closedAt?.toISOString() ?? null,
          // A post's media keeps the display order of its snapshot (F08 rule 5).
          versions: item.postId
            ? sent(postSnapshot?.versionIds ?? []).map(toVersion)
            : sent(snapshot?.versionIds ?? [])
                .sort((a, b) => a.name.localeCompare(b.name, 'ar') || a.number - b.number)
                .map(toVersion),
          text: snapshot?.clientText ?? null,
          response: response
            ? {
                decision: response.decision,
                channel: response.channel,
                note: response.note,
                createdAt: response.createdAt.toISOString(),
              }
            : null,
        };
      }),
      contactPhone: contacts.get(request.contactId)?.phone ?? null,
      permissions: {
        canReissue: scoped && live && !client.archived,
        canRevoke: scoped && live,
      },
    };
  }

  /**
   * Rule 9 and F08 rule 21: a link for 1–60 ready tasks and posts of one client, in the order
   * given. A task or a post whose pending item waits in an expired request is sent again, and
   * that item withdrawn (rule 8). The link is returned once.
   */
  async create(
    actor: CurrentUserInfo,
    input: CreateApprovalRequest,
  ): Promise<IssuedApprovalRequest> {
    if (input.items.length > APPROVAL_LIMITS.items) {
      throw new CodedException(
        409,
        'LIMIT_REACHED',
        `A request holds at most ${APPROVAL_LIMITS.items} tasks and posts`,
      );
    }
    const link = issueLink();
    const id = await this.db.transaction(async (tx) => {
      const client = await this.scopedClient(tx, actor, input.clientId);
      await this.assertApprover(tx, client, input.contactId);
      const taskIds = input.items.flatMap((item) => ('taskId' in item ? [item.taskId] : []));
      const postIds = input.items.flatMap((item) => ('postId' in item ? [item.postId] : []));
      // Posts are locked before tasks.
      const posts = new Map(
        (await this.posts.sendable(tx, client, postIds)).map((post) => [post.id, post]),
      );
      const tasks = new Map(
        (taskIds.length > 0 ? await this.tasks.sendable(tx, client, taskIds) : []).map((task) => [
          task.id,
          task,
        ]),
      );
      await this.withdrawExpired(tx, actorOf(actor), taskIds, postIds);
      const [request] = await tx
        .insert(approvalRequests)
        .values({
          clientId: client.id,
          contactId: input.contactId,
          message: input.message ?? null,
          tokenHash: link.tokenHash,
          linkIssuedAt: link.linkIssuedAt,
          expiresAt: link.expiresAt,
          createdById: actor.id,
        })
        .returning({ id: approvalRequests.id });
      if (!request) throw new Error('Approval request insert returned no row');
      await tx.insert(approvalItems).values(
        input.items.map((item, index) => {
          const sent = 'taskId' in item ? tasks.get(item.taskId) : posts.get(item.postId);
          if (!sent) throw new Error('A sendable item was not returned');
          return {
            requestId: request.id,
            position: index + 1,
            title: item.title ?? sent.title.slice(0, 160),
            ...('taskId' in item
              ? { taskId: sent.id, reviewId: sent.reviewId }
              : { postId: sent.id, postReviewId: sent.reviewId }),
          };
        }),
      );
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'approval_request.created',
        entityType: 'approval_request',
        entityId: request.id,
        after: {
          clientId: client.id,
          contactId: input.contactId,
          taskIds,
          ...(postIds.length > 0 && { postIds }),
          expiresAt: link.expiresAt.toISOString(),
        },
      });
      return request.id;
    });
    return { ...(await this.detail(actor, id)), link: this.linkOf(link.token) };
  }

  /** Rule 11: a new token and seven more days; the old link stops working. */
  async reissue(actor: CurrentUserInfo, id: string): Promise<IssuedApprovalRequest> {
    const link = issueLink();
    await this.db.transaction(async (tx) => {
      const request = await this.liveRequest(tx, actor, id, { clientArchived: 'refuse' });
      await this.assertApprover(tx, request.client, request.contactId);
      await tx
        .update(approvalRequests)
        .set({
          tokenHash: link.tokenHash,
          linkIssuedAt: link.linkIssuedAt,
          expiresAt: link.expiresAt,
          remindedAt: null,
          expiryNotifiedAt: null,
        })
        .where(eq(approvalRequests.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'approval_request.link_reissued',
        entityType: 'approval_request',
        entityId: id,
        before: { expiresAt: request.expiresAt.toISOString() },
        after: { expiresAt: link.expiresAt.toISOString() },
      });
    });
    return { ...(await this.detail(actor, id)), link: this.linkOf(link.token) };
  }

  /**
   * Rule 12: the link stops working and its pending items are withdrawn; the tasks and posts
   * stay ready.
   */
  async revoke(actor: CurrentUserInfo, id: string): Promise<ApprovalRequestDetail> {
    await this.db.transaction(async (tx) => {
      await this.liveRequest(tx, actor, id, { clientArchived: 'allow' });
      const now = new Date();
      await tx
        .update(approvalRequests)
        .set({ revokedAt: now, revokedById: actor.id })
        .where(eq(approvalRequests.id, id));
      const withdrawn = await tx
        .update(approvalItems)
        .set({ status: 'withdrawn', withdrawnReason: 'revoked', closedAt: now })
        .where(and(eq(approvalItems.requestId, id), eq(approvalItems.status, 'pending')))
        .returning({ taskId: approvalItems.taskId, postId: approvalItems.postId });
      const postIds = withdrawn.flatMap((item) => item.postId ?? []);
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'approval_request.revoked',
        entityType: 'approval_request',
        entityId: id,
        after: {
          revoked: true,
          taskIds: withdrawn.flatMap((item) => item.taskId ?? []),
          ...(postIds.length > 0 && { postIds }),
        },
      });
    });
    return this.detail(actor, id);
  }

  private linkOf(token: string): string {
    return new URL(`/a/${token}`, this.env.APP_URL).href;
  }

  /** The client of a request the actor may send for: 404, 403, then `CLIENT_ARCHIVED`. */
  private async scopedClient(
    tx: Transaction,
    actor: CurrentUserInfo,
    clientId: string,
  ): Promise<ClientSummary> {
    const client = await this.clients.summary(clientId, tx);
    if (!client) throw new NotFoundException();
    if (!this.tasks.hasClientScope(actor, client)) throw new ForbiddenException();
    if (client.archived) {
      throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
    }
    return client;
  }

  /** Rule 9: a non-archived contact of the client with final-approval authority. */
  private async assertApprover(
    tx: Transaction,
    client: ClientSummary,
    contactId: string,
  ): Promise<void> {
    const contact = (await this.clients.contacts([contactId], tx)).get(contactId);
    if (!contact?.hasFinalApproval || contact.archived || contact.clientId !== client.id) {
      throw new CodedException(
        409,
        'CONTACT_NOT_APPROVER',
        'The contact is not a contact of the client with final-approval authority',
      );
    }
  }

  /**
   * Locks a request the actor may reissue or revoke: 404, 403 without client scope, then
   * `REQUEST_CLOSED` unless it is open or expired.
   */
  private async liveRequest(
    tx: Transaction,
    actor: CurrentUserInfo,
    id: string,
    options: { clientArchived: 'refuse' | 'allow' },
  ): Promise<RequestRow & { client: ClientSummary }> {
    const request = await lockRequest(tx, id);
    const client = request ? await this.clients.summary(request.clientId, tx) : null;
    if (!request || !client || (client.archived && !holdsAll(actor))) {
      throw new NotFoundException();
    }
    if (!this.tasks.hasClientScope(actor, client)) throw new ForbiddenException();
    const state = approvalRequestState(request);
    if (state === 'revoked' || state === 'completed') {
      throw new CodedException(409, 'REQUEST_CLOSED', `The request is ${state}`);
    }
    if (client.archived && options.clientArchived === 'refuse') {
      throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
    }
    return { ...request, client };
  }

  /**
   * Rule 8, for tasks and posts the caller locked: a pending item in an open request refuses the
   * task or the post (`TASK_NOT_READY`, `POST_NOT_READY`); one in an expired request is withdrawn
   * (`resent`).
   */
  private async withdrawExpired(
    tx: Transaction,
    actor: AuditActor,
    taskIds: string[],
    postIds: string[],
  ): Promise<void> {
    const pendingOf = and(
      or(
        taskIds.length > 0 ? inArray(approvalItems.taskId, taskIds) : undefined,
        postIds.length > 0 ? inArray(approvalItems.postId, postIds) : undefined,
      ),
      eq(approvalItems.status, 'pending'),
    );
    const held = await tx
      .selectDistinct({ requestId: approvalItems.requestId })
      .from(approvalItems)
      .where(pendingOf);
    if (held.length === 0) return;
    const requests = await tx
      .select()
      .from(approvalRequests)
      .where(
        inArray(
          approvalRequests.id,
          held.map((row) => row.requestId),
        ),
      )
      .orderBy(asc(approvalRequests.id))
      .for('update');
    const states = new Map(requests.map((request) => [request.id, approvalRequestState(request)]));
    // Read again under the locks: a response or a revoke may have closed some since.
    const items = await tx.select().from(approvalItems).where(pendingOf).orderBy(approvalItems.id);
    for (const item of items) {
      if (states.get(item.requestId) !== 'expired') {
        throw item.postId
          ? new CodedException(409, 'POST_NOT_READY', 'A post already waits on a link', {
              postId: item.postId,
            })
          : new CodedException(409, 'TASK_NOT_READY', 'A task already waits on a link', {
              taskId: item.taskId,
            });
      }
      await closeItem(tx, item, { withdrawn: 'resent' }, actor);
    }
  }

  /**
   * The pending item of each task or post that has one, for `tasks` (`ClientReviewHooks`) and
   * `content` (`PostReviewHooks`).
   */
  private async pending(
    subject: SubjectColumn,
    ids: string[],
    executor: Executor,
  ): Promise<Map<string, PendingApproval>> {
    const rows = await executor
      .select({ itemId: approvalItems.id, subjectId: subject, request: approvalRequests })
      .from(approvalItems)
      .innerJoin(approvalRequests, eq(approvalRequests.id, approvalItems.requestId))
      .where(and(inArray(subject, ids), eq(approvalItems.status, 'pending')));
    return new Map(
      rows.map(({ itemId, subjectId, request }) => [
        subjectId as string,
        {
          itemId,
          requestId: request.id,
          state: approvalRequestState(request),
          issuedAt: request.linkIssuedAt,
          expiresAt: request.expiresAt,
        },
      ]),
    );
  }

  /**
   * Rules 16 and 17, and F08 rules 24 and 25: a task or a post left `awaiting_client` in `tx`.
   * Its pending item closes with the response recorded by hand, or is withdrawn (`task_moved`,
   * `post_moved`).
   */
  private async left(
    tx: Transaction,
    subject: SubjectColumn,
    id: string,
    exit: ClientExit,
    moved: ApprovalWithdrawnReason,
  ): Promise<void> {
    const pendingOf = and(eq(subject, id), eq(approvalItems.status, 'pending'));
    const [held] = await tx
      .select({ requestId: approvalItems.requestId })
      .from(approvalItems)
      .where(pendingOf);
    if (!held) return;
    await lockRequest(tx, held.requestId);
    const [item] = await tx.select().from(approvalItems).where(pendingOf).for('update');
    if (!item) return;
    await closeItem(
      tx,
      item,
      exit.response
        ? { decision: exit.response.decision, responseId: exit.response.id, via: 'manual' }
        : { withdrawn: moved },
      exit.actor,
    );
  }

  /** One page of requests, newest first; those of archived clients for scope-all holders only. */
  private async page(
    actor: CurrentUserInfo,
    query: PageQuery,
    now: Date,
    filters: (SQL | undefined)[],
  ): Promise<ApprovalRequestPage> {
    const where = and(
      holdsAll(actor) ? undefined : this.clients.isLive(approvalRequests.clientId),
      ...filters,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(approvalRequests)
        .where(where)
        .orderBy(desc(approvalRequests.createdAt), desc(approvalRequests.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(approvalRequests).where(where),
    ]);
    return {
      items: await this.present(rows, now),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** List items for request rows, with their people and item counts. */
  private async present(rows: RequestRow[], now: Date): Promise<ApprovalRequest[]> {
    if (rows.length === 0) return [];
    const [clients, contacts, people, counts] = await Promise.all([
      this.clients.summaries(rows.map((row) => row.clientId)),
      this.clients.contactSummaries(rows.map((row) => row.contactId)),
      this.users.summaries(rows.map((row) => row.createdById)),
      this.db
        .select({
          requestId: approvalItems.requestId,
          status: approvalItems.status,
          value: count(),
        })
        .from(approvalItems)
        .where(
          inArray(
            approvalItems.requestId,
            rows.map((row) => row.id),
          ),
        )
        .groupBy(approvalItems.requestId, approvalItems.status),
    ]);
    return rows.map((row) => {
      const own = counts.filter((entry) => entry.requestId === row.id);
      const of = (status: (typeof own)[number]['status']) =>
        own.find((entry) => entry.status === status)?.value ?? 0;
      return {
        id: row.id,
        client: { id: row.clientId, name: clients.get(row.clientId)?.name ?? '' },
        contact: contacts.get(row.contactId) ?? { id: row.contactId, name: '', archived: true },
        state: approvalRequestState(row, now),
        items: {
          total: own.reduce((sum, entry) => sum + entry.value, 0),
          approved: of('approved'),
          changesRequested: of('changes_requested'),
          pending: of('pending'),
        },
        issuedAt: row.linkIssuedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        remindedAt: row.remindedAt?.toISOString() ?? null,
        createdBy: { id: row.createdById, name: people.get(row.createdById)?.name ?? '' },
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}

/** A column qualified by hand: Drizzle leaves columns unqualified in single-table selects. */
const qualified = (column: PgColumn) =>
  sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;

/**
 * SQL: `column` holds a task or a post (the `subject` column of the items) whose pending item is
 * in a request still open (rule 8). Every column is qualified, because the subquery joins two
 * tables inside another table's select.
 */
function waitingSql(column: PgColumn, subject: SubjectColumn): SQL {
  const q = qualified;
  return sql`${q(column)} in (select ${q(subject)} from ${approvalItems}
    inner join ${approvalRequests} on ${q(approvalRequests.id)} = ${q(approvalItems.requestId)}
    where ${q(approvalItems.status)} = 'pending'
      and ${q(approvalRequests.revokedAt)} is null
      and ${q(approvalRequests.completedAt)} is null
      and ${q(approvalRequests.expiresAt)} > now())`;
}
