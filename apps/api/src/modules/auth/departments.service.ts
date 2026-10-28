import { randomBytes } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateDepartment,
  DEPARTMENT_CAPABILITIES,
  type DepartmentDetailResponse,
  type DepartmentListResponse,
  type DepartmentOrder,
  type DepartmentResponse,
  departmentIconSchema,
  departmentSystemFunctions,
  generatedDepartmentCode,
  hasPermission,
  PERMISSIONS,
  type Permission,
  type UpdateDepartment,
} from '@vertex-hub/contracts';
import {
  type Database,
  departmentMembers,
  departments,
  type Transaction,
  users,
} from '@vertex-hub/db';
import { aliasedTable, and, asc, desc, eq, isNull, max, ne, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { AccountNotices } from './account-notices.js';
import type { CurrentUserInfo } from './current-user.decorator.js';
import { departmentOrder } from './user-directory.js';
import { hasPassword, lockAccessChanges } from './user-status.js';

const managers = aliasedTable(users, 'managers');
const archivers = aliasedTable(users, 'archivers');

const memberCount = sql<number>`(
  select count(*)::int from ${departmentMembers}
  inner join ${users} on ${users.id} = ${departmentMembers.userId}
  where ${departmentMembers.departmentId} = ${departments.id} and ${users.archivedAt} is null)`;

/** A department with its manager and member count, as lists and pages show it. */
const departmentFields = {
  id: departments.id,
  code: departments.code,
  name: departments.name,
  description: departments.description,
  color: departments.color,
  icon: departments.icon,
  position: departments.position,
  archivedAt: departments.archivedAt,
  managerId: managers.id,
  managerName: managers.name,
  managerImageId: managers.imageId,
  memberCount,
};

/**
 * Departments (ADR 0014, ADR 0043, F23): the General Manager creates and restores them; user
 * managers edit their identity, manager and order. Archiving is `DepartmentArchiveService`,
 * members `DepartmentMembersService`.
 */
@Injectable()
export class DepartmentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly notices: AccountNotices,
  ) {}

  async list(): Promise<DepartmentListResponse> {
    const rows = await this.db
      .select(departmentFields)
      .from(departments)
      .leftJoin(managers, eq(managers.id, departments.managerId))
      .orderBy(...departmentOrder);
    return { items: rows.map(toDepartment) };
  }

  /** Member status (invited or active) is shown to user managers only. */
  async detail(actor: CurrentUserInfo, id: string): Promise<DepartmentDetailResponse> {
    const [row] = await this.db
      .select({
        ...departmentFields,
        archivedById: archivers.id,
        archivedByName: archivers.name,
        archivedByImageId: archivers.imageId,
      })
      .from(departments)
      .leftJoin(managers, eq(managers.id, departments.managerId))
      .leftJoin(archivers, eq(archivers.id, departments.archivedById))
      .where(eq(departments.id, id));
    if (!row) throw new NotFoundException();
    const capabilities = DEPARTMENT_CAPABILITIES[row.code];
    const granted = (grants: Partial<Record<Permission, unknown>> | undefined) =>
      PERMISSIONS.filter((permission) => grants?.[permission] !== undefined);
    const members = await this.db
      .select({
        id: users.id,
        name: users.name,
        imageId: users.imageId,
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
      // Rule 27: what the department grants, read-only.
      grants: { member: granted(capabilities?.member), manager: granted(capabilities?.manager) },
      systemFunctions: [...departmentSystemFunctions(row.code)],
      archivedBy: row.archivedById
        ? { id: row.archivedById, name: row.archivedByName ?? '', imageId: row.archivedByImageId }
        : null,
    };
  }

  /** Rule 2: no members, no manager, last in the order; the code is generated (ADR 0043). */
  async create(actor: CurrentUserInfo, input: CreateDepartment): Promise<DepartmentDetailResponse> {
    const id = await this.db.transaction(async (tx) => {
      await lockAccessChanges(tx);
      await this.assertNameFree(tx, input.name);
      const fields = {
        name: input.name,
        description: input.description || null,
        color: input.color,
        icon: input.icon,
      };
      const [created] = await tx
        .insert(departments)
        .values({ code: await this.newCode(tx), ...fields, position: await nextPosition(tx) })
        .returning({ id: departments.id });
      if (!created) throw new Error('The department was not created');
      await recordAudit(tx, {
        actor: { id: actor.id, name: actor.name },
        action: 'department.created',
        entityType: 'department',
        entityId: created.id,
        after: fields,
      });
      return created.id;
    });
    return this.detail(actor, id);
  }

  /** Rule 4: the whole list of active departments, in its new order. */
  async order(actor: CurrentUserInfo, input: DepartmentOrder): Promise<DepartmentListResponse> {
    await this.db.transaction(async (tx) => {
      await lockAccessChanges(tx);
      const active = await tx
        .select({ id: departments.id, position: departments.position })
        .from(departments)
        .where(isNull(departments.archivedAt));
      const ids = new Set(input.ids);
      if (
        ids.size !== input.ids.length ||
        ids.size !== active.length ||
        active.some((department) => !ids.has(department.id))
      ) {
        throw new CodedException(
          409,
          'DEPARTMENT_ORDER_MISMATCH',
          'The order must name every active department once',
        );
      }
      const before = new Map(active.map((department) => [department.id, department.position]));
      for (const [index, id] of input.ids.entries()) {
        const position = index + 1;
        const was = before.get(id);
        if (was === position) continue;
        await tx.update(departments).set({ position }).where(eq(departments.id, id));
        await recordAudit(tx, {
          actor: { id: actor.id, name: actor.name },
          action: 'department.reordered',
          entityType: 'department',
          entityId: id,
          before: { position: was },
          after: { position },
        });
      }
    });
    return this.list();
  }

  /**
   * Rule 16: back with no members and no manager, last in the order; nothing moved by the archive
   * moves back.
   */
  async restore(actor: CurrentUserInfo, id: string): Promise<DepartmentDetailResponse> {
    await this.db.transaction(async (tx) => {
      await lockAccessChanges(tx);
      const [current] = await tx
        .select({ archivedAt: departments.archivedAt, position: departments.position })
        .from(departments)
        .where(eq(departments.id, id))
        .for('update');
      if (!current) throw new NotFoundException();
      if (!current.archivedAt) {
        throw new CodedException(409, 'DEPARTMENT_NOT_ARCHIVED', 'The department is not archived');
      }
      const position = await nextPosition(tx);
      await tx
        .update(departments)
        .set({ archivedAt: null, archivedById: null, position })
        .where(eq(departments.id, id));
      await recordAudit(tx, {
        actor: { id: actor.id, name: actor.name },
        action: 'department.restored',
        entityType: 'department',
        entityId: id,
        before: { archived: true, position: current.position },
        after: { archived: false, position },
      });
    });
    return this.detail(actor, id);
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
          code: departments.code,
          name: departments.name,
          description: departments.description,
          color: departments.color,
          icon: departments.icon,
          managerId: departments.managerId,
          managerName: managers.name,
          archivedAt: departments.archivedAt,
        })
        .from(departments)
        .leftJoin(managers, eq(managers.id, departments.managerId))
        .where(eq(departments.id, id))
        .for('update', { of: departments });
      if (!current) throw new NotFoundException();
      if (current.archivedAt) {
        throw new CodedException(409, 'DEPARTMENT_ARCHIVED', 'The department is archived');
      }

      if (input.name !== undefined && input.name !== current.name) {
        await this.assertNameFree(tx, input.name, id);
      }

      let manager: { id: string; name: string } | null | undefined;
      if (input.managerId !== undefined) {
        manager =
          input.managerId === null ? null : await this.activeMember(tx, id, input.managerId);
      }

      const before = {
        name: current.name,
        description: current.description,
        color: current.color,
        icon: current.icon,
        manager: current.managerId ? { id: current.managerId, name: current.managerName } : null,
      };
      const identity = {
        name: input.name,
        description: input.description === undefined ? undefined : input.description || null,
        color: input.color,
        icon: input.icon,
      };
      const change = changedFields(before, { ...identity, manager });
      if (!change) return;
      await tx
        .update(departments)
        .set({
          ...(identity.name !== undefined && { name: identity.name }),
          ...(identity.description !== undefined && { description: identity.description }),
          ...(identity.color !== undefined && { color: identity.color }),
          ...(identity.icon !== undefined && { icon: identity.icon }),
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
      if (manager !== undefined && manager?.id !== current.managerId) {
        await this.notifyManager(tx, actor, id, current, input.name ?? current.name, manager);
      }
    });
    return this.detail(actor, id);
  }

  /**
   * F16 part C: the new manager is told, and the previous one learns who holds the department now
   * (rule 4); nobody is told when the manager is only removed.
   */
  private async notifyManager(
    tx: Transaction,
    actor: CurrentUserInfo,
    id: string,
    current: { code: DepartmentResponse['code']; managerId: string | null },
    name: string,
    manager: { id: string; name: string } | null,
  ): Promise<void> {
    if (!manager) return;
    const base = { actorId: actor.id, subjectId: id };
    await this.notices.send(tx, [
      {
        ...base,
        type: 'department_manager_assigned',
        recipients: [manager.id],
        data: { department: current.code },
      },
      {
        ...base,
        type: 'responsibility_moved',
        subjectType: 'department',
        recipients: current.managerId ? [current.managerId] : [],
        data: { role: 'department_manager', record: name, holder: manager.name },
      },
    ]);
  }

  /** Rule 3: names are unique regardless of case, archived departments included. */
  private async assertNameFree(tx: Transaction, name: string, exceptId?: string): Promise<void> {
    const [taken] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(
        and(
          sql`lower(${departments.name}) = lower(${name})`,
          exceptId ? ne(departments.id, exceptId) : undefined,
        ),
      );
    if (taken) {
      throw new CodedException(409, 'DEPARTMENT_NAME_TAKEN', 'Another department has this name');
    }
  }

  /** A generated code nobody holds yet (ADR 0043). */
  private async newCode(tx: Transaction): Promise<string> {
    for (;;) {
      const code = generatedDepartmentCode(randomBytes(8));
      const [taken] = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.code, code));
      if (!taken) return code;
    }
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
  description: string | null;
  color: DepartmentResponse['color'];
  icon: string;
  position: number;
  archivedAt: Date | null;
  managerId: string | null;
  managerName: string | null;
  managerImageId: string | null;
  memberCount: number;
}): DepartmentResponse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    color: row.color,
    icon: departmentIconSchema.parse(row.icon),
    position: row.position,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    manager: row.managerId
      ? { id: row.managerId, name: row.managerName ?? '', imageId: row.managerImageId }
      : null,
    memberCount: row.memberCount,
  };
}

/** The place after the last active department (rules 2 and 16). */
async function nextPosition(tx: Transaction): Promise<number> {
  const [last] = await tx
    .select({ value: max(departments.position) })
    .from(departments)
    .where(isNull(departments.archivedAt));
  return (last?.value ?? 0) + 1;
}
