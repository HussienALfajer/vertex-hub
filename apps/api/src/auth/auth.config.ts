import { accounts, type Database, newId, sessions, users, verifications } from '@vertex-hub/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Env } from '../config/env.js';

export const AUTH_BASE_PATH = '/api/auth';

/** Minimum length for new passwords (NIST SP 800-63B favours length over composition rules). */
export const MIN_PASSWORD_LENGTH = 12;

export function createAuth(db: Database, env: Env) {
  return betterAuth({
    appName: 'Vertex Hub',
    baseURL: env.APP_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    // Accounts are created by staff with user management rights (F01), never by self sign-up.
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      database: { generateId: () => newId() },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
