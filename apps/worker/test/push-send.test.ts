import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PushResultJob, PushSendJob } from '@vertex-hub/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { parseEnv } from '../src/core/config/env.js';
import type { PgBossService } from '../src/jobs/pg-boss.service.js';
import { PushSendJob as PushSendWorker } from '../src/jobs/push-send.job.js';
import { PushSender } from '../src/push/push-sender.js';

const vapid = webpush.generateVAPIDKeys();

/** A browser's subscription keys: a P-256 public key and a 16-byte auth secret. */
function browserKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

const deliveryId = '0190a3c2-0000-7000-8000-0000000000d1';

function job(endpoint: string): PushSendJob {
  return {
    subscription: { endpoint, keys: browserKeys() },
    urgency: 'high',
    ttlSeconds: 43_200,
    payload: {
      kind: 'notification',
      deliveryId,
      notificationId: '0190a3c2-0000-7000-8000-0000000000a1',
      title: 'مطعم الشام',
      body: 'أُسندت إليك «تصميم منيو» بواسطة رنا',
      link: '/tasks/0190a3c2-0000-7000-8000-0000000000b1',
      tag: 'task:0190a3c2-0000-7000-8000-0000000000b1:task_assigned',
      requireInteraction: false,
      unreadCount: 3,
      close: [],
    },
  };
}

/** A fake push service: answers each request with the next status and keeps what it received. */
let statuses: number[] = [];
const received: { url: string; headers: IncomingMessage['headers']; body: Buffer }[] = [];
let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
      response.statusCode = statuses.shift() ?? 201;
      response.end(response.statusCode >= 400 ? 'refused' : '');
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
});

beforeEach(() => {
  statuses = [];
  received.length = 0;
});

const sender = () =>
  new PushSender({
    PUSH_TRANSPORT: 'webpush',
    PUSH_LOG_DIR: '.data/push',
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: 'mailto:info@vertexmedia.pro',
  });

describe('push sender (spec F16 rule A8)', () => {
  it('sends an encrypted message with the urgency, TTL and a signed VAPID header', async () => {
    expect(await sender().send(job(`${origin}/push/abc`))).toEqual({ status: 'sent' });
    const [request] = received;
    expect(request?.url).toBe('/push/abc');
    expect(request?.headers).toMatchObject({
      ttl: '43200',
      urgency: 'high',
      'content-encoding': 'aes128gcm',
    });
    // The payload is encrypted: its text never travels in the clear.
    expect(request?.body.includes(Buffer.from('مطعم الشام'))).toBe(false);

    // `vapid t=<JWT>, k=<public key>`: an ES256 token for the push service's origin.
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(request?.headers.authorization ?? '');
    expect(match?.[2]).toBe(vapid.publicKey);
    const [header, claims, signature] = (match?.[1] ?? '').split('.');
    expect(JSON.parse(Buffer.from(claims ?? '', 'base64url').toString())).toMatchObject({
      aud: origin,
      sub: 'mailto:info@vertexmedia.pro',
    });
    const point = Buffer.from(vapid.publicKey, 'base64url');
    const key = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33, 65).toString('base64url'),
      },
      format: 'jwk',
    });
    const signed = verify(
      'sha256',
      Buffer.from(`${header}.${claims}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature ?? '', 'base64url'),
    );
    expect(signed).toBe(true);
  });

  it('reports 404 and 410 as gone, and throws on other refusals', async () => {
    statuses = [404, 410, 500];
    expect(await sender().send(job(`${origin}/a`))).toMatchObject({ status: 'gone' });
    expect(await sender().send(job(`${origin}/b`))).toMatchObject({ status: 'gone' });
    await expect(sender().send(job(`${origin}/c`))).rejects.toThrow('500');
  });

  it('writes the message to a file with the log transport and sends nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vertex-push-'));
    try {
      const env = parseEnv({ DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db', PUSH_LOG_DIR: dir });
      expect(env.PUSH_TRANSPORT).toBe('log');
      expect(await new PushSender(env).send(job(`${origin}/x`))).toEqual({ status: 'sent' });
      const written = JSON.parse(await readFile(join(dir, `${deliveryId}.json`), 'utf8'));
      expect(written.payload.tag).toBe(job(origin).payload.tag);
      expect(received).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('push.send job (rule A13)', () => {
  const pgBoss = () => {
    const sent: PushResultJob[] = [];
    const boss = {
      boss: {
        send: vi.fn(async (_queue: string, data: PushResultJob) => {
          sent.push(data);
          return 'id';
        }),
      },
    } as unknown as PgBossService;
    return { boss, sent };
  };

  it('reports a sent push and a gone device at once', async () => {
    const { boss, sent } = pgBoss();
    statuses = [201, 410];
    await new PushSendWorker(boss, sender()).handle(job(`${origin}/a`), 0);
    await new PushSendWorker(boss, sender()).handle(job(`${origin}/b`), 0);
    expect(sent.map((result) => result.status)).toEqual(['sent', 'gone']);
    expect(sent[0]).toMatchObject({ deliveryId, attempts: 1 });
  });

  it('retries a 500 three times, then reports it failed', async () => {
    const { boss, sent } = pgBoss();
    statuses = [500, 500, 500, 500];
    const worker = new PushSendWorker(boss, sender());
    for (const retryCount of [0, 1, 2]) {
      await expect(worker.handle(job(`${origin}/c`), retryCount)).rejects.toThrow();
    }
    expect(sent).toHaveLength(0);
    const result = await worker.handle(job(`${origin}/c`), 3);
    expect(result).toMatchObject({ status: 'failed', attempts: 4 });
    expect(sent).toHaveLength(1);
  });
});

describe('push environment', () => {
  const base = { DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db' };

  it('needs both VAPID keys for the webpush transport', () => {
    expect(() => parseEnv({ ...base, PUSH_TRANSPORT: 'webpush' })).toThrow('VAPID');
    expect(
      parseEnv({
        ...base,
        PUSH_TRANSPORT: 'webpush',
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
      }).VAPID_SUBJECT,
    ).toBe('mailto:info@vertexmedia.pro');
  });
});
