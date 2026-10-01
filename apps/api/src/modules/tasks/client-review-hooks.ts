import { Injectable } from '@nestjs/common';
import type { ApprovalRequestState, ClientDecision } from '@vertex-hub/contracts';
import type { Database, Transaction } from '@vertex-hub/db';
import { type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { AuditActor } from '../audit/index.js';

type Executor = Database | Transaction;

/** The approval request that holds a task's pending item. */
export interface PendingApproval {
  requestId: string;
  state: ApprovalRequestState;
  issuedAt: Date;
  expiresAt: Date;
}

/** A task leaving `awaiting_client` by a path other than a response through its link. */
export interface ClientReviewExit {
  taskId: string;
  actor: AuditActor | null;
  /** The response recorded by hand that closes the pending item (rule 16); null otherwise. */
  response: { id: string; decision: ClientDecision } | null;
}

/** What the module that owns approval requests tells and hears about tasks sent to the client. */
export interface ClientReviewSource {
  /** The pending item of each task that has one. */
  pending(taskIds: string[], executor: Executor): Promise<Map<string, PendingApproval>>;
  /** SQL: `column` holds a task whose pending item is in a request still open (rule 8). */
  waitingSql(column: PgColumn): SQL;
  /** Rule 17: called in the transaction that moves the task, so its pending item follows. */
  left(tx: Transaction, exit: ClientReviewExit): Promise<void>;
}

/**
 * Lets the `approvals` module follow tasks sent to the client without `tasks` importing it
 * (spec F09, "Data"; ADR 0020). Until a source registers, no task has a pending item.
 */
@Injectable()
export class ClientReviewHooks {
  private source: ClientReviewSource | undefined;

  register(source: ClientReviewSource): void {
    this.source = source;
  }

  async pending(taskIds: string[], executor: Executor): Promise<Map<string, PendingApproval>> {
    return taskIds.length && this.source ? this.source.pending(taskIds, executor) : new Map();
  }

  waitingSql(column: PgColumn): SQL {
    return this.source ? this.source.waitingSql(column) : sql`false`;
  }

  async left(tx: Transaction, exit: ClientReviewExit): Promise<void> {
    await this.source?.left(tx, exit);
  }
}
