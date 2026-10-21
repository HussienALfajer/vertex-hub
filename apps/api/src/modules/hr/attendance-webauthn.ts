import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { WEBAUTHN_TICKET_SECONDS, type WebAuthnChallenge } from '@vertex-hub/contracts';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { ENV, type Env } from '../../core/config/env.js';
import { CodedException } from '../../core/errors/index.js';

/** What a signed ticket carries from the options request to the next one. */
export interface Ticket {
  purpose: 'register' | 'punch';
  userId: string;
  challenge: string;
  expiresAt: number;
}

/** A credential as the attendance passkey stores it. */
export interface StoredCredential {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
}

const ticketExpired = () =>
  new CodedException(409, 'TICKET_EXPIRED', 'The confirmation took too long; start again');

export const passkeyFailed = () =>
  new CodedException(403, 'PASSKEY_FAILED', 'The attendance passkey could not be verified');

/**
 * Attendance passkeys (rules C3, C7, ADR 0039): WebAuthn with the platform authenticator and user
 * verification required, for the web app's origin. The challenge travels in a ticket signed with
 * `BETTER_AUTH_SECRET` (60 seconds), so nothing is stored between the two requests; the kiosk
 * secrets are encrypted with the same secret, like the TOTP secrets.
 */
@Injectable()
export class AttendanceWebAuthn {
  private readonly origin: string;
  private readonly rpID: string;
  private readonly ticketKey: Buffer;

  constructor(@Inject(ENV) private readonly env: Env) {
    const url = new URL(env.APP_URL);
    this.origin = url.origin;
    this.rpID = url.hostname;
    this.ticketKey = createHmac('sha256', env.BETTER_AUTH_SECRET)
      .update('vh_attendance_ticket')
      .digest();
  }

  async registrationOptions(
    user: { id: string; email: string; name: string },
    exclude: readonly StoredCredential[],
    extra: Record<string, unknown> = {},
  ): Promise<WebAuthnChallenge> {
    const options = await generateRegistrationOptions({
      rpName: 'Vertex Hub',
      rpID: this.rpID,
      userName: user.email,
      userID: new TextEncoder().encode(user.id),
      userDisplayName: user.name,
      attestationType: 'none',
      excludeCredentials: exclude.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports,
      })),
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });
    return {
      ticket: this.sign(
        { purpose: 'register', userId: user.id, challenge: options.challenge },
        extra,
      ),
      options: options as unknown as Record<string, unknown>,
    };
  }

  /** Verifies a registration; the new credential, or `PASSKEY_FAILED`. */
  async verifyRegistration(
    ticket: Ticket,
    response: Record<string, unknown>,
  ): Promise<StoredCredential> {
    const result = await verifyRegistrationResponse({
      response: response as unknown as RegistrationResponseJSON,
      expectedChallenge: ticket.challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      requireUserVerification: true,
    }).catch(() => null);
    if (!result?.verified) throw passkeyFailed();
    const { credential } = result.registrationInfo;
    return {
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports ?? [],
    };
  }

  async authenticationOptions(
    userId: string,
    credential: StoredCredential,
    extra: Record<string, unknown>,
  ): Promise<WebAuthnChallenge> {
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials: [{ id: credential.credentialId, transports: credential.transports }],
      userVerification: 'required',
    });
    return {
      ticket: this.sign({ purpose: 'punch', userId, challenge: options.challenge }, extra),
      options: options as unknown as Record<string, unknown>,
    };
  }

  /** Verifies an assertion against the credential; its new counter, or `PASSKEY_FAILED`. */
  async verifyAuthentication(
    ticket: Ticket,
    assertion: Record<string, unknown>,
    credential: StoredCredential,
  ): Promise<number> {
    if (assertion.id !== credential.credentialId) throw passkeyFailed();
    const stored: WebAuthnCredential = {
      id: credential.credentialId,
      publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')),
      counter: credential.counter,
      transports: credential.transports,
    };
    const result = await verifyAuthenticationResponse({
      response: assertion as unknown as AuthenticationResponseJSON,
      expectedChallenge: ticket.challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      credential: stored as never,
      requireUserVerification: true,
    }).catch(() => null);
    if (!result?.verified) throw passkeyFailed();
    return result.authenticationInfo.newCounter;
  }

  /** The ticket's content, checked for its signature, purpose, user and expiry. */
  open<T extends Record<string, unknown>>(
    token: string,
    purpose: Ticket['purpose'],
    userId: string,
  ): Ticket & T {
    const [payload = '', mac = ''] = token.split('.');
    const expected = createHmac('sha256', this.ticketKey).update(payload).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw ticketExpired();
    }
    const ticket = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Ticket & T;
    if (ticket.purpose !== purpose || ticket.userId !== userId || ticket.expiresAt < Date.now()) {
      throw ticketExpired();
    }
    return ticket;
  }

  encryptSecret(secret: string): Promise<string> {
    return symmetricEncrypt({ key: this.env.BETTER_AUTH_SECRET, data: secret });
  }

  decryptSecret(encrypted: string): Promise<string> {
    return symmetricDecrypt({ key: this.env.BETTER_AUTH_SECRET, data: encrypted });
  }

  private sign(ticket: Omit<Ticket, 'expiresAt'>, extra: Record<string, unknown>): string {
    const payload = Buffer.from(
      JSON.stringify({
        ...extra,
        ...ticket,
        expiresAt: Date.now() + WEBAUTHN_TICKET_SECONDS * 1000,
      }),
    ).toString('base64url');
    const mac = createHmac('sha256', this.ticketKey).update(payload).digest('base64url');
    return `${payload}.${mac}`;
  }
}
