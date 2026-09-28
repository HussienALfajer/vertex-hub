/**
 * Creates a user with a generated password, printed once. Until user management (F01) exists,
 * this is how the first accounts are made.
 *
 *   pnpm --filter @vertex-hub/api user:create --email a@example.com --name "Name" --role general_manager
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { roleSchema } from '@vertex-hub/contracts';
import { createDatabase, loadRootEnv } from '@vertex-hub/db';
import { z } from 'zod';
import { createUser } from '../auth/create-user.js';

const argsSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1),
  role: z.array(roleSchema).min(1),
});

loadRootEnv();

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', multiple: true },
  },
});

const parsed = argsSchema.safeParse(values);
if (!parsed.success) {
  console.error(`Usage: user:create --email <email> --name <name> --role <role> [--role <role>]
Roles: ${roleSchema.options.join(', ')}

${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env (see README).');
  process.exit(1);
}

const password = randomBytes(18).toString('base64url');
const { db, close } = createDatabase(databaseUrl);
try {
  await createUser(db, {
    email: parsed.data.email,
    name: parsed.data.name,
    roles: parsed.data.role,
    password,
  });
  process.stdout.write(
    `Created ${parsed.data.email} (${parsed.data.role.join(', ')}).\nPassword (shown once): ${password}\n`,
  );
} finally {
  await close();
}
