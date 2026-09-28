import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { RedeemLink, UserLink } from '@vertex-hub/contracts';
import {
  accounts,
  type Database,
  sessions,
  type Transaction,
  users,
  verifications,
} from '@vertex-hub/db';
import { hashPassword } from 'better-auth/crypto';
import { and, eq, gt, like } from 'drizzle-orm';
import { ENV, type Env } from '../../core/config/env.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';

/** Links expire after 72 hours (F01 rule 13). */
const LINK_LIFETIME_MS = 72 * 60 * 60 * 1000;

/** Identifier prefix in `verifications`; the rest is the SHA-256 of the token. */
const LINK_PREFIX = 'user-link:';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * One-time activation and password reset links (F01 rules 13–14). Only a hash of the token is
 * stored; the link itself is shown once to the user manager, who sends it by hand.
 */
@Injectable()
export class UserLinksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Issues a new link and invalidates the user's earlier ones. */
  async issue(tx: Transaction, userId: string, kind: UserLink['kind']): Promise<UserLink> {
    await this.revoke(tx, userId);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_LIFETIME_MS);
    await tx
      .insert(verifications)
      .values({ identifier: `${LINK_PREFIX}${digest(token)}`, value: userId, expiresAt });
    // The token goes in the fragment, which browsers never send, so it stays out of server logs.
    const url = new URL('/activate', this.env.APP_URL);
    url.hash = new URLSearchParams({ token }).toString();
    return { url: url.toString(), expiresAt: expiresAt.toISOString(), kind };
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
    const passwordHash = await hashPassword(password);
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

      const [account] = await tx
        .select({ id: accounts.id })
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
    });
  }
}
