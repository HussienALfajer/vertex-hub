import {
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  startAuthentication,
  startRegistration,
  WebAuthnError,
} from '@simplewebauthn/browser';
import type {
  FieldWorkRef,
  PunchResult,
  SelfPunchMethod,
  WebAuthnChallenge,
} from '@vertex-hub/contracts';
import { useState } from 'react';
import { usePasskeyOptions, usePunch, usePunchOptions, useRegisterPasskey } from './hr.queries';

/**
 * The phone's side of an attendance punch (rules C3, C6a, C7–C13): the location once, the place
 * check and the challenge from the API, then the passkey, then the punch. Nothing reads the
 * location between punches.
 */

/** The browser refused or the person cancelled the passkey prompt. */
export class PasskeyCancelled extends Error {
  constructor() {
    super('The passkey prompt was cancelled');
    this.name = 'PasskeyCancelled';
  }
}

/** The browser has no WebAuthn (an old browser, or a page not on HTTPS). */
export const supportsPasskeys = () =>
  typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';

export interface PunchLocation {
  latitude: number;
  longitude: number;
  accuracyM: number;
}

/** The phone's location now, or null when it is refused or unavailable (15 seconds at most). */
export function currentLocation(): Promise<PunchLocation | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: Math.round(position.coords.accuracy),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

/** A WebAuthn ceremony, its cancellation told apart from other failures. */
async function ceremony<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof WebAuthnError ||
      (error instanceof DOMException && error.name === 'NotAllowedError')
    ) {
      throw new PasskeyCancelled();
    }
    throw error;
  }
}

export interface PunchRequest {
  method: SelfPunchMethod;
  code?: string;
  shootId?: string;
  fieldNote?: string;
  fieldWork?: FieldWorkRef;
}

/** Where a punch stands, for the button's label and the screen reader. */
export type PunchStep = 'idle' | 'locating' | 'checking' | 'ready' | 'passkey' | 'saving';

/** A punch the API has checked, waiting for the person's tap to open the passkey prompt. */
export interface PreparedPunch {
  request: PunchRequest;
  challenge: WebAuthnChallenge;
}

/**
 * A punch in two taps: `prepare` reads the location and has the API check the place (the code,
 * the network, the remote day, the shoot); `confirm` opens the passkey prompt and writes the
 * punch. Browsers (Safari above all) open the prompt only right after a tap, and the location and
 * the check can take seconds. Both throw `ApiError`; `confirm` also `PasskeyCancelled`.
 */
export function useAttendancePunch() {
  const options = usePunchOptions();
  const punch = usePunch();
  const [step, setStep] = useState<PunchStep>('idle');
  const [prepared, setPrepared] = useState<PreparedPunch | null>(null);

  async function prepare(request: PunchRequest): Promise<void> {
    setPrepared(null);
    try {
      setStep('locating');
      const location = await currentLocation();
      setStep('checking');
      const challenge = await options.mutateAsync({
        method: request.method,
        code: request.code,
        shootId: request.shootId,
        ...(location ?? {}),
      });
      setPrepared({ request, challenge });
      setStep('ready');
    } catch (error) {
      setStep('idle');
      throw error;
    }
  }

  async function confirm(): Promise<PunchResult> {
    if (!prepared) throw new PasskeyCancelled();
    const { request, challenge } = prepared;
    try {
      setStep('passkey');
      const assertion: AuthenticationResponseJSON = await ceremony(() =>
        startAuthentication({
          optionsJSON: challenge.options as unknown as PublicKeyCredentialRequestOptionsJSON,
        }),
      );
      setStep('saving');
      return await punch.mutateAsync({
        ticket: challenge.ticket,
        assertion: assertion as unknown as Record<string, unknown>,
        fieldNote: request.fieldNote,
        fieldWork: request.fieldWork,
      });
    } finally {
      setPrepared(null);
      setStep('idle');
    }
  }

  function cancel() {
    setPrepared(null);
    setStep('idle');
  }

  return { prepare, confirm, cancel, prepared, step, busy: step !== 'idle' && step !== 'ready' };
}

/**
 * Registers this phone's attendance passkey (rules C3 and C9) in two taps, like a punch:
 * `prepare` fetches the options, `confirm` opens the passkey prompt right after the second tap.
 */
export function usePasskeyRegistration() {
  const options = usePasskeyOptions();
  const register = useRegisterPasskey();
  const [prepared, setPrepared] = useState<WebAuthnChallenge | null>(null);

  async function prepare(): Promise<void> {
    setPrepared(await options.mutateAsync());
  }

  async function confirm() {
    if (!prepared) throw new PasskeyCancelled();
    try {
      const response: RegistrationResponseJSON = await ceremony(() =>
        startRegistration({
          optionsJSON: prepared.options as unknown as PublicKeyCredentialCreationOptionsJSON,
        }),
      );
      return await register.mutateAsync({
        ticket: prepared.ticket,
        response: response as unknown as Record<string, unknown>,
      });
    } finally {
      setPrepared(null);
    }
  }

  return {
    prepare,
    confirm,
    ready: prepared !== null,
    busy: options.isPending || register.isPending,
  };
}
