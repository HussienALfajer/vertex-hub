import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NOTIFICATIONS_DAILY_JOB, RETAINER_CYCLES_JOB } from '@vertex-hub/contracts';
import { type Database, workerHeartbeats } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV, type Env } from '../src/core/config/env.js';
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

  it('schedules the daily retainer cycle run in Damascus time, once however often it boots', async () => {
    const { queue, cron, tz } = RETAINER_CYCLES_JOB;
    const boss = app.get(PgBossService).boss;
    // The API works this queue; scheduling it again (a restart) keeps one schedule.
    await boss.schedule(queue, cron, null, { tz });
    expect(await boss.getSchedules(queue)).toEqual([
      expect.objectContaining({ cron, timezone: tz }),
    ]);
  });

  it('schedules the daily notifications run at 09:00 Damascus time on work days', async () => {
    const { queue, cron, tz } = NOTIFICATIONS_DAILY_JOB;
    expect(cron).toBe('0 9 * * 0-4,6');
    expect(await app.get(PgBossService).boss.getSchedules(queue)).toEqual([
      expect.objectContaining({ cron, timezone: tz }),
    ]);
  });

  it('heartbeat is idempotent: repeated runs keep one row with the latest time', async () => {
    // A worker name of its own: the live schedule beats every minute on `worker`'s row and would
    // overwrite the fixed times between the two beats and the read.
    const name = `${worker}-idempotent`;
    const job = new HeartbeatJob(app.get(PgBossService), db, {
      ...app.get<Env>(ENV),
      WORKER_NAME: name,
    });
    try {
      await job.beat(new Date('2026-09-28T10:00:00.000Z'));
      await job.beat(new Date('2026-09-28T10:01:00.000Z'));
      expect(
        await db.select().from(workerHeartbeats).where(eq(workerHeartbeats.worker, name)),
      ).toEqual([{ worker: name, beatAt: new Date('2026-09-28T10:01:00.000Z') }]);
    } finally {
      await db.delete(workerHeartbeats).where(eq(workerHeartbeats.worker, name));
    }
  });

  it('processes a queued heartbeat job', async () => {
    const before = Date.now();
    await app.get(PgBossService).boss.send(HEARTBEAT_QUEUE);
    await expect
      .poll(async () => (await heartbeat())[0]?.beatAt.getTime() ?? 0, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(before - 1_000);
  });
});
