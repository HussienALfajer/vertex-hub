import { Injectable } from '@nestjs/common';
import type { Transaction } from '@vertex-hub/db';
import type { AuditActor } from '../audit/index.js';

/**
 * What a module does when a user is created, archived or restored, in the same transaction;
 * `actor` is null for the system (F17 rule A8).
 */
type LifecycleStep = (tx: Transaction, userId: string, actor: AuditActor | null) => Promise<void>;

export interface UserLifecycleHook {
  created?: LifecycleStep;
  archived?: LifecycleStep;
  restored?: LifecycleStep;
}

/**
 * Lets modules that depend on `auth` keep their per-user records in step with the account
 * (F17 rule A1: the employee file) without `auth` importing them.
 */
@Injectable()
export class UserLifecycle {
  private readonly hooks: UserLifecycleHook[] = [];

  register(hook: UserLifecycleHook): void {
    this.hooks.push(hook);
  }

  async run(
    event: keyof UserLifecycleHook,
    tx: Transaction,
    userId: string,
    actor: AuditActor | null,
  ): Promise<void> {
    // One hook at a time: a transaction runs on a single connection.
    for (const hook of this.hooks) await hook[event]?.(tx, userId, actor);
  }
}
