import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { PushSendJob } from '@vertex-hub/contracts';
import webpush from 'web-push';
import { ENV, type Env } from '../core/config/env.js';

type PushEnv = Pick<
  Env,
  'PUSH_TRANSPORT' | 'PUSH_LOG_DIR' | 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'
>;

/** How long a push service may take to answer. */
const TIMEOUT_MS = 30_000;

/** What the push service answered: accepted, or refused for good (404, 410: the device is gone). */
export type PushOutcome = { status: 'sent' } | { status: 'gone'; error: string };

/** Any other refusal: worth retrying (spec F16 rule A13). */
export class PushRefusedError extends Error {}

/**
 * Sends one Web Push message (spec F16 rule A8, ADR 0036): `web-push` encrypts the payload for
 * the subscription (aes128gcm) and signs the VAPID header with the private key; the request goes
 * out with `fetch`. The `log` transport writes the message as `<delivery id>.json` under
 * `PUSH_LOG_DIR` and sends nothing.
 */
@Injectable()
export class PushSender {
  constructor(@Inject(ENV) private readonly env: PushEnv) {}

  async send(job: PushSendJob): Promise<PushOutcome> {
    if (this.env.PUSH_TRANSPORT === 'log') {
      const dir = resolve(this.env.PUSH_LOG_DIR);
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, `${job.payload.deliveryId}.json`),
        `${JSON.stringify(job, null, 2)}\n`,
      );
      return { status: 'sent' };
    }
    const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = this.env;
    if (!publicKey || !privateKey) throw new PushRefusedError('VAPID keys are not configured');
    const request = webpush.generateRequestDetails(job.subscription, JSON.stringify(job.payload), {
      vapidDetails: { subject: this.env.VAPID_SUBJECT, publicKey, privateKey },
      TTL: job.ttlSeconds,
      urgency: job.urgency,
      contentEncoding: 'aes128gcm',
    });
    const response = await fetch(request.endpoint, {
      method: request.method,
      headers: request.headers as Record<string, string>,
      body: request.body ?? undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return { status: 'sent' };
    const error = `${response.status} ${(await response.text()).slice(0, 200)}`.trim();
    if (response.status === 404 || response.status === 410) return { status: 'gone', error };
    throw new PushRefusedError(error);
  }
}
