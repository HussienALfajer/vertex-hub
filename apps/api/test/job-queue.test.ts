import { randomUUID } from 'node:crypto';
import { Controller, type INestApplication, type OnModuleInit } from '@nestjs/common';
import { NOTIFICATIONS_DAILY_JOB, RETAINER_CYCLES_JOB } from '@vertex-hub/contracts';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV, parseEnv } from '../src/core/config/env.js';
import { JobQueue } from '../src/core/jobs/index.js';
import { startApp } from './start-app.js';

/*
 * The production handoff (ADR 0008): the worker schedules the queues, the API works them through
 * `JobQueue`. The other suites call job handlers directly with pg-boss off; this one turns it on.
 */

const probeQueue = `test.probe.${randomUUID().slice(0, 8)}`;
let probeRan: () => void = () => {};
const probe = new Promise<void>((resolve) => {
  probeRan = resolve;
});

/** Registers a handler the way a module service does, in `onModuleInit`. */
@Controller()
class ProbeJob implements OnModuleInit {
  constructor(private readonly jobs: JobQueue) {}

  onModuleInit(): void {
    this.jobs.work(probeQueue, async () => probeRan());
  }
}

describe('job queue', () => {
  let app: INestApplication;
  const boss = new PgBoss(testDatabaseUrl());

  beforeAll(async () => {
    ({ app } = await startApp({
      controllers: [ProbeJob],
      override: (builder) =>
        builder.overrideProvider(ENV).useValue({ ...parseEnv(), JOBS_ENABLED: true }),
    }));
    await boss.start();
  });

  afterAll(async () => {
    await app?.close();
    await boss.deleteQueue(probeQueue).catch(() => {});
    await boss.stop({ graceful: false });
  });

  it('works the queues the worker schedules', async () => {
    const queues = (await boss.getQueues()).map((queue) => queue.name);
    expect(queues).toEqual(
      expect.arrayContaining([
        RETAINER_CYCLES_JOB.queue,
        NOTIFICATIONS_DAILY_JOB.queue,
        probeQueue,
      ]),
    );
  });

  it('runs the registered handler for a job sent by another process', async () => {
    await boss.send(probeQueue, {});
    await expect(
      Promise.race([
        probe.then(() => 'ran'),
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 15_000)),
      ]),
    ).resolves.toBe('ran');
  }, 20_000);
});
