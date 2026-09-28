import { type Database, type Transaction, twoFactors, users } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { type AuditActor, recordAudit } from '../audit/index.js';

/**
 * Turns off a user's two-factor sign-in after a lost device (F01 rule 17): removes their TOTP
 * secret and backup codes. If 2FA is required for them, they set it up again at the next request.
 * Run it inside the caller's transaction.
 */
export async function resetTwoFactor(
  tx: Transaction,
  userId: string,
  actor: AuditActor | null,
): Promise<void> {
  const [user] = await tx
    .select({ enabled: users.twoFactorEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .for('update');
  if (!user) throw new Error(`Unknown user ${userId}`);
  await tx.delete(twoFactors).where(eq(twoFactors.userId, userId));
  await tx.update(users).set({ twoFactorEnabled: false }).where(eq(users.id, userId));
  await recordAudit(tx, {
    actor,
    action: 'user.two_factor_reset',
    entityType: 'user',
    entityId: userId,
    before: { twoFactorEnabled: user.enabled },
    after: { twoFactorEnabled: false },
  });
}

/** The id of the user with this email (any status), for CLI commands. */
export async function userIdByEmail(db: Database, email: string): Promise<string | null> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()));
  return user?.id ?? null;
}
