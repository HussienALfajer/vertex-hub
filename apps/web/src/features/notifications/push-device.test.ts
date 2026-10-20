import { describe, expect, it } from 'vitest';
import { applicationServerKey } from './push-device';

describe('applicationServerKey (F16 rule A7)', () => {
  it('decodes the base64url VAPID key the API sends', () => {
    // 65 bytes: an uncompressed P-256 public key starts with 0x04.
    const bytes = new Uint8Array(65).map((_, index) => (index === 0 ? 4 : index * 3));
    const base64url = Buffer.from(bytes).toString('base64url');
    expect(base64url).not.toContain('=');
    expect([...applicationServerKey(base64url)]).toEqual([...bytes]);
  });
});
