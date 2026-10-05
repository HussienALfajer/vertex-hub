import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { deviceOf, type SecurityChange, type UserLink } from '@vertex-hub/contracts';
import { type Database, type Transaction, userDevices, users } from '@vertex-hub/db';
import {
  accountActivationEmail,
  newDeviceEmail,
  passwordResetEmail,
  securityNoticeEmail,
} from '@vertex-hub/messages';
import { and, count, eq, ne, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { Mailer } from '../email/index.js';

/**
 * The account emails of F14 email (rules 13–15): links, security notices and sign-ins from a
 * new device. Queued in the transaction of the change; they go to the address the user has at
 * that moment (edge case 7).
 */
@Injectable()
export class AccountEmails {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly mailer: Mailer,
  ) {}

  /** Rule 13: an activation or reset link, also returned once for copying. */
  async link(
    tx: Transaction,
    userId: string,
    link: UserLink,
    options: { restored?: boolean; requested?: boolean } = {},
  ): Promise<void> {
    const user = await this.user(tx, userId);
    const base = { name: user.name, link: link.url, expiresAt: link.expiresAt };
    if (link.kind === 'activation') {
      const data = { ...base, restored: options.restored ?? false };
      await this.mailer.queue(tx, {
        kind: 'account_activation',
        to: [address(user)],
        subject: accountActivationEmail(data).subject,
        data,
        sender: null,
      });
      return;
    }
    const data = { ...base, requested: options.requested ?? false };
    await this.mailer.queue(tx, {
      kind: 'password_reset',
      to: [address(user)],
      subject: passwordResetEmail(data).subject,
      data,
      sender: null,
    });
  }

  /** Rule 14: what changed and by whom (`by` null: the user themselves); never switched off. */
  async securityNotice(
    tx: Transaction,
    userId: string,
    change: SecurityChange,
    by: string | null,
  ): Promise<void> {
    const user = await this.user(tx, userId);
    const data = { name: user.name, change, at: new Date().toISOString(), by };
    await this.mailer.queue(tx, {
      kind: 'security_notice',
      to: [address(user)],
      subject: securityNoticeEmail(data).subject,
      data,
      sender: null,
    });
  }

  /**
   * Rule 15: records the device of a new session. A device the user has not used gets a
   * new-device email, except on their very first sign-in; a known one is seen again.
   */
  async signedIn(session: {
    userId: string;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<void> {
    const device = deviceOf(session.userAgent);
    const deviceKey = createHash('sha256')
      .update(`${device.browser}\n${device.system}`)
      .digest('hex');
    await this.db.transaction(async (tx) => {
      const now = new Date();
      const added = await tx
        .insert(userDevices)
        .values({
          userId: session.userId,
          deviceKey,
          label: device.label,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: [userDevices.userId, userDevices.deviceKey],
          set: { lastSeenAt: now },
        })
        // PostgreSQL sets `xmax` only on the conflict path: 0 means the row was inserted.
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      if (!added[0]?.inserted) return;
      const [others] = await tx
        .select({ value: count() })
        .from(userDevices)
        .where(and(eq(userDevices.userId, session.userId), ne(userDevices.deviceKey, deviceKey)));
      if (!others?.value) return;
      const user = await this.user(tx, session.userId);
      const data = {
        name: user.name,
        device: device.label,
        ip: session.ipAddress || null,
        at: now.toISOString(),
      };
      await this.mailer.queue(tx, {
        kind: 'new_device',
        to: [address(user)],
        subject: newDeviceEmail(data).subject,
        data,
        sender: null,
      });
    });
  }

  private async user(tx: Transaction, id: string) {
    const [user] = await tx
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, id));
    if (!user) throw new Error(`User ${id} not found`);
    return user;
  }
}

const address = (user: { id: string; name: string; email: string }) => ({
  name: user.name,
  email: user.email,
  userId: user.id,
});
