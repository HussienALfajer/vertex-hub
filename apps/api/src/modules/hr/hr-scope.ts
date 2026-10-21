import { Injectable } from '@nestjs/common';
import { type DepartmentCode, permissionScopes } from '@vertex-hub/contracts';
import type { Database, Transaction } from '@vertex-hub/db';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';

type Executor = Database | Transaction;

/** Whom `hr.read` covers: everyone, or the members of the departments the actor manages. */
export type HrReach = { all: true } | { all: false; userIds: ReadonlySet<string> };

/**
 * The `hr.read` scope (spec, "Roles and access"): GMs and Ops read everyone; a department manager
 * reads the members of the departments they manage (several departments: their union, edge case
 * 21). The actor's own records are theirs whatever the scope.
 */
@Injectable()
export class HrScope {
  constructor(private readonly users: UserDirectory) {}

  /** Null when the actor does not hold `hr.read`. */
  async reach(actor: CurrentUserInfo, executor?: Executor): Promise<HrReach | null> {
    const scopes = permissionScopes(actor.access, 'hr.read');
    if (scopes.includes('all')) return { all: true };
    if (!scopes.includes('department')) return null;
    const managed = actor.access.departments
      .filter((department) => department.isManager)
      .map((department): DepartmentCode => department.code);
    const members = await this.users.activeMembers(managed, executor);
    return { all: false, userIds: new Set(members.map((member) => member.id)) };
  }

  /** Whether `hr.read` covers `userId`. */
  async covers(actor: CurrentUserInfo, userId: string, executor?: Executor): Promise<boolean> {
    const reach = await this.reach(actor, executor);
    return !!reach && (reach.all || reach.userIds.has(userId));
  }
}

export const reaches = (reach: HrReach | null, userId: string): boolean =>
  !!reach && (reach.all || reach.userIds.has(userId));
