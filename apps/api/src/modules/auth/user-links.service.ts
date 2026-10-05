import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RedeemLink, RequestPasswordLink, UserLink } from '@vertex-hub/contracts';
import {
  accounts,
  type Database,
  sessions,
  type Transaction,
  users,
  verifications,
} from '@vertex-hub/db';
import { hashPassword } from 'better-auth/crypto';
import { and, eq, gt, isNull, like, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../core/config/env.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { AccountEmails } from './account-emails.js';
import { hasPassword } from './user-status.js';

/** Links expire after 72 hours (F01 rule 13). */
const LINK_LIFETIME_MS = 72 * 60 * 60 * 1000;

/**
 * F14 email rule 13: a link the user asks for lasts 1 hour, and at most 3 requests per user an
 * hour are honoured.
 */
export const SELF_SERVICE_LINKS = { lifetimeMs: 60 * 60 * 1000, perHour: 3 } as const;

const HOUR_MS = 60 * 60 * 1000;

/** Identifier prefix in `verifications`; the rest is the SHA-256 of the token. */
const LINK_PREFIX = 'user-link:';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * One-time activation and password reset links (F01 rules 13–14). Only a hash of the token is
 * stored; the link is shown once to the user manager and emailed to the user (F14 email rule 13).
 */
@Injectable()
export class UserLinksService {
  private readonly logger = new Logger(UserLinksService.name);
  /** Honoured self-service requests per user, for the last hour; one API process. */
  private readonly requests = new Map<string, number[]>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly emails: AccountEmails,
  ) {}

  /** Issues a new link and invalidates the user's earlier ones. */
  async issue(
    tx: Transaction,
    userId: string,
    kind: UserLink['kind'],
    lifetimeMs: number = LINK_LIFETIME_MS,
  ): Promise<UserLink> {
    await this.revoke(tx, userId);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + lifetimeMs);
    await tx
      .insert(verifications)
      .values({ identifier: `${LINK_PREFIX}${digest(token)}`, value: userId, expiresAt });
    // The token goes in the fragment, which browsers never send, so it stays out of server logs.
    const url = new URL('/activate', this.env.APP_URL);
    url.hash = new URLSearchParams({ token }).toString();
    return { url: url.toString(), expiresAt: expiresAt.toISOString(), kind };
  }

  /**
   * F14 email rule 13, "forgot password": emails an active user a reset link valid for 1 hour.
   * Invited, archived and unknown addresses get nothing, and the caller never learns which: the
   * answer does not wait for the lookup, the link or its email, so its time is the same for
   * every address.
   */
  request({ email }: RequestPasswordLink): void {
    void this.sendRequested(email, Date.now()).catch((error: unknown) => {
      this.logger.error(error, 'Could not send a requested reset link');
    });
  }

  private async sendRequested(email: string, now: number): Promise<void> {
    const [user] = await this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(
          sql`lower(${users.email}) = ${email.trim().toLowerCase()}`,
          isNull(users.archivedAt),
          hasPassword,
        ),
      );
    if (!user) return;
    const recent = (this.requests.get(user.id) ?? []).filter((at) => at > now - HOUR_MS);
    if (recent.length >= SELF_SERVICE_LINKS.perHour) return;
    this.requests.set(user.id, [...recent, now]);
    await this.db.transaction(async (tx) => {
      const link = await this.issue(tx, user.id, 'reset', SELF_SERVICE_LINKS.lifetimeMs);
      await recordAudit(tx, {
        actor: { id: user.id, name: user.name },
        action: 'user.link_issued',
        entityType: 'user',
        entityId: user.id,
        after: { kind: 'reset' },
      });
      await this.emails.link(tx, user.id, link, { requested: true });
    });
  }

  /** Invalidates every pending link of the user. */
  async revoke(tx: Transaction, userId: string): Promise<void> {
    await tx
      .delete(verifications)
      .where(
        and(like(verifications.identifier, `${LINK_PREFIX}%`), eq(verifications.value, userId)),
      );
  }

  /**
   * Sets the password through a link: the user becomes active, the link is used up and every
   * session of the user ends (F01 rule 13).
   */
  async redeem({ token, password }: RedeemLink): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [link] = await tx
        .select({ userId: verifications.value })
        .from(verifications)
        .where(
          and(
            eq(verifications.identifier, `${LINK_PREFIX}${digest(token)}`),
            gt(verifications.expiresAt, new Date()),
          ),
        )
        .for('update');
      const [user] = link
        ? await tx
            .select({ id: users.id, name: users.name, archivedAt: users.archivedAt })
            .from(users)
            .where(eq(users.id, link.userId))
        : [];
      if (!user || user.archivedAt) {
        throw new CodedException(400, 'LINK_INVALID', 'The link is invalid or has expired');
      }
      // Hashed only for a valid link: an anonymous request with a made-up token costs no scrypt.
      const passwordHash = await hashPassword(password);

      const [account] = await tx
        .select({ id: accounts.id, password: accounts.password })
        .from(accounts)
        .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, 'credential')));
      if (account) {
        await tx
          .update(accounts)
          .set({ password: passwordHash })
          .where(eq(accounts.id, account.id));
      } else {
        await tx.insert(accounts).values({
          userId: user.id,
          accountId: user.id,
          providerId: 'credential',
          password: passwordHash,
        });
      }
      await this.revoke(tx, user.id);
      await tx.delete(sessions).where(eq(sessions.userId, user.id));
      await recordAudit(tx, {
        actor: { id: user.id, name: user.name },
        action: 'user.password_set',
        entityType: 'user',
        entityId: user.id,
      });
      // F14 email rule 14: a reset changes a password; an activation sets the first one.
      if (account?.password)
        await this.emails.securityNotice(tx, user.id, 'password_changed', null);
    });
  }
}
