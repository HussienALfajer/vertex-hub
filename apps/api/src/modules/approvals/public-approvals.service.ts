import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type ClientDecision,
  fileTypeOf,
  isInlineMimeType,
  type PublicApproval,
  type PublicApprovalFile,
  type PublicApprovalItem,
  type PublicApprovalItems,
  type PublicApproveAll,
  type PublicResponse,
} from '@vertex-hub/contracts';
import { approvalItems, approvalRequests, type Database, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary, type ContactDetail } from '../clients/index.js';
import { PostApprovals } from '../content/index.js';
import { FileVersions, type PreviewSize, type SentVersion } from '../files/index.js';
import { TaskApprovals } from '../tasks/index.js';
import {
  closeItem,
  hashToken,
  type ItemRow,
  type RequestRow,
  shownPost,
} from './approval-items.js';
import { ApprovalNotices } from './approval-notices.js';

type Executor = Database | Transaction;

/** A base64url token of 32 bytes is 43 characters; anything far from it is not a link. */
const TOKEN_MAX = 100;

/** A link that works, with the records its page shows. */
interface OpenLink {
  request: RequestRow;
  client: ClientSummary;
  contact: ContactDetail;
}

/** What is kept of the browser that answered (rule 23). */
export interface ResponseEvidence {
  ip: string | null;
  userAgent: string | null;
}

/** The client's answer on one item. */
interface Decision {
  decision: ClientDecision;
  note: string | null;
}

const toFile = (version: SentVersion): PublicApprovalFile => ({
  versionId: version.id,
  kind: version.kind,
  name: version.name,
  type: fileTypeOf(version.kind, version.mimeType),
  sizeBytes: version.sizeBytes,
  display:
    version.kind === 'link' ? 'link' : isInlineMimeType(version.mimeType) ? 'inline' : 'download',
  previewAvailable: version.previewStatus === 'ready',
  linkUrl: version.url,
  linkLabel: version.linkLabel,
});

/**
 * The client page (spec F09 rules 13–15 and 20–23, ADR 0020; F08 rules 22, 23 and 27): what the
 * holder of an approval link sees, the decisions they send on tasks and posts, and the files of
 * the snapshots. No session: the token is the only access, compared by its hash.
 */
@Injectable()
export class PublicApprovalsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly files: FileVersions,
    private readonly tasks: TaskApprovals,
    private readonly posts: PostApprovals,
    private readonly notices: ApprovalNotices,
  ) {}

  async page(token: string): Promise<PublicApproval> {
    const { request, client, contact } = await this.open(this.db, token);
    const [items, people] = await Promise.all([
      this.db
        .select()
        .from(approvalItems)
        .where(eq(approvalItems.requestId, request.id))
        .orderBy(asc(approvalItems.position)),
      this.users.summaries([client.accountManagerId]),
    ]);
    const shown = await this.present(items);
    // F08 rule 27: task items by position, then the content plan in publish order; a post
    // item the agency withdrew shows no date and comes last.
    const publishKey = (item: PublicApprovalItem) =>
      item.post ? `${item.post.publishDate} ${item.post.publishTime ?? '99'}` : '9';
    return {
      clientName: client.name,
      contactName: contact.name,
      accountManagerName: people.get(client.accountManagerId)?.name ?? '',
      message: request.message,
      expiresAt: request.expiresAt.toISOString(),
      items: [
        ...shown.filter((item) => item.kind === 'task'),
        ...shown
          .filter((item) => item.kind === 'post')
          .sort((a, b) => publishKey(a).localeCompare(publishKey(b))),
      ],
    };
  }

  /**
   * Rules 13–15: one decision per item, final. The task or the post moves, the response is
   * recorded and the item closes in one transaction; a second answer finds the item decided.
   */
  async respond(
    token: string,
    itemId: string,
    input: PublicResponse,
    evidence: ResponseEvidence,
  ): Promise<PublicApprovalItem> {
    await this.db.transaction(async (tx) => {
      const link = await this.open(tx, token);
      const itemOf = and(
        eq(approvalItems.id, itemId),
        eq(approvalItems.requestId, link.request.id),
      );
      const [found] = await tx
        .select({ taskId: approvalItems.taskId, postId: approvalItems.postId })
        .from(approvalItems)
        .where(itemOf);
      if (!found) throw new NotFoundException();
      // The post or the task, then the request, then the item: the order of a response
      // recorded by hand.
      if (found.postId) await this.posts.lock(tx, [found.postId]);
      if (found.taskId) await this.tasks.lock(tx, [found.taskId]);
      const { request, contact } = await this.open(tx, token, { forUpdate: true });
      const [item] = await tx.select().from(approvalItems).where(itemOf).for('update');
      if (!item) throw new NotFoundException();
      if (item.status === 'withdrawn') {
        throw new CodedException(409, 'ITEM_WITHDRAWN', 'The agency withdrew this item');
      }
      if (item.status !== 'pending') {
        throw new CodedException(409, 'ITEM_ALREADY_DECIDED', 'This item already has a decision');
      }
      await this.decide(
        tx,
        request,
        contact,
        item,
        { decision: input.decision, note: input.note ?? null },
        evidence,
      );
    });
    const [presented] = await this.presentIds([itemId]);
    if (!presented) throw new NotFoundException();
    return presented;
  }

  /**
   * F08 rule 23: approves every pending post item of the link in one transaction, one response
   * per post with the same optional note; task items are never included.
   */
  async approveAll(
    token: string,
    input: PublicApproveAll,
    evidence: ResponseEvidence,
  ): Promise<PublicApprovalItems> {
    const approved = await this.db.transaction(async (tx) => {
      const link = await this.open(tx, token);
      const pendingPosts = and(
        eq(approvalItems.requestId, link.request.id),
        eq(approvalItems.status, 'pending'),
        isNotNull(approvalItems.postId),
      );
      const found = await tx
        .select({ postId: approvalItems.postId })
        .from(approvalItems)
        .where(pendingPosts);
      // The posts, then the request, then its items.
      await this.posts.lock(
        tx,
        found.flatMap((item) => item.postId ?? []),
      );
      const { request, contact } = await this.open(tx, token, { forUpdate: true });
      // Read again under the locks: a response or a withdrawal may have closed some since.
      const items = await tx
        .select()
        .from(approvalItems)
        .where(pendingPosts)
        .orderBy(asc(approvalItems.position))
        .for('update');
      for (const item of items) {
        await this.decide(
          tx,
          request,
          contact,
          item,
          { decision: 'approved', note: input.note ?? null },
          evidence,
        );
      }
      return items.map((item) => item.id);
    });
    return { items: await this.presentIds(approved) };
  }

  /**
   * Rule 22: the bytes of a version, only when it belongs to a snapshot the link still shows
   * (items the agency withdrew show nothing).
   */
  async serve(
    token: string,
    versionId: string,
    part: 'content' | PreviewSize,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const link = await this.open(this.db, token);
    const items = await this.db
      .select({ reviewId: approvalItems.reviewId, postReviewId: approvalItems.postReviewId })
      .from(approvalItems)
      .where(
        and(eq(approvalItems.requestId, link.request.id), ne(approvalItems.status, 'withdrawn')),
      );
    const [snapshots, postSnapshots] = await Promise.all([
      this.tasks.snapshots(items.flatMap((item) => item.reviewId ?? [])),
      this.posts.snapshots(items.flatMap((item) => item.postReviewId ?? [])),
    ]);
    const shown = [...snapshots.values(), ...postSnapshots.values()];
    if (!shown.some((snapshot) => snapshot.versionIds.includes(versionId))) {
      throw new NotFoundException();
    }
    await this.files.serveSent(versionId, part, request, response);
  }

  /**
   * Records the decision on a pending item the caller locked, after its post or task and its
   * request: the post or the task moves, the item closes and the agency is told.
   */
  private async decide(
    tx: Transaction,
    request: RequestRow,
    contact: ContactDetail,
    item: ItemRow,
    { decision, note }: Decision,
    evidence: ResponseEvidence,
  ): Promise<void> {
    const answer = {
      itemId: item.id,
      decision,
      note,
      contact: { id: contact.id, name: contact.name },
      ...evidence,
    };
    let response: { id: string };
    if (item.postId && item.postReviewId) {
      response = await this.posts.recordLink(tx, {
        ...answer,
        postId: item.postId,
        reviewId: item.postReviewId,
      });
    } else if (item.taskId && item.reviewId) {
      response = await this.tasks.recordLink(tx, {
        ...answer,
        taskId: item.taskId,
        reviewId: item.reviewId,
      });
    } else {
      throw new Error(`Approval item ${item.id} sends neither a task nor a post`);
    }
    await closeItem(
      tx,
      item,
      { decision, responseId: response.id, via: 'approval_link' },
      null,
      contact.name,
    );
    await this.notices.send(tx, request, { type: 'approval_responded', decision });
  }

  /**
   * Rule 20: the request of a token whose link works. Unknown, revoked, or with a client or
   * contact no longer valid: `APPROVAL_LINK_INVALID`, never saying which; past its expiry:
   * `APPROVAL_LINK_EXPIRED`.
   */
  private async open(
    executor: Executor,
    token: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<OpenLink> {
    const invalid = () =>
      new CodedException(404, 'APPROVAL_LINK_INVALID', 'This link is not valid');
    if (token.length > TOKEN_MAX) throw invalid();
    const query = executor
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.tokenHash, hashToken(token)));
    const [request] = options.forUpdate ? await query.for('update') : await query;
    if (!request || request.revokedAt) throw invalid();
    const [client, contacts] = await Promise.all([
      this.clients.summary(request.clientId, executor),
      this.clients.contacts([request.contactId], executor),
    ]);
    const contact = contacts.get(request.contactId);
    if (!client || client.archived) throw invalid();
    if (!contact || contact.archived || !contact.hasFinalApproval) throw invalid();
    if (Date.now() >= request.expiresAt.getTime()) {
      throw new CodedException(410, 'APPROVAL_LINK_EXPIRED', 'This link has expired');
    }
    return { request, client, contact };
  }

  /** The given items as the client sees them, by position. */
  private async presentIds(ids: string[]): Promise<PublicApprovalItem[]> {
    if (ids.length === 0) return [];
    return this.present(
      await this.db
        .select()
        .from(approvalItems)
        .where(inArray(approvalItems.id, ids))
        .orderBy(asc(approvalItems.position)),
    );
  }

  /**
   * Rule 21 and F08 rule 27: the items as the client sees them; a withdrawn item shows neither
   * files nor text. A task's files are by name, a post's media in its display order.
   */
  private async present(items: ItemRow[]): Promise<PublicApprovalItem[]> {
    const shown = items.filter((item) => item.status !== 'withdrawn');
    const [snapshots, responses, postSnapshots, postResponses] = await Promise.all([
      this.tasks.snapshots(shown.flatMap((item) => item.reviewId ?? [])),
      this.tasks.responses(items.flatMap((item) => item.responseId ?? [])),
      this.posts.snapshots(shown.flatMap((item) => item.postReviewId ?? [])),
      this.posts.responses(items.flatMap((item) => item.postResponseId ?? [])),
    ]);
    const versions = await this.files.sent(
      [...snapshots.values(), ...postSnapshots.values()].flatMap((snapshot) => snapshot.versionIds),
    );
    const sent = (versionIds: string[]) =>
      versionIds.flatMap((id) => versions.get(id) ?? []).filter((version) => !version.removed);
    return items.map((item) => {
      const withdrawn = item.status === 'withdrawn';
      const snapshot = !withdrawn && item.reviewId ? snapshots.get(item.reviewId) : undefined;
      const postSnapshot =
        !withdrawn && item.postReviewId ? postSnapshots.get(item.postReviewId) : undefined;
      const response = item.postId
        ? postResponses.get(item.postResponseId ?? '')
        : responses.get(item.responseId ?? '');
      return {
        id: item.id,
        kind: item.postId ? 'post' : 'task',
        title: item.title,
        text: snapshot?.clientText ?? null,
        post: postSnapshot ? shownPost(postSnapshot) : null,
        files: item.postId
          ? // F08 rule 27: the client never sees the internal titles of a post's files.
            sent(postSnapshot?.versionIds ?? []).map((version) => ({
              ...toFile(version),
              name: '',
            }))
          : sent(snapshot?.versionIds ?? [])
              .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
              .map(toFile),
        status: item.status,
        note: response?.note ?? null,
        decidedAt: response?.createdAt.toISOString() ?? null,
        recordedByAgency: response?.channel === 'manual',
      };
    });
  }
}
