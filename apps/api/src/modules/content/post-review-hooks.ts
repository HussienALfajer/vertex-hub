import { Injectable } from '@nestjs/common';
import type { ClientDecision } from '@vertex-hub/contracts';
import type { Database, Transaction } from '@vertex-hub/db';
import { type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { AuditActor } from '../audit/index.js';
import type { PendingApproval } from '../tasks/index.js';

type Executor = Database | Transaction;

/** A post leaving `awaiting_client` by a path other than a response through its link. */
export interface PostReviewExit {
  postId: string;
  actor: AuditActor | null;
  /** The response recorded by hand that closes the pending item (rule 24); null otherwise. */
  response: { id: string; decision: ClientDecision } | null;
}

/** What the module that owns approval requests tells and hears about posts sent to the client. */
export interface PostReviewSource {
  /** The pending item of each post that has one. */
  pending(postIds: string[], executor: Executor): Promise<Map<string, PendingApproval>>;
  /** SQL: `column` holds a post whose pending item is in a request still open (rule 20). */
  waitingSql(column: PgColumn): SQL;
  /** Rule 25: called in the transaction that moves the post, so its pending item follows. */
  left(tx: Transaction, exit: PostReviewExit): Promise<void>;
}

/**
 * Lets the `approvals` module follow posts sent to the client without `content` importing it
 * (spec F08, "Data"; ADR 0021), as `tasks`' `ClientReviewHooks` does for tasks. Until a source
 * registers, no post has a pending item.
 */
@Injectable()
export class PostReviewHooks {
  private source: PostReviewSource | undefined;

  register(source: PostReviewSource): void {
    this.source = source;
  }

  async pending(postIds: string[], executor: Executor): Promise<Map<string, PendingApproval>> {
    return postIds.length && this.source ? this.source.pending(postIds, executor) : new Map();
  }

  waitingSql(column: PgColumn): SQL {
    return this.source ? this.source.waitingSql(column) : sql`false`;
  }

  async left(tx: Transaction, exit: PostReviewExit): Promise<void> {
    await this.source?.left(tx, exit);
  }
}
