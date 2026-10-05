import { createDecipheriv, randomUUID } from 'node:crypto';
import { Controller, type INestApplication, type OnModuleInit } from '@nestjs/common';
import {
  EMAIL_DIGEST_JOB,
  EMAIL_NOTIFICATIONS_JOB,
  EMAIL_PURGE_JOB,
  EMAIL_RESULT_JOB,
  EMAIL_SEND_JOB,
  NOTIFICATIONS_DAILY_JOB,
  REDACTED,
  RETAINER_CYCLES_JOB,
} from '@vertex-hub/contracts';
import { createDatabase, emailMessages } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENV, parseEnv } from '../src/core/config/env.js';
import { JobQueue } from '../src/core/jobs/index.js';
import { Mailer } from '../src/modules/email/index.js';
import { startApp } from './start-app.js';

/*
 * The production handoff (ADR 0008): the worker schedules the queues, the API works them through
 * `JobQueue`. The other suites call job handlers directly with pg-boss off; this one turns it on.
 */

const probeQueue = `test.probe.${randomUUID().slice(0, 8)}`;
const txQueue = `test.tx.${randomUUID().slice(0, 8)}`;
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
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;

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
    await boss.deleteQueue(txQueue).catch(() => {});
    await boss.stop({ graceful: false });
    await connection.close();
  });

  it('works the queues the worker schedules', async () => {
    const queues = (await boss.getQueues()).map((queue) => queue.name);
    expect(queues).toEqual(
      expect.arrayContaining([
        RETAINER_CYCLES_JOB.queue,
        NOTIFICATIONS_DAILY_JOB.queue,
        EMAIL_RESULT_JOB.queue,
        EMAIL_PURGE_JOB.queue,
        EMAIL_NOTIFICATIONS_JOB.queue,
        EMAIL_DIGEST_JOB.queue,
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

  describe('sendInTransaction (ADR 0028: an email and its job commit together)', () => {
    const jobsWith = async (marker: string) => {
      const result = await db.execute<{ count: string }>(
        sql`select count(*) as count from pgboss.job where name = ${txQueue} and data->>'marker' = ${marker}`,
      );
      return Number(result.rows[0]?.count);
    };

    it('commits the job with the transaction', async () => {
      const jobs = app.get(JobQueue);
      await db.transaction((tx) =>
        jobs.sendInTransaction(
          tx,
          txQueue,
          { marker: 'kept', list: ['a', 'b'] },
          { retryLimit: 3 },
        ),
      );
      expect(await jobsWith('kept')).toBe(1);
    });

    it('drops the job when the transaction rolls back', async () => {
      const jobs = app.get(JobQueue);
      await expect(
        db.transaction(async (tx) => {
          await jobs.sendInTransaction(tx, txQueue, { marker: 'dropped' });
          throw new Error('change failed');
        }),
      ).rejects.toThrow('change failed');
      expect(await jobsWith('dropped')).toBe(0);
    });
  });

  it('seals token links in the job and keeps them out of the outbox row (ADR 0028)', async () => {
    const link = 'https://hub.example.com/activate#token=only-in-the-job';
    const id = await db.transaction((tx) =>
      app.get(Mailer).queue(tx, {
        kind: 'password_reset',
        to: [{ name: 'Rana', email: 'rana@example.com' }],
        subject: 'Reset',
        data: { name: 'Rana', link, expiresAt: '2026-10-05T08:00:00.000Z', requested: true },
        sender: null,
      }),
    );
    try {
      const [row] = await db.select().from(emailMessages).where(eq(emailMessages.id, id));
      expect(row?.data).toMatchObject({ link: REDACTED });
      expect(JSON.stringify(row)).not.toContain('only-in-the-job');
      const result = await db.execute<{ data: { data: { link: string }; sealed: string } }>(
        sql`select data from pgboss.job where name = ${EMAIL_SEND_JOB.queue} and data->>'id' = ${id}`,
      );
      const job = result.rows[0]?.data;
      expect(job?.data.link).toBe(REDACTED);
      const sealed = Buffer.from(job?.sealed ?? '', 'base64url');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        app.get<{ EMAIL_SECRET_KEY: Buffer }>(ENV).EMAIL_SECRET_KEY,
        sealed.subarray(0, 12),
      );
      decipher.setAuthTag(sealed.subarray(12, 28));
      const opened = Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
      expect(JSON.parse(opened.toString('utf8'))).toEqual({ link });
    } finally {
      await db.execute(sql`delete from pgboss.job where data->>'id' = ${id}`);
      await db.delete(emailMessages).where(eq(emailMessages.id, id));
    }
  });
});
