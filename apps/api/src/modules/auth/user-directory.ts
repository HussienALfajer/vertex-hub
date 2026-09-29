import { Inject, Injectable } from '@nestjs/common';
import type { DepartmentCode } from '@vertex-hub/contracts';
import {
  type Database,
  departmentMembers,
  departments,
  type Transaction,
  userRoles,
  users,
} from '@vertex-hub/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';

export interface UserSummary {
  id: string;
  name: string;
  archived: boolean;
}

/** Users as other modules may see them: names, status and roles, never the tables. */
@Injectable()
export class UserDirectory {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Names of the given users, archived ones included. */
  async summaries(ids: string[], executor: Database | Transaction = this.db) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, UserSummary>();
    const rows = await executor
      .select({ id: users.id, name: users.name, archivedAt: users.archivedAt })
      .from(users)
      .where(inArray(users.id, unique));
    return new Map<string, UserSummary>(
      rows.map((row) => [row.id, { id: row.id, name: row.name, archived: !!row.archivedAt }]),
    );
  }

  /** A non-archived user; an invited user qualifies. */
  async activeUser(
    userId: string,
    executor: Database | Transaction = this.db,
  ): Promise<UserSummary | null> {
    const [row] = await executor
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.archivedAt)));
    return row ? { ...row, archived: false } : null;
  }

  /** A non-archived user who holds the Account Manager role; an invited user qualifies. */
  async accountManager(
    userId: string,
    executor: Database | Transaction = this.db,
  ): Promise<UserSummary | null> {
    const [row] = await executor
      .select({ id: users.id, name: users.name })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(
        and(eq(users.id, userId), eq(userRoles.role, 'account_manager'), isNull(users.archivedAt)),
      );
    return row ? { ...row, archived: false } : null;
  }

  /** A non-archived member (primary or secondary) of the department; an invited user qualifies. */
  async activeMember(
    userId: string,
    department: DepartmentCode,
    executor: Database | Transaction = this.db,
  ): Promise<UserSummary | null> {
    const [row] = await executor
      .select({ id: users.id, name: users.name })
      .from(users)
      .innerJoin(departmentMembers, eq(departmentMembers.userId, users.id))
      .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
      .where(and(eq(users.id, userId), eq(departments.code, department), isNull(users.archivedAt)));
    return row ? { ...row, archived: false } : null;
  }

  /**
   * Non-archived members (primary or secondary) of any of the departments, by name, each with the
   * ones of those departments they belong to; an invited user qualifies.
   */
  async activeMembers(
    codes: DepartmentCode[],
    executor: Database | Transaction = this.db,
  ): Promise<(UserSummary & { departments: DepartmentCode[] })[]> {
    if (codes.length === 0) return [];
    const rows = await executor
      .select({ id: users.id, name: users.name, code: departments.code })
      .from(users)
      .innerJoin(departmentMembers, eq(departmentMembers.userId, users.id))
      .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
      .where(and(inArray(departments.code, codes), isNull(users.archivedAt)))
      .orderBy(users.name, users.id, departments.code);
    const members = new Map<string, UserSummary & { departments: DepartmentCode[] }>();
    for (const row of rows) {
      const member = members.get(row.id) ?? {
        id: row.id,
        name: row.name,
        archived: false,
        departments: [],
      };
      member.departments.push(row.code);
      members.set(row.id, member);
    }
    return [...members.values()];
  }

  /** The managers of each of the departments, by code; a department without one is left out. */
  async departmentManagers(
    codes: DepartmentCode[],
    executor: Database | Transaction = this.db,
  ): Promise<Map<DepartmentCode, string[]>> {
    const unique = [...new Set(codes)];
    const result = new Map<DepartmentCode, string[]>();
    if (unique.length === 0) return result;
    const rows = await executor
      .select({ code: departments.code, managerId: departments.managerId })
      .from(departments)
      .where(inArray(departments.code, unique));
    for (const row of rows) {
      if (row.managerId) result.set(row.code, [row.managerId]);
    }
    return result;
  }

  /** The department codes each of the given users belongs to. */
  async memberships(ids: string[], executor: Database | Transaction = this.db) {
    const unique = [...new Set(ids)];
    const result = new Map<string, Set<DepartmentCode>>();
    if (unique.length === 0) return result;
    const rows = await executor
      .select({ userId: departmentMembers.userId, code: departments.code })
      .from(departmentMembers)
      .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
      .where(inArray(departmentMembers.userId, unique));
    for (const row of rows) {
      const codes = result.get(row.userId) ?? new Set<DepartmentCode>();
      codes.add(row.code);
      result.set(row.userId, codes);
    }
    return result;
  }
}
