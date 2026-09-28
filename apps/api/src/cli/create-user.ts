/**
 * Creates an active user with a generated password, printed once. Used to bootstrap the first
 * General Manager; everyone else is created from the team screens (F01).
 *
 *   pnpm --filter @vertex-hub/api user:create --email a@example.com --name "Name" \
 *     --department general_management --role general_manager
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { assignableRoleSchema, departmentCodeSchema } from '@vertex-hub/contracts';
import { createDatabase, loadRootEnv } from '@vertex-hub/db';
import { z } from 'zod';
import { createUser } from '../modules/auth/index.js';

const argsSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(100),
  department: departmentCodeSchema,
  role: z.array(assignableRoleSchema).default([]),
});

loadRootEnv();

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    department: { type: 'string' },
    role: { type: 'string', multiple: true },
  },
});

const parsed = argsSchema.safeParse(values);
if (!parsed.success) {
  console.error(`Usage: user:create --email <email> --name <name> --department <code> [--role <role>]...
Departments: ${departmentCodeSchema.options.join(', ')}
Roles: ${assignableRoleSchema.options.join(', ')}

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
  // No actor: the audit log records CLI changes as made by the system.
  await createUser(
    db,
    {
      email: parsed.data.email,
      name: parsed.data.name,
      department: parsed.data.department,
      roles: parsed.data.role,
      password,
    },
    null,
  );
  const roles = parsed.data.role.length > 0 ? parsed.data.role.join(', ') : 'no assigned roles';
  process.stdout.write(
    `Created ${parsed.data.email} (${parsed.data.department}; ${roles}).\nPassword (shown once): ${password}\n`,
  );
} finally {
  await close();
}
