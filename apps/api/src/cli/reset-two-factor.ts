/**
 * Turns off a user's two-factor sign-in when they lost their device and backup codes and no one
 * can reset it from the app (e.g. the only General Manager, F01 edge case 5).
 *
 *   pnpm --filter @vertex-hub/api user:reset-two-factor --email a@example.com
 */
import { parseArgs } from 'node:util';
import { createDatabase, loadRootEnv } from '@vertex-hub/db';
import { z } from 'zod';
import { resetTwoFactor, userIdByEmail } from '../modules/auth/index.js';

loadRootEnv();

const { values } = parseArgs({ options: { email: { type: 'string' } } });
const parsed = z.object({ email: z.email() }).safeParse(values);
if (!parsed.success) {
  console.error(`Usage: user:reset-two-factor --email <email>\n\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env (see README).');
  process.exit(1);
}

const { db, close } = createDatabase(databaseUrl);
try {
  const email = parsed.data.email.toLowerCase();
  const userId = await userIdByEmail(db, email);
  if (!userId) {
    console.error(`No user with email ${email}.`);
    process.exitCode = 1;
  } else {
    // No actor: the audit log records CLI changes as made by the system.
    await resetTwoFactor(db, userId, null);
    process.stdout.write(`Two-factor sign-in turned off for ${email}.\n`);
  }
} finally {
  await close();
}
