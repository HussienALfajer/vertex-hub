import { createHash, randomBytes } from 'node:crypto';
import {
  APPROVAL_LIMITS,
  type ApprovalRequestState,
  type ApprovalWithdrawnReason,
  type ClientDecision,
} from '@vertex-hub/contracts';
import { approvalItems, approvalRequests, type Transaction } from '@vertex-hub/db';
import { and, eq, gt, isNotNull, isNull, lte, type SQL, sql } from 'drizzle-orm';
import { type AuditActor, recordAudit } from '../audit/index.js';

/*
 * What every path that changes an approval request shares (spec F09 rules 8–17): the link's
 * token, the state as SQL, and closing an item. Lock order everywhere: tasks, then the request,
 * then its items.
 */

export type RequestRow = typeof approvalRequests.$inferSelect;
export type ItemRow = typeof approvalItems.$inferSelect;

/** SHA-256 of a token: all that is stored of a link (ADR 0002). */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** A new link: 32 random bytes, valid `APPROVAL_LIMITS.linkDays` days from `now` (rule 9). */
export function issueLink(now: Date = new Date()) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + APPROVAL_LIMITS.linkDays * 24 * 60 * 60 * 1000);
  return { token, tokenHash: hashToken(token), linkIssuedAt: now, expiresAt };
}

/** SQL over a row of `approval_requests`: `approvalRequestState` of the contracts. */
export function stateSql(state: ApprovalRequestState, now: Date): SQL {
  const live = and(isNull(approvalRequests.revokedAt), isNull(approvalRequests.completedAt));
  switch (state) {
    case 'revoked':
      return isNotNull(approvalRequests.revokedAt);
    case 'completed':
      return and(
        isNull(approvalRequests.revokedAt),
        isNotNull(approvalRequests.completedAt),
      ) as SQL;
    case 'expired':
      return and(live, lte(approvalRequests.expiresAt, now)) as SQL;
    case 'open':
      return and(live, gt(approvalRequests.expiresAt, now)) as SQL;
  }
}

/** Locks the request row until the transaction ends; null when it does not exist. */
export async function lockRequest(tx: Transaction, id: string): Promise<RequestRow | null> {
  const [request] = await tx
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, id))
    .for('update');
  return request ?? null;
}

/** How a pending item ends: a decision with its response, or withdrawn with a reason. */
export type ItemOutcome =
  | { decision: ClientDecision; responseId: string; via: 'approval_link' | 'manual' }
  | { withdrawn: ApprovalWithdrawnReason };

/**
 * Closes a pending item and audits it on its request; the request completes when this was its
 * last pending item (rule 15). The caller holds the request's lock. `actorName` names the
 * contact when no user acts (a response through the link).
 */
export async function closeItem(
  tx: Transaction,
  item: Pick<ItemRow, 'id' | 'requestId' | 'taskId'>,
  outcome: ItemOutcome,
  actor: AuditActor | null,
  actorName?: string,
): Promise<Date> {
  const closedAt = new Date();
  const decided = 'decision' in outcome;
  await tx
    .update(approvalItems)
    .set(
      decided
        ? { status: outcome.decision, responseId: outcome.responseId, closedAt }
        : { status: 'withdrawn', withdrawnReason: outcome.withdrawn, closedAt },
    )
    .where(eq(approvalItems.id, item.id));
  await recordAudit(tx, {
    actor,
    actorName,
    action: decided ? 'approval_item.responded' : 'approval_item.withdrawn',
    entityType: 'approval_request',
    entityId: item.requestId,
    after: {
      itemId: item.id,
      taskId: item.taskId,
      ...(decided
        ? { decision: outcome.decision, via: outcome.via }
        : { reason: outcome.withdrawn }),
    },
  });
  await tx
    .update(approvalRequests)
    .set({ completedAt: closedAt })
    .where(
      and(
        eq(approvalRequests.id, item.requestId),
        isNull(approvalRequests.completedAt),
        isNull(approvalRequests.revokedAt),
        sql`not exists (select 1 from ${approvalItems}
          where ${approvalItems.requestId} = ${item.requestId}
            and ${approvalItems.status} = 'pending')`,
      ),
    );
  return closedAt;
}
