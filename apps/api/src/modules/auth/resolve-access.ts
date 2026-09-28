import {
  ASSIGNABLE_ROLES,
  type AssignableRole,
  effectiveRoles,
  type MeResponse,
  twoFactorRequired,
  type UserAccess,
} from '@vertex-hub/contracts';
import {
  type Database,
  departmentMembers,
  departments,
  type Transaction,
  userRoles,
  users,
} from '@vertex-hub/db';
import { asc, desc, eq } from 'drizzle-orm';

/** A user's access, computed on every request so changes apply at once (ADR 0014). */
export interface ResolvedAccess {
  access: UserAccess;
  departments: MeResponse['departments'];
  twoFactor: MeResponse['twoFactor'];
}

function isAssignable(role: string): role is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

/** The access of a usable account; `null` when the user does not exist or is archived. */
export async function resolveAccess(
  db: Database | Transaction,
  userId: string,
): Promise<ResolvedAccess | null> {
  const [user] = await db
    .select({ archivedAt: users.archivedAt, twoFactorEnabled: users.twoFactorEnabled })
    .from(users)
    .where(eq(users.id, userId));
  if (!user || user.archivedAt) return null;

  const [assigned, memberships] = await Promise.all([
    db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId)),
    db
      .select({
        id: departments.id,
        code: departments.code,
        name: departments.name,
        isPrimary: departmentMembers.isPrimary,
        managerId: departments.managerId,
      })
      .from(departmentMembers)
      .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
      .where(eq(departmentMembers.userId, userId))
      .orderBy(desc(departmentMembers.isPrimary), asc(departments.name)),
  ]);

  const positions = memberships.map(({ managerId, ...department }) => ({
    ...department,
    isManager: managerId === userId,
  }));
  const access: UserAccess = {
    roles: effectiveRoles(assigned.map((row) => row.role).filter(isAssignable), positions),
    departments: positions.map(({ code, isManager }) => ({ code, isManager })),
  };
  return {
    access,
    departments: positions,
    twoFactor: { enabled: user.twoFactorEnabled, required: twoFactorRequired(access) },
  };
}
