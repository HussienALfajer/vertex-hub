import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type {
  AudienceMember,
  DepartmentCode,
  PersonRef,
  Role,
  UserAccess,
  UserDepartment,
} from '@vertex-hub/contracts';
import {
  type Database,
  departmentMembers,
  departments,
  sessions,
  type Transaction,
  userRoles,
  users,
} from '@vertex-hub/db';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { AuditActorPhotos } from '../audit/index.js';
import { resolveAccess } from './resolve-access.js';
import { hasPassword } from './user-status.js';

/**
 * The order of departments everywhere (F23 rule 4): active ones by position, then archived ones,
 * most recently archived first.
 */
export const departmentOrder = [
  sql`${departments.archivedAt} is not null`,
  desc(departments.archivedAt),
  asc(departments.position),
  asc(departments.id),
] as const;

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

/** The sources of an audience this module resolves (F16 rule D1). */
export interface PeopleSources {
  everyone?: boolean;
  departments?: readonly DepartmentCode[];
  roles?: readonly Role[];
  users?: readonly string[];
}

export interface UserSummary {
  id: string;
  name: string;
  /** The current photo (F01C). */
  imageId: string | null;
  archived: boolean;
}

/** A user as a contract's `personSchema` shows them; a missing one keeps its id with no name. */
export const personRef = (people: ReadonlyMap<string, UserSummary>, id: string): PersonRef => {
  const person = people.get(id);
  return { id, name: person?.name ?? '', imageId: person?.imageId ?? null };
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** A user as an HR file shows them (F17): name, title and departments, primary first. */
export interface UserProfile extends UserSummary {
  title: string | null;
  departments: UserDepartment[];
}

/** Which users `profiles` returns; every filter given must match. */
export interface ProfileFilter {
  ids?: readonly string[];
  /** Matches the name or the email. */
  search?: string;
  departmentId?: string;
  archived?: boolean;
}

/** Users as other modules may see them: names, status and roles, never the tables. */
@Injectable()
export class UserDirectory implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly auditPhotos: AuditActorPhotos,
  ) {}

  onModuleInit(): void {
    this.auditPhotos.register(async (ids) => {
      const people = await this.summaries([...ids]);
      return new Map([...people].map(([id, person]) => [id, person.imageId]));
    });
  }

  /** Names of the given users, archived ones included. */
  async summaries(ids: string[], executor: Database | Transaction = this.db) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, UserSummary>();
    const rows = await executor
      .select({
        id: users.id,
        name: users.name,
        imageId: users.imageId,
        archivedAt: users.archivedAt,
      })
      .from(users)
      .where(inArray(users.id, unique));
    return new Map<string, UserSummary>(
      rows.map((row) => [
        row.id,
        { id: row.id, name: row.name, imageId: row.imageId, archived: !!row.archivedAt },
      ]),
    );
  }

  /** The matching users, archived ones included unless filtered, sorted by name. */
  async profiles(
    filter: ProfileFilter,
    executor: Database | Transaction = this.db,
  ): Promise<UserProfile[]> {
    if (filter.ids?.length === 0) return [];
    const filters: SQL[] = [];
    if (filter.ids) filters.push(inArray(users.id, [...filter.ids]));
    if (filter.search) {
      const pattern = `%${escapeLike(filter.search)}%`;
      filters.push(or(ilike(users.name, pattern), ilike(users.email, pattern)) as SQL);
    }
    if (filter.departmentId) {
      filters.push(sql`exists (select 1 from ${departmentMembers}
        where ${departmentMembers.userId} = ${users.id}
          and ${departmentMembers.departmentId} = ${filter.departmentId})`);
    }
    if (filter.archived !== undefined) {
      filters.push(filter.archived ? isNotNull(users.archivedAt) : isNull(users.archivedAt));
    }
    const rows = await executor
      .select({
        id: users.id,
        name: users.name,
        imageId: users.imageId,
        title: users.title,
        archivedAt: users.archivedAt,
      })
      .from(users)
      .where(and(...filters))
      .orderBy(asc(users.name), asc(users.id));
    if (rows.length === 0) return [];
    const memberships = await executor
      .select({
        userId: departmentMembers.userId,
        id: departments.id,
        code: departments.code,
        name: departments.name,
        isPrimary: departmentMembers.isPrimary,
        managerId: departments.managerId,
      })
      .from(departmentMembers)
      .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
      .where(
        inArray(
          departmentMembers.userId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(desc(departmentMembers.isPrimary), asc(departments.name));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      imageId: row.imageId,
      title: row.title,
      archived: !!row.archivedAt,
      departments: memberships
        .filter((m) => m.userId === row.id)
        .map(({ userId, managerId, ...department }) => ({
          ...department,
          isManager: managerId === userId,
        })),
    }));
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

  /** The given sessions that still exist and have not expired (F16: where push may go). */
  async openSessions(
    sessionIds: readonly string[],
    executor: Database | Transaction = this.db,
  ): Promise<Set<string>> {
    if (sessionIds.length === 0) return new Set();
    const rows = await executor
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(inArray(sessions.id, [...new Set(sessionIds)]), gt(sessions.expiresAt, new Date())),
      );
    return new Set(rows.map((row) => row.id));
  }

  /** A non-archived user; an invited user qualifies. */
  async activeUser(
    userId: string,
    executor: Database | Transaction = this.db,
  ): Promise<UserSummary | null> {
    const [row] = await executor
      .select({ id: users.id, name: users.name, imageId: users.imageId })
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
      .select({ id: users.id, name: users.name, imageId: users.imageId })
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
      .select({ id: users.id, name: users.name, imageId: users.imageId })
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
      .select({ id: users.id, name: users.name, imageId: users.imageId, code: departments.code })
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
        imageId: row.imageId,
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

  /**
   * The managers a notice or reminder for a department reaches (F23 rule 14, edge case 17): its
   * manager, or the General Managers while the department is archived. A department without
   * either is left out.
   */
  async functionManagers(
    codes: readonly DepartmentCode[],
    executor: Database | Transaction = this.db,
  ): Promise<Map<DepartmentCode, string[]>> {
    const unique = [...new Set(codes)];
    const result = new Map<DepartmentCode, string[]>();
    if (unique.length === 0) return result;
    const rows = await executor
      .select({
        code: departments.code,
        managerId: departments.managerId,
        archivedAt: departments.archivedAt,
      })
      .from(departments)
      .where(inArray(departments.code, unique));
    let generalManagers: string[] | undefined;
    for (const row of rows) {
      if (row.archivedAt) {
        generalManagers ??= await this.withRole('general_manager', executor);
        if (generalManagers.length > 0) result.set(row.code, generalManagers);
      } else if (row.managerId) {
        result.set(row.code, [row.managerId]);
      }
    }
    return result;
  }

  /**
   * The members a system function reaches (F23 rule 14), as `activeMembers`: while a department
   * is archived, the General Managers stand in for its members.
   */
  async functionMembers(
    codes: DepartmentCode[],
    executor: Database | Transaction = this.db,
  ): Promise<(UserSummary & { departments: DepartmentCode[] })[]> {
    if (codes.length === 0) return [];
    const archived = await executor
      .select({ code: departments.code })
      .from(departments)
      .where(and(inArray(departments.code, codes), isNotNull(departments.archivedAt)));
    const replaced = archived.map((row) => row.code);
    const members = await this.activeMembers(codes, executor);
    if (replaced.length === 0) return members;
    const generalManagers = await executor
      .select({ id: users.id, name: users.name, imageId: users.imageId })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(and(eq(userRoles.role, 'general_manager'), isNull(users.archivedAt)));
    const byId = new Map(members.map((member) => [member.id, member]));
    for (const person of generalManagers) {
      const member = byId.get(person.id);
      if (member) member.departments = [...new Set([...member.departments, ...replaced])];
      else byId.set(person.id, { ...person, archived: false, departments: [...replaced] });
    }
    return [...byId.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
  }

  /**
   * F23 rule 5 (ADR 0043): every department a write newly names exists and is active. Callers pass
   * only the codes the write adds, so a record that keeps an archived department stays editable.
   */
  async assertActiveDepartments(
    codes: readonly DepartmentCode[],
    executor: Database | Transaction = this.db,
  ): Promise<void> {
    const unique = [...new Set(codes)];
    if (unique.length === 0) return;
    const rows = await executor
      .select({ archivedAt: departments.archivedAt })
      .from(departments)
      .where(inArray(departments.code, unique));
    if (rows.length !== unique.length) {
      throw new CodedException(400, 'UNKNOWN_DEPARTMENT', 'A department does not exist');
    }
    if (rows.some((row) => row.archivedAt)) {
      throw new CodedException(409, 'DEPARTMENT_ARCHIVED', 'A department is archived');
    }
  }

  /** Every department's code in their order (F23 rule 4): active ones, then archived ones. */
  async orderedDepartments(
    executor: Database | Transaction = this.db,
  ): Promise<{ code: DepartmentCode; archived: boolean }[]> {
    const rows = await executor
      .select({ code: departments.code, archivedAt: departments.archivedAt })
      .from(departments)
      .orderBy(...departmentOrder);
    return rows.map((row) => ({ code: row.code, archived: !!row.archivedAt }));
  }

  /** The active departments' codes in their order (F23 rules 4 and 6: lists and defaults). */
  async activeDepartmentCodes(
    executor: Database | Transaction = this.db,
  ): Promise<DepartmentCode[]> {
    const rows = await this.orderedDepartments(executor);
    return rows.filter((row) => !row.archived).map((row) => row.code);
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

  /** The primary department of each of the given users; users without one are left out. */
  async primaryDepartments(
    ids: readonly string[],
    executor: Database | Transaction = this.db,
  ): Promise<Map<string, DepartmentCode>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await executor
      .select({ userId: departmentMembers.userId, code: departments.code })
      .from(departmentMembers)
      .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
      .where(and(inArray(departmentMembers.userId, unique), eq(departmentMembers.isPrimary, true)));
    return new Map(rows.map((row) => [row.userId, row.code]));
  }

  /** The archived users whose primary department is one of `codes` (F06B edge case 14). */
  async archivedPrimaryMembers(
    codes: readonly DepartmentCode[],
    executor: Database | Transaction = this.db,
  ): Promise<string[]> {
    if (codes.length === 0) return [];
    const rows = await executor
      .select({ userId: departmentMembers.userId })
      .from(departmentMembers)
      .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
      .innerJoin(users, eq(users.id, departmentMembers.userId))
      .where(
        and(
          inArray(departments.code, [...codes]),
          eq(departmentMembers.isPrimary, true),
          isNotNull(users.archivedAt),
        ),
      );
    return rows.map((row) => row.userId);
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

  /**
   * F16 rule D1: the active users (a password set, not archived) of the sources: everyone, the
   * members of departments (primary or not), the holders of roles (`employee`: every user;
   * `department_manager`: the managers of any department) and the given people.
   */
  async activeOf(
    sources: PeopleSources,
    executor: Database | Transaction = this.db,
  ): Promise<string[]> {
    const { everyone, departments: codes = [], roles = [], users: ids = [] } = sources;
    const assigned = roles.filter(
      (role): role is Exclude<Role, 'employee' | 'department_manager'> =>
        role !== 'employee' && role !== 'department_manager',
    );
    const matches: SQL[] = [];
    if (ids.length > 0) matches.push(inArray(users.id, [...ids]));
    if (codes.length > 0) {
      matches.push(
        inArray(
          users.id,
          executor
            .select({ id: departmentMembers.userId })
            .from(departmentMembers)
            .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
            .where(inArray(departments.code, [...codes])),
        ),
      );
    }
    if (assigned.length > 0) {
      matches.push(
        inArray(
          users.id,
          executor
            .select({ id: userRoles.userId })
            .from(userRoles)
            .where(inArray(userRoles.role, assigned)),
        ),
      );
    }
    if (roles.includes('department_manager')) {
      matches.push(
        inArray(
          users.id,
          executor
            .select({ id: departments.managerId })
            .from(departments)
            .where(isNotNull(departments.managerId)),
        ),
      );
    }
    const all = everyone || roles.includes('employee');
    if (!all && matches.length === 0) return [];
    const rows = await executor
      .select({ id: users.id })
      .from(users)
      .where(and(isNull(users.archivedAt), hasPassword, all ? undefined : or(...matches)))
      .orderBy(users.id);
    return rows.map((row) => row.id);
  }

  /** The given users that are active (a password set, not archived). */
  async activeIds(
    ids: readonly string[],
    executor: Database | Transaction = this.db,
  ): Promise<string[]> {
    return [...(await this.mailboxes(ids, executor)).keys()];
  }

  /** F16 rule D2: how an audience picker lists people, by name. */
  async audienceMembers(
    ids: readonly string[],
    executor: Database | Transaction = this.db,
  ): Promise<AudienceMember[]> {
    if (ids.length === 0) return [];
    const rows = await executor
      .select({ id: users.id, name: users.name, imageId: users.imageId })
      .from(users)
      .where(inArray(users.id, [...new Set(ids)]))
      .orderBy(asc(users.name), asc(users.id));
    const primary = await this.primaryDepartments(
      rows.map((row) => row.id),
      executor,
    );
    return rows.map((row) => ({ ...row, department: primary.get(row.id) ?? null }));
  }
}
