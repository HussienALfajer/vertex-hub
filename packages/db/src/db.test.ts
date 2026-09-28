import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';
import { pingDatabase } from './health.js';
import { workerHeartbeats } from './schema/index.js';

const connection = createDatabase(process.env.DATABASE_URL as string);

afterAll(() => connection.close());

describe('database', () => {
  it('answers a ping', async () => {
    expect(await pingDatabase(connection.db)).toBe(true);
  });

  it('reports an unreachable database as down instead of throwing', async () => {
    const unreachable = createDatabase('postgres://nobody:nothing@127.0.0.1:1/none');
    try {
      expect(await pingDatabase(unreachable.db)).toBe(false);
    } finally {
      await unreachable.close();
    }
  });

  it('has the worker_heartbeats table from the first migration', async () => {
    const worker = `test-${crypto.randomUUID()}`;
    const beatAt = new Date('2026-09-28T10:00:00.000Z');
    await connection.db.insert(workerHeartbeats).values({ worker, beatAt });
    const rows = await connection.db
      .select()
      .from(workerHeartbeats)
      .where(eq(workerHeartbeats.worker, worker));
    expect(rows).toEqual([{ worker, beatAt }]);
    await connection.db.delete(workerHeartbeats).where(eq(workerHeartbeats.worker, worker));
  });
});
