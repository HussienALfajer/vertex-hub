import { createDecipheriv } from 'node:crypto';
import type { EmailSendJob } from '@vertex-hub/contracts';

/**
 * The job's data with its token links back in place (ADR 0028): `sealed` is the JSON of those
 * fields, encrypted by the API with AES-256-GCM under `EMAIL_SECRET_KEY` (base64url of IV, tag
 * and ciphertext). Throws when the key does not match.
 */
export function unsealData(
  job: Pick<EmailSendJob, 'data' | 'sealed'>,
  key: Buffer,
): Record<string, unknown> {
  if (!job.sealed) return job.data;
  const sealed = Buffer.from(job.sealed, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  const json = Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
  return { ...job.data, ...(JSON.parse(json.toString('utf8')) as Record<string, unknown>) };
}
