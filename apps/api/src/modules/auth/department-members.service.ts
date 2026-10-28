import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AddDepartmentMembers,
  DepartmentCode,
  DepartmentDetailResponse,
  MoveDepartmentMember,
} from '@vertex-hub/contracts';
import {
  type Database,
  departmentMembers,
  departments,
  type Transaction,
  userRoles,
  users,
} from '@vertex-hub/db';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AccountNotice, AccountNotices } from './account-notices.js';
import type { CurrentUserInfo } from './current-user.decorator.js';
import { auditedMembershipChange } from './department-memberships.js';
import { DepartmentsService } from './departments.service.js';
import { lockAccessChanges } from './user-status.js';

/** A department as membership changes read it, locked. */
interface LockedDepartment {
  id: string;
  code: DepartmentCode;
  name: string;
  managerId: string | null;
}

/** A user a membership change touches, locked. */
interface LockedUser {
  id: string;
  name: string;
  archived: boolean;
}

/**
 * Members managed from the department page (F23 rules 17–23), under the rules of the F01 user
 * form: one primary department per user, a manager stays a member, archived users and General
 * Managers (for anyone but a General Manager) cannot be changed. Changes apply to permissions on
 * the next request (ADR 0014).
 */
@Injectable()
export class DepartmentMembersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly departments: DepartmentsService,
    private readonly notices: AccountNotices,
  ) {}

  /** Rule 17: secondary memberships, all or nothing (edge case 13). */
  async add(
    actor: CurrentUserInfo,
    id: string,
    input: AddDepartmentMembers,
  ): Promise<DepartmentDetailResponse> {
    await this.db.transaction(async (tx) => {
      const department = await this.lockDepartment(tx, id);
      const ids = [...new Set(input.userIds)];
      const people = await this.lockUsers(tx, actor, ids);
      const archived = people.filter((person) => person.archived);
      if (archived.length > 0) {
        throw new CodedException(
          409,
          'USER_ARCHIVED',
          'Archived users cannot join a department',
          archived.map(({ id, name }) => ({ id, name })),
        );
      }
      const existing = await tx
        .select({ userId: departmentMembers.userId })
        .from(departmentMembers)
        .where(and(eq(departmentMembers.departmentId, id), inArray(departmentMembers.userId, ids)));
      if (existing.length > 0) {
        const members = new Set(existing.map((row) => row.userId));
        throw new CodedException(
          409,
          'ALREADY_MEMBER',
          'A user is already a member',
          people.filter((person) => members.has(person.id)).map(({ id, name }) => ({ id, name })),
        );
      }
      const notices: AccountNotice[] = [];
      for (const person of people) {
        await auditedMembershipChange(tx, actor, person, async () => {
          await tx
            .insert(departmentMembers)
            .values({ userId: person.id, departmentId: id, isPrimary: false });
        });
        notices.push(...added(actor, department, person, false));
      }
      await this.notices.send(tx, notices);
    });
    return this.departments.detail(actor, id);
  }

  /** Rule 18: the previous primary department stays as a secondary membership. */
  async makePrimary(
    actor: CurrentUserInfo,
    id: string,
    userId: string,
  ): Promise<DepartmentDetailResponse> {
    await this.db.transaction(async (tx) => {
      await this.lockDepartment(tx, id);
      const person = await this.lockMember(tx, actor, userId);
      const isPrimary = await this.membership(tx, id, userId);
      if (isPrimary === undefined) throw new NotFoundException();
      if (isPrimary) return;
      await auditedMembershipChange(tx, actor, person, () => setPrimary(tx, userId, id));
    });
    return this.departments.detail(actor, id);
  }

  /**
   * Rule 19: the membership keeps its kind in the target; when the member already belongs there,
   * the memberships merge and primary wins.
   */
  async move(
    actor: CurrentUserInfo,
    id: string,
    userId: string,
    input: MoveDepartmentMember,
  ): Promise<DepartmentDetailResponse> {
    await this.db.transaction(async (tx) => {
      const department = await this.lockDepartment(tx, id);
      const [target] =
        input.departmentId === id
          ? []
          : await tx
              .select({
                id: departments.id,
                code: departments.code,
                name: departments.name,
                managerId: departments.managerId,
                archivedAt: departments.archivedAt,
              })
              .from(departments)
              .where(eq(departments.id, input.departmentId))
              .for('update');
      if (!target || target.archivedAt) {
        throw new CodedException(
          400,
          'INVALID_TRANSFER_TARGET',
          'Move the member to another active department',
        );
      }
      const person = await this.lockMember(tx, actor, userId);
      const isPrimary = await this.membership(tx, id, userId);
      if (isPrimary === undefined) throw new NotFoundException();
      this.assertNotManager(department, userId);
      const there = await this.membership(tx, target.id, userId);
      await auditedMembershipChange(tx, actor, person, async () => {
        await removeMembership(tx, userId, id);
        if (there === undefined) {
          await tx
            .insert(departmentMembers)
            .values({ userId, departmentId: target.id, isPrimary: false });
        }
        if (isPrimary) await setPrimary(tx, userId, target.id);
      });
      await this.notices.send(tx, [
        ...removed(actor, department, person),
        ...(there === undefined ? added(actor, target, person, isPrimary) : []),
      ]);
    });
    return this.departments.detail(actor, id);
  }

  /** Rules 20 and 21: secondary memberships of someone who does not manage the department. */
  async remove(
    actor: CurrentUserInfo,
    id: string,
    userId: string,
  ): Promise<DepartmentDetailResponse> {
    await this.db.transaction(async (tx) => {
      const department = await this.lockDepartment(tx, id);
      const person = await this.lockMember(tx, actor, userId);
      const isPrimary = await this.membership(tx, id, userId);
      if (isPrimary === undefined) throw new NotFoundException();
      this.assertNotManager(department, userId);
      if (isPrimary) {
        throw new CodedException(
          409,
          'PRIMARY_DEPARTMENT_REQUIRED',
          'A primary membership is moved or changed, never removed',
        );
      }
      await auditedMembershipChange(tx, actor, person, () => removeMembership(tx, userId, id));
      await this.notices.send(tx, removed(actor, department, person));
    });
    return this.departments.detail(actor, id);
  }

  /** The active department, locked with every other access change (rule 1). */
  private async lockDepartment(tx: Transaction, id: string): Promise<LockedDepartment> {
    await lockAccessChanges(tx);
    const [department] = await tx
      .select({
        id: departments.id,
        code: departments.code,
        name: departments.name,
        managerId: departments.managerId,
        archivedAt: departments.archivedAt,
      })
      .from(departments)
      .where(eq(departments.id, id))
      .for('update');
    if (!department) throw new NotFoundException();
    if (department.archivedAt) {
      throw new CodedException(409, 'DEPARTMENT_ARCHIVED', 'The department is archived');
    }
    return department;
  }

  /** The users, locked; a General Manager only for a General Manager (F01 rule 7). */
  private async lockUsers(
    tx: Transaction,
    actor: CurrentUserInfo,
    ids: string[],
  ): Promise<LockedUser[]> {
    const rows = await tx
      .select({ id: users.id, name: users.name, archivedAt: users.archivedAt })
      .from(users)
      .where(inArray(users.id, ids))
      .orderBy(users.name, users.id)
      .for('update');
    if (rows.length !== ids.length) throw new NotFoundException();
    const managers = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(and(inArray(userRoles.userId, ids), eq(userRoles.role, 'general_manager')));
    const generalManagers = new Set(managers.map((row) => row.userId));
    if (generalManagers.size > 0 && !actor.access.roles.includes('general_manager')) {
      throw new CodedException(
        403,
        'GENERAL_MANAGER_ONLY',
        'Only a General Manager can change a General Manager',
      );
    }
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      archived: !!row.archivedAt,
    }));
  }

  /** Rule 22: one user, not archived. */
  private async lockMember(
    tx: Transaction,
    actor: CurrentUserInfo,
    userId: string,
  ): Promise<LockedUser> {
    const [person] = await this.lockUsers(tx, actor, [userId]);
    if (!person) throw new NotFoundException();
    if (person.archived) {
      throw new CodedException(409, 'USER_ARCHIVED', 'Restore the user before changing them');
    }
    return person;
  }

  /** Whether the user is a primary member; undefined when not a member. */
  private async membership(
    tx: Transaction,
    departmentId: string,
    userId: string,
  ): Promise<boolean | undefined> {
    const [row] = await tx
      .select({ isPrimary: departmentMembers.isPrimary })
      .from(departmentMembers)
      .where(
        and(eq(departmentMembers.departmentId, departmentId), eq(departmentMembers.userId, userId)),
      );
    return row?.isPrimary;
  }

  /** Rule 21 (F01 rule 8): a manager stays a member until the manager changes. */
  private assertNotManager(department: LockedDepartment, userId: string): void {
    if (department.managerId === userId) {
      throw new CodedException(
        409,
        'MANAGER_MEMBERSHIP_REQUIRED',
        'Change the manager of this department first',
        [{ type: 'manages_department', id: department.id, name: department.name }],
      );
    }
  }
}

/** Makes `departmentId` the user's one primary department; the others stay secondary. */
async function setPrimary(tx: Transaction, userId: string, departmentId: string): Promise<void> {
  // Clear the primary flag first: one primary per user is a unique index.
  await tx
    .update(departmentMembers)
    .set({ isPrimary: false })
    .where(
      and(eq(departmentMembers.userId, userId), ne(departmentMembers.departmentId, departmentId)),
    );
  await tx
    .update(departmentMembers)
    .set({ isPrimary: true })
    .where(
      and(eq(departmentMembers.userId, userId), eq(departmentMembers.departmentId, departmentId)),
    );
}

async function removeMembership(
  tx: Transaction,
  userId: string,
  departmentId: string,
): Promise<void> {
  await tx
    .delete(departmentMembers)
    .where(
      and(eq(departmentMembers.userId, userId), eq(departmentMembers.departmentId, departmentId)),
    );
}

/** `department_member_added`: to the member and to the department's manager. */
function added(
  actor: CurrentUserInfo,
  department: LockedDepartment,
  person: LockedUser,
  primary: boolean,
): AccountNotice[] {
  const base = { type: 'department_member_added' as const, actorId: actor.id };
  return [
    {
      ...base,
      recipients: [person.id],
      subjectId: department.id,
      data: { department: department.code, member: null, primary },
    },
    {
      ...base,
      recipients:
        department.managerId && department.managerId !== person.id ? [department.managerId] : [],
      subjectId: department.id,
      data: { department: department.code, member: person.name, primary },
    },
  ];
}

/** `department_member_removed`: to the member and to the department's manager. */
function removed(
  actor: CurrentUserInfo,
  department: LockedDepartment,
  person: LockedUser,
): AccountNotice[] {
  const base = {
    type: 'department_member_removed' as const,
    actorId: actor.id,
    subjectId: department.id,
  };
  return [
    { ...base, recipients: [person.id], data: { department: department.code, member: null } },
    {
      ...base,
      recipients: department.managerId ? [department.managerId] : [],
      data: { department: department.code, member: person.name },
    },
  ];
}
