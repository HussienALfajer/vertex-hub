import type { Role } from '@vertex-hub/contracts';
import { accounts, type Database, newId, userRoles, users } from '@vertex-hub/db';
import { hashPassword } from 'better-auth/crypto';
import { MIN_PASSWORD_LENGTH } from './auth.config.js';

export interface NewUser {
  name: string;
  email: string;
  password: string;
  roles: Role[];
}

/**
 * Creates a user who signs in with email and password, stored the way Better Auth expects
 * (a `credential` account holding the password hash). Self sign-up is disabled, so this is how
 * accounts are created until user management (F01) exists.
 */
export async function createUser(db: Database, input: NewUser): Promise<{ id: string }> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const id = newId();
    await tx.insert(users).values({
      id,
      name: input.name,
      email: input.email.toLowerCase(),
      emailVerified: true,
    });
    await tx
      .insert(accounts)
      .values({ userId: id, accountId: id, providerId: 'credential', password: passwordHash });
    if (input.roles.length > 0) {
      await tx.insert(userRoles).values(input.roles.map((role) => ({ userId: id, role })));
    }
    return { id };
  });
}
