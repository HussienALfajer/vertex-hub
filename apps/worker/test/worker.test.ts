import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Database, workerHeartbeats } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE } from '../src/core/database/database.module.js';
import { HEARTBEAT_CRON, HEARTBEAT_QUEUE, HeartbeatJob } from '../src/jobs/heartbeat.job.js';
import { PgBossService } from '../src/jobs/pg-boss.service.js';
import { WorkerModule } from '../src/worker.module.js';

// WORKER_NAME is unique per run (see vitest.config.ts), so rows never collide between runs.
const worker = process.env.WORKER_NAME as string;

describe('worker against the test database', () => {
  let app: INestApplicationContext;
  let db: Database;

  const heartbeat = async () =>
    db.select().from(workerHeartbeats).where(eq(workerHeartbeats.worker, worker));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DATABASE);
  });

  afterAll(async () => {
    await db.delete(workerHeartbeats).where(eq(workerHeartbeats.worker, worker));
    await app.close();
  });

  it('registers the heartbeat schedule in pg-boss', async () => {
    const schedules = await app.get(PgBossService).boss.getSchedules(HEARTBEAT_QUEUE);
    expect(schedules).toEqual([expect.objectContaining({ cron: HEARTBEAT_CRON })]);
  });

  it('heartbeat is idempotent: repeated runs keep one row with the latest time', async () => {
    const job = app.get(HeartbeatJob);
    await job.beat(new Date('2026-09-28T10:00:00.000Z'));
    await job.beat(new Date('2026-09-28T10:01:00.000Z'));
    expect(await heartbeat()).toEqual([{ worker, beatAt: new Date('2026-09-28T10:01:00.000Z') }]);
  });

  it('processes a queued heartbeat job', async () => {
    const before = Date.now();
    await app.get(PgBossService).boss.send(HEARTBEAT_QUEUE);
    await expect
      .poll(async () => (await heartbeat())[0]?.beatAt.getTime() ?? 0, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(before - 1_000);
  });
});
