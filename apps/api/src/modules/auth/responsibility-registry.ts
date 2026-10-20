import { Injectable } from '@nestjs/common';
import type { AssignableRole, Responsibility } from '@vertex-hub/contracts';
import type { Transaction } from '@vertex-hub/db';

/**
 * What another module holds a user responsible for. `role` names the assigned role the
 * responsibility depends on: removing that role is refused too, not only archiving the user.
 */
export interface ResponsibilityCheck {
  role?: AssignableRole;
  find(tx: Transaction, userId: string): Promise<Responsibility[]>;
}

/** How many open items a user still holds that do not block archiving them. */
export type OpenWorkCount = (tx: Transaction, userId: string) => Promise<number>;

/**
 * Lets modules that depend on `auth` block archiving a user or removing their role (F02 rule 8)
 * without `auth` importing them. Checks run inside the access-change lock. F16: modules whose
 * open items do not block archiving (campaigns) register them as open work, which
 * `member_archived_open_work` tells the user's managers about.
 */
@Injectable()
export class ResponsibilityRegistry {
  private readonly checks: ResponsibilityCheck[] = [];
  private readonly openWorkCounts: OpenWorkCount[] = [];

  register(check: ResponsibilityCheck): void {
    this.checks.push(check);
  }

  registerOpenWork(count: OpenWorkCount): void {
    this.openWorkCounts.push(count);
  }

  /** Every open item the user holds, blocking or not (F16 part C rule 3). */
  async openWork(tx: Transaction, userId: string): Promise<number> {
    let total = (await this.find(tx, userId)).length;
    for (const count of this.openWorkCounts) total += await count(tx, userId);
    return total;
  }

  /** Every registered responsibility, or only those that depend on `role`. */
  async find(tx: Transaction, userId: string, role?: AssignableRole): Promise<Responsibility[]> {
    const checks = role ? this.checks.filter((check) => check.role === role) : this.checks;
    const found: Responsibility[] = [];
    // One query at a time: a transaction runs on a single connection.
    for (const check of checks) found.push(...(await check.find(tx, userId)));
    return found;
  }
}
