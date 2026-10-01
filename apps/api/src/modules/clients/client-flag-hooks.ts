import { Injectable } from '@nestjs/common';
import type { Transaction } from '@vertex-hub/db';
import type { AuditActor } from '../audit/index.js';

/** A client's healthcare flag as it changes, inside the transaction that changes it. */
export interface HealthcareChange {
  clientId: string;
  isHealthcare: boolean;
  actor: AuditActor;
}

export type ClientFlagHook = (tx: Transaction, change: HealthcareChange) => Promise<void>;

/**
 * Lets the `tasks` module apply a healthcare flag change to work not yet sent (spec F09, rules
 * 18 and 19) without `clients` importing it. Hooks run in the transaction of the change.
 */
@Injectable()
export class ClientFlagHooks {
  private readonly hooks: ClientFlagHook[] = [];

  register(hook: ClientFlagHook): void {
    this.hooks.push(hook);
  }

  async healthcareChanged(tx: Transaction, change: HealthcareChange): Promise<void> {
    for (const hook of this.hooks) await hook(tx, change);
  }
}
