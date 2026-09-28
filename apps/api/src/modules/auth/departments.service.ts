import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type DepartmentDetailResponse,
  type DepartmentListResponse,
  type DepartmentResponse,
  hasPermission,
  type UpdateDepartment,
} from '@vertex-hub/contracts';
import {
  type Database,
  departmentMembers,
  departments,
  type Transaction,
  users,
} from '@vertex-hub/db';
import { aliasedTable, and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from './current-user.decorator.js';
import { hasPassword, lockAccessChanges } from './user-status.js';

const managers = aliasedTable(users, 'managers');

const memberCount = sql<number>`(
  select count(*)::int from ${departmentMembers}
  inner join ${users} on ${users.id} = ${departmentMembers.userId}
  where ${departmentMembers.departmentId} = ${departments.id} and ${users.archivedAt} is null)`;

/** The ten fixed departments (ADR 0014): names and managers are editable. */
@Injectable()
export class DepartmentsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(): Promise<DepartmentListResponse> {
    const rows = await this.db
      .select({
        id: departments.id,
        code: departments.code,
        name: departments.name,
        managerId: managers.id,
        managerName: managers.name,
        memberCount,
      })
      .from(departments)
      .leftJoin(managers, eq(managers.id, departments.managerId))
      // Ids are UUIDv7 literals in seed order.
      .orderBy(asc(departments.id));
    return { items: rows.map(toDepartment) };
  }

  /** Member status (invited or active) is shown to user managers only. */
  async detail(actor: CurrentUserInfo, id: string): Promise<DepartmentDetailResponse> {
    const [row] = await this.db
      .select({
        id: departments.id,
        code: departments.code,
        name: departments.name,
        managerId: managers.id,
        managerName: managers.name,
        memberCount,
      })
      .from(departments)
      .leftJoin(managers, eq(managers.id, departments.managerId))
      .where(eq(departments.id, id));
    if (!row) throw new NotFoundException();
    const members = await this.db
      .select({
        id: users.id,
        name: users.name,
        title: users.title,
        isPrimary: departmentMembers.isPrimary,
        hasPassword,
      })
      .from(departmentMembers)
      .innerJoin(users, eq(users.id, departmentMembers.userId))
      .where(and(eq(departmentMembers.departmentId, id), isNull(users.archivedAt)))
      .orderBy(desc(departmentMembers.isPrimary), asc(users.name));
    return {
      ...toDepartment(row),
      members: members.map(({ hasPassword: active, ...member }) =>
        hasPermission(actor.access, 'users.manage')
          ? { ...member, status: active ? 'active' : 'invited' }
          : member,
      ),
    };
  }

  async update(
    actor: CurrentUserInfo,
    id: string,
    input: UpdateDepartment,
  ): Promise<DepartmentDetailResponse> {
    await this.db.transaction(async (tx) => {
      await lockAccessChanges(tx);
      const [current] = await tx
        .select({
          name: departments.name,
          managerId: departments.managerId,
          managerName: managers.name,
        })
        .from(departments)
        .leftJoin(managers, eq(managers.id, departments.managerId))
        .where(eq(departments.id, id))
        .for('update', { of: departments });
      if (!current) throw new NotFoundException();

      if (input.name !== undefined && input.name !== current.name) {
        const [taken] = await tx
          .select({ id: departments.id })
          .from(departments)
          .where(and(eq(departments.name, input.name), ne(departments.id, id)));
        if (taken) {
          throw new CodedException(
            409,
            'DEPARTMENT_NAME_TAKEN',
            'Another department has this name',
          );
        }
      }

      let manager: { id: string; name: string } | null | undefined;
      if (input.managerId !== undefined) {
        manager =
          input.managerId === null ? null : await this.activeMember(tx, id, input.managerId);
      }

      const before = {
        name: current.name,
        manager: current.managerId ? { id: current.managerId, name: current.managerName } : null,
      };
      const change = changedFields(before, { name: input.name, manager });
      if (!change) return;
      await tx
        .update(departments)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(manager !== undefined && { managerId: manager?.id ?? null }),
        })
        .where(eq(departments.id, id));
      await recordAudit(tx, {
        actor: { id: actor.id, name: actor.name },
        action: 'department.updated',
        entityType: 'department',
        entityId: id,
        ...change,
      });
    });
    return this.detail(actor, id);
  }

  /** A manager must be an active member of the department (F01 rule 8). */
  private async activeMember(
    tx: Transaction,
    departmentId: string,
    userId: string,
  ): Promise<{ id: string; name: string }> {
    const [member] = await tx
      .select({ id: users.id, name: users.name })
      .from(departmentMembers)
      .innerJoin(users, eq(users.id, departmentMembers.userId))
      .where(
        and(
          eq(departmentMembers.departmentId, departmentId),
          eq(departmentMembers.userId, userId),
          isNull(users.archivedAt),
          hasPassword,
        ),
      );
    if (!member) {
      throw new CodedException(
        400,
        'MANAGER_NOT_MEMBER',
        'The manager must be an active member of the department',
      );
    }
    return member;
  }
}

function toDepartment(row: {
  id: string;
  code: DepartmentResponse['code'];
  name: string;
  managerId: string | null;
  managerName: string | null;
  memberCount: number;
}): DepartmentResponse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    manager: row.managerId ? { id: row.managerId, name: row.managerName ?? '' } : null,
    memberCount: row.memberCount,
  };
}
