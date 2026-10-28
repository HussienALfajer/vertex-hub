import { departmentMembers, departments, type Transaction } from '@vertex-hub/db';
import { asc, eq } from 'drizzle-orm';
import { type AuditActor, recordAudit } from '../audit/index.js';

/** A user's memberships: department id → primary. */
export type Memberships = Map<string, boolean>;

export async function membershipsOf(tx: Transaction, userId: string): Promise<Memberships> {
  const rows = await tx
    .select({
      departmentId: departmentMembers.departmentId,
      isPrimary: departmentMembers.isPrimary,
    })
    .from(departmentMembers)
    .where(eq(departmentMembers.userId, userId));
  return new Map(rows.map((row) => [row.departmentId, row.isPrimary]));
}

const kindOf = (isPrimary: boolean) => (isPrimary ? 'primary' : 'secondary');

/**
 * F23: every membership change is written on the department it touches, from the department
 * page, the user form and the archive transfer alike (`department.member_added`,
 * `department.member_removed`, `department.primary_changed`).
 */
export async function recordMembershipChanges(
  tx: Transaction,
  actor: AuditActor | null,
  member: { id: string; name: string },
  before: Memberships,
  after: Memberships,
): Promise<void> {
  const user = { id: member.id, name: member.name };
  for (const departmentId of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(departmentId);
    const is = after.get(departmentId);
    if (was === is) continue;
    const entry = { actor, entityType: 'department' as const, entityId: departmentId };
    if (was === undefined && is !== undefined) {
      await recordAudit(tx, {
        ...entry,
        action: 'department.member_added',
        after: { user, kind: kindOf(is) },
      });
    } else if (was !== undefined && is === undefined) {
      await recordAudit(tx, {
        ...entry,
        action: 'department.member_removed',
        before: { user, kind: kindOf(was) },
      });
    } else if (was !== undefined && is !== undefined) {
      await recordAudit(tx, {
        ...entry,
        action: 'department.primary_changed',
        before: { user, kind: kindOf(was) },
        after: { user, kind: kindOf(is) },
      });
    }
  }
}

/** The departments of a user as `user.*` audit entries show them: names, not only ids. */
export interface DepartmentsSnapshot {
  primaryDepartment: { id: string; name: string } | null;
  secondaryDepartments: { id: string; name: string }[];
}

export async function departmentsSnapshot(
  tx: Transaction,
  userId: string,
): Promise<DepartmentsSnapshot> {
  const rows = await tx
    .select({
      id: departments.id,
      name: departments.name,
      isPrimary: departmentMembers.isPrimary,
    })
    .from(departmentMembers)
    .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
    .where(eq(departmentMembers.userId, userId))
    .orderBy(asc(departments.name));
  const primary = rows.find((row) => row.isPrimary);
  return {
    primaryDepartment: primary ? { id: primary.id, name: primary.name } : null,
    secondaryDepartments: rows
      .filter((row) => !row.isPrimary)
      .map(({ id, name }) => ({ id, name })),
  };
}

/**
 * Runs a membership change from the department page or an archive, and audits it as the user
 * form does: `user.departments_changed` on the user and the `department.*` entries.
 */
export async function auditedMembershipChange(
  tx: Transaction,
  actor: AuditActor | null,
  member: { id: string; name: string },
  change: () => Promise<void>,
): Promise<{ before: Memberships; after: Memberships }> {
  const snapshot = await departmentsSnapshot(tx, member.id);
  const before = await membershipsOf(tx, member.id);
  await change();
  const after = await membershipsOf(tx, member.id);
  await recordAudit(tx, {
    actor,
    action: 'user.departments_changed',
    entityType: 'user',
    entityId: member.id,
    before: { ...snapshot },
    after: { ...(await departmentsSnapshot(tx, member.id)) },
  });
  await recordMembershipChanges(tx, actor, member, before, after);
  return { before, after };
}
