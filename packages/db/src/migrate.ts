import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.js';

export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

export async function runMigrations(connectionString: string): Promise<void> {
  const { db, close } = createDatabase(connectionString);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}
