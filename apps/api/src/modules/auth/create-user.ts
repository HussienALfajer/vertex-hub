import type { AssignableRole, DepartmentCode } from '@vertex-hub/contracts';
import {
  accounts,
  type Database,
  departmentMembers,
  departments,
  newId,
  userRoles,
  users,
} from '@vertex-hub/db';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { MIN_PASSWORD_LENGTH } from './auth.config.js';

export interface NewUser {
  name: string;
  email: string;
  password: string;
  roles: AssignableRole[];
  department: DepartmentCode;
}

/**
 * Creates an active user who signs in with email and password, stored the way Better Auth
 * expects (a `credential` account holding the password hash), with a primary department.
 * Used by the `user:create` CLI to bootstrap the first General Manager.
 */
export async function createUser(
  db: Database,
  input: NewUser,
  actor: AuditActor | null,
): Promise<{ id: string }> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [department] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.code, input.department));
    if (!department) throw new Error(`Unknown department ${input.department}`);

    const id = newId();
    const email = input.email.toLowerCase();
    await tx.insert(users).values({ id, name: input.name, email, emailVerified: true });
    await tx
      .insert(accounts)
      .values({ userId: id, accountId: id, providerId: 'credential', password: passwordHash });
    await tx
      .insert(departmentMembers)
      .values({ userId: id, departmentId: department.id, isPrimary: true });
    if (input.roles.length > 0) {
      await tx.insert(userRoles).values(input.roles.map((role) => ({ userId: id, role })));
    }
    await recordAudit(tx, {
      actor,
      action: 'user.created',
      entityType: 'user',
      entityId: id,
      after: {
        name: input.name,
        email,
        roles: input.roles,
        primaryDepartmentId: department.id,
      },
    });
    return { id };
  });
}
