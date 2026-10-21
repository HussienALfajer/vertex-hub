import { Injectable } from '@nestjs/common';
import type { Transaction } from '@vertex-hub/db';

/** What a module does when a user is created, archived or restored, in the same transaction. */
export interface UserLifecycleHook {
  created?(tx: Transaction, userId: string): Promise<void>;
  archived?(tx: Transaction, userId: string): Promise<void>;
  restored?(tx: Transaction, userId: string): Promise<void>;
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

  async run(event: keyof UserLifecycleHook, tx: Transaction, userId: string): Promise<void> {
    // One hook at a time: a transaction runs on a single connection.
    for (const hook of this.hooks) await hook[event]?.(tx, userId);
  }
}
