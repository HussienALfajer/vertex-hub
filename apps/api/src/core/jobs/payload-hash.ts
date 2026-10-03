import { createHash } from 'node:crypto';

/** JSON with sorted keys: `jsonb` does not keep key order, and the hash must survive it. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Names a render job's output (F04 and F13 PDFs): the same payload, the same SHA-256 hex, however
 * its keys were ordered.
 */
export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}
