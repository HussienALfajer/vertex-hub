import { Inject, Injectable } from '@nestjs/common';
import type { DepartmentCode, Role, UserAccess } from '@vertex-hub/contracts';
import {
  type Database,
  departmentMembers,
  departments,
  sessions,
  type Transaction,
  userRoles,
  users,
} from '@vertex-hub/db';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { resolveAccess } from './resolve-access.js';
import { hasPassword } from './user-status.js';

/** An active user and their address (F14 email: only active users get notification emails). */
export interface Mailbox {
  id: string;
  name: string;
  email: string;
}

/** F14 email rule 17: how a sender signs a client email. */
export interface Signature {
  name: string;
  title: string | null;
  phone: string | null;
  email: string;
}

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

  /** The signature of a user, archived or not; null when there is no such user. */
  async signature(
    id: string,
    executor: Database | Transaction = this.db,
  ): Promise<Signature | null> {
    const [row] = await executor
      .select({ name: users.name, title: users.title, phone: users.phone, email: users.email })
      .from(users)
      .where(eq(users.id, id));
    return row ?? null;
  }

  /**
   * Active users (a password set, not archived) by id: the given ones, or all of them when
   * `ids` is null. Invited and archived users are left out.
   */
  async mailboxes(ids: readonly string[] | null, executor: Database | Transaction = this.db) {
    if (ids?.length === 0) return new Map<string, Mailbox>();
    const rows = await executor
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(
        and(
          isNull(users.archivedAt),
          hasPassword,
          ids ? inArray(users.id, [...new Set(ids)]) : undefined,
        ),
      );
    return new Map<string, Mailbox>(rows.map((row) => [row.id, row]));
  }

  /** Whether the session still exists and has not expired (it ends on sign-out, reset, archive). */
  async sessionActive(sessionId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())));
    return !!row;
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

  /** The roles and department positions of a non-archived user, as the guard resolves them. */
  async access(
    userId: string,
    executor: Database | Transaction = this.db,
  ): Promise<UserAccess | null> {
    return (await resolveAccess(executor, userId))?.access ?? null;
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

  /** The ids of the non-archived holders of a role; invited users included. */
  async withRole(role: Role, executor: Database | Transaction = this.db): Promise<string[]> {
    const rows = await executor
      .select({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(and(eq(userRoles.role, role), isNull(users.archivedAt)))
      .orderBy(users.id);
    return rows.map((row) => row.id);
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

  /** The display name of every department, by code (F15 reports). */
  async departmentNames(
    executor: Database | Transaction = this.db,
  ): Promise<Map<DepartmentCode, string>> {
    const rows = await executor
      .select({ code: departments.code, name: departments.name })
      .from(departments);
    return new Map(rows.map((row) => [row.code, row.name]));
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
