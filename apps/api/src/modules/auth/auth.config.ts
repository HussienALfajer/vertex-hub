import type { ErrorCode } from '@vertex-hub/contracts';
import {
  accounts,
  type Database,
  newId,
  sessions,
  twoFactors,
  users,
  verifications,
} from '@vertex-hub/db';
import { BASE_ERROR_CODES, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import type { Env } from '../../core/config/env.js';
import { recordAudit } from '../audit/index.js';
import { resolveAccess } from './resolve-access.js';

export const AUTH_BASE_PATH = '/api/auth';

/** Minimum length for new passwords (NIST SP 800-63B favours length over composition rules). */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Better Auth endpoints Vertex Hub does not use. Profile, email and password-reset changes go
 * through the API's own endpoints (F01); there is no social sign-in and no emailed OTP.
 */
const DISABLED_PATHS = [
  '/sign-up/email',
  '/sign-in/social',
  '/update-user',
  '/change-email',
  '/delete-user',
  '/delete-user/callback',
  '/request-password-reset',
  '/reset-password',
  '/verify-email',
  '/send-verification-email',
  '/update-session',
  '/link-social',
  '/unlink-account',
  '/refresh-token',
  '/get-access-token',
  '/account-info',
  '/two-factor/send-otp',
  '/two-factor/verify-otp',
];

/**
 * Unused endpoints with a path parameter. `disabledPaths` matches literal paths only, so these
 * are refused by route template in the before hook.
 */
const DISABLED_ROUTES = ['/callback/:id', '/reset-password/:token'];

/** Paths open to a user who must set up two-factor sign-in and has not yet (F01 rule 15). */
const OPEN_WHILE_TWO_FACTOR_PENDING = ['/get-session', '/sign-out', '/two-factor/'];

/** Paths that turn two-factor sign-in on or off for the signed-in user; audited. */
const TWO_FACTOR_SWITCHES = ['/two-factor/verify-totp', '/two-factor/disable'];

function twoFactorRequiredError() {
  const code: ErrorCode = 'TWO_FACTOR_REQUIRED';
  return new APIError('FORBIDDEN', { code, message: 'Two-factor sign-in is required' });
}

export function createAuth(db: Database, env: Env) {
  /** 2FA state of each session token before a switch request, to audit real changes only. */
  const twoFactorBefore = new Map<string, boolean>();

  async function twoFactorEnabled(userId: string): Promise<boolean> {
    const [user] = await db
      .select({ enabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.id, userId));
    return user?.enabled ?? false;
  }

  return betterAuth({
    appName: 'Vertex Hub',
    baseURL: env.APP_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        twoFactor: twoFactors,
      },
    }),
    // Accounts are created by user managers (F01), never by self sign-up.
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    disabledPaths: DISABLED_PATHS,
    // Memory storage is enough: the API runs as one process (deploy/ecosystem.config.cjs).
    rateLimit: {
      enabled: true,
      storage: 'memory',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
        '/two-factor/verify-backup-code': { window: 60, max: 5 },
      },
    },
    plugins: [
      twoFactor({
        issuer: 'Vertex Hub',
        skipVerificationOnEnable: false,
        backupCodeOptions: { amount: 10 },
      }),
    ],
    databaseHooks: {
      session: {
        create: {
          // Covers every way to get a session, including the 2FA step after the password step.
          before: async (session) => {
            const [user] = await db
              .select({ archivedAt: users.archivedAt })
              .from(users)
              .where(eq(users.id, session.userId));
            if (!user || user.archivedAt) {
              throw APIError.from('UNAUTHORIZED', BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD);
            }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (DISABLED_ROUTES.includes(ctx.path)) throw new APIError('NOT_FOUND');
        if (ctx.path === '/sign-in/email') {
          // An archived user gets the same error as a wrong password (F01 rule 10).
          const email = typeof ctx.body?.email === 'string' ? ctx.body.email.toLowerCase() : '';
          const [user] = await db
            .select({ archivedAt: users.archivedAt })
            .from(users)
            .where(eq(users.email, email));
          if (user?.archivedAt) {
            throw APIError.from('UNAUTHORIZED', BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD);
          }
          return;
        }
        // No "trust this device": the code is asked at every sign-in (F01 rule 16).
        if (ctx.body?.trustDevice) {
          throw new APIError('BAD_REQUEST', { message: 'Trusted devices are not supported' });
        }

        const session = await getSessionFromCtx(ctx);
        if (!session) return;
        const resolved = await resolveAccess(db, session.user.id);
        if (!resolved) {
          // An archived user's leftover session can only sign out (F01 rule 10). Reading the
          // session stays open: the API guard needs it and refuses the user itself.
          if (ctx.path === '/sign-out' || ctx.path === '/get-session') return;
          throw new APIError('UNAUTHORIZED');
        }
        const { required, enabled } = resolved.twoFactor;
        if (required && ctx.path === '/two-factor/disable') throw twoFactorRequiredError();
        if (
          required &&
          !enabled &&
          !OPEN_WHILE_TWO_FACTOR_PENDING.some((open) => ctx.path.startsWith(open))
        ) {
          throw twoFactorRequiredError();
        }
        if (TWO_FACTOR_SWITCHES.includes(ctx.path)) {
          twoFactorBefore.set(session.session.token, enabled);
        }
      }),
      // Changes made inside Better Auth are audited right after they commit (F01 rule 22).
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/change-password' && !TWO_FACTOR_SWITCHES.includes(ctx.path)) return;
        const session = ctx.context.session ?? (await getSessionFromCtx(ctx));
        if (!session) return;
        const actor = { id: session.user.id, name: session.user.name };

        if (ctx.path === '/change-password') {
          if (ctx.context.returned instanceof APIError) return;
          await recordAudit(db, {
            actor,
            action: 'user.password_changed',
            entityType: 'user',
            entityId: actor.id,
          });
          return;
        }

        const before = twoFactorBefore.get(session.session.token);
        twoFactorBefore.delete(session.session.token);
        const after = await twoFactorEnabled(actor.id);
        if (before === undefined || before === after) return;
        await recordAudit(db, {
          actor,
          action: after ? 'user.two_factor_enabled' : 'user.two_factor_disabled',
          entityType: 'user',
          entityId: actor.id,
          before: { twoFactorEnabled: before },
          after: { twoFactorEnabled: after },
        });
      }),
    },
    advanced: {
      database: { generateId: () => newId() },
      // nginx overwrites X-Forwarded-For with the client address (deploy/nginx).
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
