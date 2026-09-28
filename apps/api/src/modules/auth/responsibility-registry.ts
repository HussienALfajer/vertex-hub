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

/**
 * Lets modules that depend on `auth` block archiving a user or removing their role (F02 rule 8)
 * without `auth` importing them. Checks run inside the access-change lock.
 */
@Injectable()
export class ResponsibilityRegistry {
  private readonly checks: ResponsibilityCheck[] = [];

  register(check: ResponsibilityCheck): void {
    this.checks.push(check);
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
