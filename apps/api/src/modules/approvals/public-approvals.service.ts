import type { IncomingMessage, ServerResponse } from 'node:http';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  fileTypeOf,
  isInlineMimeType,
  type PublicApproval,
  type PublicApprovalFile,
  type PublicApprovalItem,
  type PublicResponse,
} from '@vertex-hub/contracts';
import { approvalItems, approvalRequests, type Database, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, ne } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary, type ContactDetail } from '../clients/index.js';
import { FileVersions, type PreviewSize } from '../files/index.js';
import { type ResponseSummary, TaskApprovals } from '../tasks/index.js';
import { closeItem, hashToken, type ItemRow, type RequestRow } from './approval-items.js';
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

/**
 * The client page (spec F09 rules 13–15 and 20–23, ADR 0020): what the holder of an approval
 * link sees, the decisions they send and the files of the snapshots. No session: the token is
 * the only access, compared by its hash.
 */
@Injectable()
export class PublicApprovalsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly files: FileVersions,
    private readonly tasks: TaskApprovals,
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
    return {
      clientName: client.name,
      contactName: contact.name,
      accountManagerName: people.get(client.accountManagerId)?.name ?? '',
      message: request.message,
      expiresAt: request.expiresAt.toISOString(),
      items: await this.present(items),
    };
  }

  /**
   * Rules 13–15: one decision per item, final. The task moves, the response is recorded and the
   * item closes in one transaction; a second answer finds the item decided.
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
        .select({ taskId: approvalItems.taskId })
        .from(approvalItems)
        .where(itemOf);
      if (!found) throw new NotFoundException();
      // Tasks, then the request, then the item: the order of a response recorded by hand.
      await this.tasks.lock(tx, [found.taskId]);
      const { request, contact } = await this.open(tx, token, { forUpdate: true });
      const [item] = await tx.select().from(approvalItems).where(itemOf).for('update');
      if (!item) throw new NotFoundException();
      if (item.status === 'withdrawn') {
        throw new CodedException(409, 'ITEM_WITHDRAWN', 'The agency withdrew this item');
      }
      if (item.status !== 'pending') {
        throw new CodedException(409, 'ITEM_ALREADY_DECIDED', 'This item already has a decision');
      }
      const response = await this.tasks.recordLink(tx, {
        taskId: item.taskId,
        itemId: item.id,
        reviewId: item.reviewId,
        decision: input.decision,
        note: input.note ?? null,
        contact: { id: contact.id, name: contact.name },
        ...evidence,
      });
      await closeItem(
        tx,
        item,
        { decision: input.decision, responseId: response.id, via: 'approval_link' },
        null,
        contact.name,
      );
      await this.notices.send(tx, request, {
        type: 'approval_responded',
        decision: input.decision,
      });
    });
    const [item] = await this.db.select().from(approvalItems).where(eq(approvalItems.id, itemId));
    const [presented] = item ? await this.present([item]) : [];
    if (!presented) throw new NotFoundException();
    return presented;
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
      .select({ reviewId: approvalItems.reviewId })
      .from(approvalItems)
      .where(
        and(eq(approvalItems.requestId, link.request.id), ne(approvalItems.status, 'withdrawn')),
      );
    const snapshots = await this.tasks.snapshots(items.map((item) => item.reviewId));
    if (![...snapshots.values()].some((snapshot) => snapshot.versionIds.includes(versionId))) {
      throw new NotFoundException();
    }
    await this.files.serveSent(versionId, part, request, response);
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

  /** Rule 21: the items as the client sees them; a withdrawn item shows neither files nor text. */
  private async present(items: ItemRow[]): Promise<PublicApprovalItem[]> {
    const shown = items.filter((item) => item.status !== 'withdrawn');
    const [snapshots, responses] = await Promise.all([
      this.tasks.snapshots(shown.map((item) => item.reviewId)),
      this.tasks.responses(items.flatMap((item) => (item.responseId ? [item.responseId] : []))),
    ]);
    const versions = await this.files.sent(
      [...snapshots.values()].flatMap((snapshot) => snapshot.versionIds),
    );
    return items.map((item) => {
      const snapshot = item.status === 'withdrawn' ? undefined : snapshots.get(item.reviewId);
      const response: ResponseSummary | undefined = item.responseId
        ? responses.get(item.responseId)
        : undefined;
      return {
        id: item.id,
        title: item.title,
        text: snapshot?.clientText ?? null,
        files: (snapshot?.versionIds ?? [])
          .flatMap((id) => versions.get(id) ?? [])
          .filter((version) => !version.removed)
          .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
          .map(
            (version): PublicApprovalFile => ({
              versionId: version.id,
              kind: version.kind,
              name: version.name,
              type: fileTypeOf(version.kind, version.mimeType),
              sizeBytes: version.sizeBytes,
              display:
                version.kind === 'link'
                  ? 'link'
                  : isInlineMimeType(version.mimeType)
                    ? 'inline'
                    : 'download',
              previewAvailable: version.previewStatus === 'ready',
              linkUrl: version.url,
              linkLabel: version.linkLabel,
            }),
          ),
        status: item.status,
        note: response?.note ?? null,
        decidedAt: response?.createdAt.toISOString() ?? null,
        recordedByAgency: response?.channel === 'manual',
      };
    });
  }
}
