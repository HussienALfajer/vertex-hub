import { Inject, Injectable } from '@nestjs/common';
import { APPROVAL_WAITING_HOURS, type ReportClients } from '@vertex-hub/contracts';
import { approvalItems, approvalRequests, type Database } from '@vertex-hub/db';
import { and, asc, count, eq, inArray, isNull, lt, min } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { ClientDirectory } from '../clients/index.js';

/** The oldest item waiting on the client (F15 rule 1). */
export interface WaitingApproval {
  itemId: string;
  title: string;
  clientId: string;
  sentAt: Date;
  expired: boolean;
}

/**
 * Read-only approval figures for dashboards and reports (F15, ADR 0027): pending items of requests
 * that are not revoked, for non-archived clients. Callers check the scope.
 */
@Injectable()
export class ApprovalReports {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
  ) {}

  /** Rule 1: pending items whose link was issued more than 48 hours ago (expired ones included). */
  async waiting(
    now: Date = new Date(),
  ): Promise<{ count: number; oldest: WaitingApproval | null }> {
    const since = new Date(now.getTime() - APPROVAL_WAITING_HOURS * 3_600_000);
    const where = and(this.pending('all'), lt(approvalRequests.linkIssuedAt, since));
    const [[total], [oldest]] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(approvalItems)
        .innerJoin(approvalRequests, eq(approvalRequests.id, approvalItems.requestId))
        .where(where),
      this.db
        .select({
          itemId: approvalItems.id,
          title: approvalItems.title,
          clientId: approvalRequests.clientId,
          sentAt: approvalRequests.linkIssuedAt,
          expiresAt: approvalRequests.expiresAt,
        })
        .from(approvalItems)
        .innerJoin(approvalRequests, eq(approvalRequests.id, approvalItems.requestId))
        .where(where)
        .orderBy(asc(approvalRequests.linkIssuedAt), asc(approvalItems.position))
        .limit(1),
    ]);
    return {
      count: total?.value ?? 0,
      oldest: oldest
        ? {
            itemId: oldest.itemId,
            title: oldest.title,
            clientId: oldest.clientId,
            sentAt: oldest.sentAt,
            expired: oldest.expiresAt.getTime() <= now.getTime(),
          }
        : null,
    };
  }

  /** Rule 4: per client, the items pending the client and when the oldest was sent. */
  async pendingByClient(
    clientIds: readonly string[],
  ): Promise<Map<string, { pending: number; oldestSentAt: Date }>> {
    if (clientIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        clientId: approvalRequests.clientId,
        pending: count(),
        oldestSentAt: min(approvalRequests.linkIssuedAt),
      })
      .from(approvalItems)
      .innerJoin(approvalRequests, eq(approvalRequests.id, approvalItems.requestId))
      .where(this.pending(clientIds))
      .groupBy(approvalRequests.clientId);
    return new Map(
      rows.flatMap((row) =>
        row.oldestSentAt
          ? [[row.clientId, { pending: row.pending, oldestSentAt: row.oldestSentAt }]]
          : [],
      ),
    );
  }

  private pending(clients: ReportClients) {
    return and(
      eq(approvalItems.status, 'pending'),
      isNull(approvalRequests.revokedAt),
      this.clients.isLive(approvalRequests.clientId),
      clients === 'all' ? undefined : inArray(approvalRequests.clientId, [...clients]),
    );
  }
}
