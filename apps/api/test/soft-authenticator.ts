import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { ORIGIN } from './helpers.js';

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest();

const RP_ID = new URL(ORIGIN).hostname;

/**
 * A platform authenticator in software for the attendance passkey tests (F17 part C): it answers
 * the API's WebAuthn options with real ES256 signatures, user present and verified, attestation
 * `none`, as a phone's would.
 */
export class SoftAuthenticator {
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  readonly credentialId = randomBytes(16);

  get id(): string {
    return b64(this.credentialId);
  }

  /** The response to `navigator.credentials.create` for these options. */
  register(options: Record<string, unknown>): Record<string, unknown> {
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    const coseKey = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x ?? '', 'base64url')],
        [-3, Buffer.from(jwk.y ?? '', 'base64url')],
      ]),
    );
    const length = Buffer.alloc(2);
    length.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(RP_ID),
      // User present, user verified, attested credential data.
      Buffer.from([0x45]),
      Buffer.alloc(4),
      Buffer.alloc(16),
      length,
      this.credentialId,
      Buffer.from(coseKey),
    ]);
    const clientData = this.clientData('webauthn.create', options);
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', new Uint8Array(authData)],
      ]) as never,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64(clientData),
        attestationObject: b64(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** The response to `navigator.credentials.get` for these options. */
  assert(options: Record<string, unknown>): Record<string, unknown> {
    const authData = Buffer.concat([sha256(RP_ID), Buffer.from([0x05]), Buffer.alloc(4)]);
    const clientData = this.clientData('webauthn.get', options);
    const signature = sign(
      'sha256',
      Buffer.concat([authData, sha256(clientData)]),
      this.keys.privateKey,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64(clientData),
        authenticatorData: b64(authData),
        signature: b64(signature),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  private clientData(type: string, options: Record<string, unknown>): Buffer {
    return Buffer.from(
      JSON.stringify({ type, challenge: options.challenge, origin: ORIGIN, crossOrigin: false }),
    );
  }
}
