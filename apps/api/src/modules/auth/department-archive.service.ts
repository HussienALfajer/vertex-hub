import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type ArchiveDepartment,
  DEPARTMENT_TRANSFER_CATEGORIES,
  type DepartmentArchivePreview,
  type DepartmentCode,
  type DepartmentDetailResponse,
  type DepartmentTransferCategory,
  departmentSystemFunctions,
} from '@vertex-hub/contracts';
import {
  type Database,
  departmentMembers,
  departments,
  type Transaction,
  users,
} from '@vertex-hub/db';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { type AccountNotice, AccountNotices } from './account-notices.js';
import type { CurrentUserInfo } from './current-user.decorator.js';
import { auditedMembershipChange } from './department-memberships.js';
import { DepartmentTransfers, type TransferPreview } from './department-transfers.js';
import { DepartmentsService } from './departments.service.js';
import { lockAccessChanges } from './user-status.js';

interface ArchivedDepartment {
  id: string;
  code: DepartmentCode;
  name: string;
}

interface Target extends ArchivedDepartment {
  managerId: string | null;
}

/** A membership of the department being archived, archived users included. */
interface Member {
  id: string;
  name: string;
  isPrimary: boolean;
}

const actorOf = (actor: CurrentUserInfo) => ({ id: actor.id, name: actor.name });

/**
 * Archiving a department with its transfer (F23 rules 8–13). Members move here; open work moves
 * through the modules registered in `DepartmentTransfers`. Restoring is `DepartmentsService`.
 */
@Injectable()
export class DepartmentArchiveService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly departments: DepartmentsService,
    private readonly transfers: DepartmentTransfers,
    private readonly notices: AccountNotices,
  ) {}

  /** Rule 8: advisory; archiving recomputes every category (rule 12). */
  async preview(id: string): Promise<DepartmentArchivePreview> {
    return this.db.transaction(async (tx) => {
      const department = await this.lockActive(tx, id);
      const categories = await this.categories(tx, department);
      return {
        categories: DEPARTMENT_TRANSFER_CATEGORIES.map((category) => ({
          category,
          ...categories.get(category),
        })) as DepartmentArchivePreview['categories'],
        systemFunctions: [...departmentSystemFunctions(department.code)],
      };
    });
  }

  /** Rules 9 and 10: everything moves in one transaction with setting `archived_at`. */
  async archive(
    actor: CurrentUserInfo,
    id: string,
    input: ArchiveDepartment,
  ): Promise<DepartmentDetailResponse> {
    await this.db.transaction(async (tx) => {
      const department = await this.lockActive(tx, id);
      const targets = await this.lockTargets(tx, department, input);
      const categories = await this.categories(tx, department);
      const missing = DEPARTMENT_TRANSFER_CATEGORIES.filter(
        (category) => (categories.get(category)?.count ?? 0) > 0 && !targets.has(category),
      );
      if (missing.length > 0) {
        throw new CodedException(
          400,
          'TRANSFER_TARGET_REQUIRED',
          'Choose a target for every category that holds something',
          missing,
        );
      }

      // Rule 10: the manager first, so their membership can move like the others' (edge case 4).
      await tx
        .update(departments)
        .set({ managerId: null, archivedAt: new Date(), archivedById: actor.id })
        .where(eq(departments.id, id));
      const moved = new Map<DepartmentTransferCategory, number>();
      const membersTarget = targets.get('members');
      const members = membersTarget
        ? await this.moveMembers(tx, actor, department, membersTarget)
        : [];
      moved.set('members', members.length);
      for (const category of DEPARTMENT_TRANSFER_CATEGORIES) {
        const target = targets.get(category);
        if (category === 'members' || !target) continue;
        moved.set(
          category,
          await this.transfers.move(tx, category, department.code, target.code, actorOf(actor)),
        );
      }

      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'department.archived',
        entityType: 'department',
        entityId: id,
        after: {
          targets: Object.fromEntries(
            [...targets].map(([category, target]) => [
              category,
              { id: target.id, name: target.name },
            ]),
          ),
          moved: Object.fromEntries(moved),
        },
      });
      await this.notify(tx, actor, department, targets, moved, members);
    });
    return this.departments.detail(actor, id);
  }

  /** The department, locked with every access change; refused once archived (edge case 1). */
  private async lockActive(tx: Transaction, id: string): Promise<ArchivedDepartment> {
    await lockAccessChanges(tx);
    const [department] = await tx
      .select({
        id: departments.id,
        code: departments.code,
        name: departments.name,
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

  /** Rule 9 and edge case 3: every target is another active department. */
  private async lockTargets(
    tx: Transaction,
    department: ArchivedDepartment,
    input: ArchiveDepartment,
  ): Promise<Map<DepartmentTransferCategory, Target>> {
    const ids = [...new Set(Object.values(input.targets))];
    const rows =
      ids.length === 0
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
            .where(inArray(departments.id, ids))
            .for('update');
    const valid = new Map(
      rows
        .filter((row) => !row.archivedAt && row.id !== department.id)
        .map(({ archivedAt: _, ...row }) => [row.id, row]),
    );
    if (valid.size !== ids.length) {
      throw new CodedException(
        400,
        'INVALID_TRANSFER_TARGET',
        'Every target must be another active department',
      );
    }
    const targets = new Map<DepartmentTransferCategory, Target>();
    for (const category of DEPARTMENT_TRANSFER_CATEGORIES) {
      const targetId = input.targets[category];
      const target = targetId ? valid.get(targetId) : undefined;
      if (target) targets.set(category, target);
    }
    return targets;
  }

  /** Every category's count and first five records, recomputed in the transaction (rule 12). */
  private async categories(
    tx: Transaction,
    department: ArchivedDepartment,
  ): Promise<Map<DepartmentTransferCategory, TransferPreview>> {
    const members = await this.members(tx, department.id);
    const result = new Map<DepartmentTransferCategory, TransferPreview>([
      [
        'members',
        {
          count: members.length,
          items: members.slice(0, 5).map(({ id, name }) => ({ id, name })),
        },
      ],
    ]);
    for (const category of DEPARTMENT_TRANSFER_CATEGORIES) {
      if (category === 'members') continue;
      result.set(category, await this.transfers.preview(tx, category, department.code));
    }
    return result;
  }

  /** Primary members first, then by name; archived users move too, so each keeps a primary. */
  private members(tx: Transaction, departmentId: string): Promise<Member[]> {
    return tx
      .select({ id: users.id, name: users.name, isPrimary: departmentMembers.isPrimary })
      .from(departmentMembers)
      .innerJoin(users, eq(users.id, departmentMembers.userId))
      .where(eq(departmentMembers.departmentId, departmentId))
      .orderBy(desc(departmentMembers.isPrimary), asc(users.name), asc(users.id))
      .for('update', { of: departmentMembers });
  }

  /**
   * Rule 10: primary members become primary members of the target (an existing secondary row
   * there becomes primary); secondary memberships here are removed. Returns the primary members.
   */
  private async moveMembers(
    tx: Transaction,
    actor: CurrentUserInfo,
    department: ArchivedDepartment,
    target: Target,
  ): Promise<Member[]> {
    const members = await this.members(tx, department.id);
    for (const member of members) {
      await auditedMembershipChange(tx, actorOf(actor), member, async () => {
        await tx
          .delete(departmentMembers)
          .where(
            and(
              eq(departmentMembers.userId, member.id),
              eq(departmentMembers.departmentId, department.id),
            ),
          );
        if (!member.isPrimary) return;
        // The primary row was just removed, so the target row may become primary.
        await tx
          .insert(departmentMembers)
          .values({ userId: member.id, departmentId: target.id, isPrimary: true })
          .onConflictDoUpdate({
            target: [departmentMembers.userId, departmentMembers.departmentId],
            set: { isPrimary: true },
          });
      });
    }
    return members.filter((member) => member.isPrimary);
  }

  /**
   * `department_archived`: each moved member hears where they went; each target's manager once,
   * with how many records it received. Archived members are told nothing.
   */
  private async notify(
    tx: Transaction,
    actor: CurrentUserInfo,
    department: ArchivedDepartment,
    targets: Map<DepartmentTransferCategory, Target>,
    moved: Map<DepartmentTransferCategory, number>,
    members: Member[],
  ): Promise<void> {
    const notices: AccountNotice[] = [];
    const membersTarget = targets.get('members');
    if (membersTarget && members.length > 0) {
      const active = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            inArray(
              users.id,
              members.map((member) => member.id),
            ),
            isNull(users.archivedAt),
          ),
        );
      notices.push({
        type: 'department_archived',
        recipients: active.map((row) => row.id),
        actorId: actor.id,
        subjectId: membersTarget.id,
        data: { department: department.code, target: membersTarget.code, received: null },
      });
    }
    const received = new Map<string, { target: Target; count: number }>();
    for (const [category, target] of targets) {
      const count = moved.get(category) ?? 0;
      const entry = received.get(target.id) ?? { target, count: 0 };
      entry.count += count;
      received.set(target.id, entry);
    }
    for (const { target, count } of received.values()) {
      if (!target.managerId || count === 0) continue;
      notices.push({
        type: 'department_archived',
        recipients: [target.managerId],
        actorId: actor.id,
        subjectId: target.id,
        data: { department: department.code, target: target.code, received: count },
      });
    }
    await this.notices.send(tx, notices);
  }
}
