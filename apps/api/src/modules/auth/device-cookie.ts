import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** F01B rule 1: the cookie that names a browser across its sessions. */
export const DEVICE_COOKIE = 'vh_device';

/** 400 days, the longest a browser keeps a cookie. */
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** Better Auth's session cookie, with or without the `__Secure-` prefix. */
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/;

/** Requests that create a session: the password step and the two-factor step. */
const SIGN_IN_PATHS = ['/api/auth/sign-in/', '/api/auth/two-factor/verify-'];

const VALUE = /^[A-Za-z0-9_-]{43}$/;

/** The `vh_device` value a request carries, when it is well formed. */
export function deviceCookieOf(cookieHeader: string | undefined): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === DEVICE_COOKIE && value && VALUE.test(value)) return value;
  }
  return null;
}

/** Rule 1: the browser key stored on a session; the cookie value itself is never stored. */
export function browserKeyOf(cookieHeader: string | undefined): string | null {
  const value = deviceCookieOf(cookieHeader);
  return value ? createHash('sha256').update(value).digest('hex') : null;
}

/**
 * Rules 1 and 3: gives a browser its `vh_device` cookie on a sign-in request, or on a request
 * with a session, when it has none. The new value is added to the request's cookies, so Better
 * Auth's session hooks and the API guard read it on this same request, and to the response when
 * its headers are written (Better Auth replaces the `set-cookie` header it finds).
 *
 * A sign-in gets a random value. A session without the cookie gets one derived from its session
 * cookie, so the parallel requests of an app load all issue the same value and the session is
 * keyed with the value the browser keeps.
 */
export function deviceCookie(secret: string, secure: boolean) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
    const cookies = request.headers.cookie;
    const signingIn = SIGN_IN_PATHS.some((path) => request.url?.startsWith(path));
    const session = SESSION_COOKIE.exec(cookies ?? '')?.[1];
    if (deviceCookieOf(cookies) || (!signingIn && !session)) {
      next();
      return;
    }
    const value =
      signingIn || !session
        ? randomBytes(32).toString('base64url')
        : createHmac('sha256', secret).update(`vh_device:${session}`).digest('base64url');
    request.headers.cookie = cookies
      ? `${cookies}; ${DEVICE_COOKIE}=${value}`
      : `${DEVICE_COOKIE}=${value}`;
    const attributes = [
      `${DEVICE_COOKIE}=${value}`,
      'Path=/api',
      `Max-Age=${MAX_AGE_SECONDS}`,
      'HttpOnly',
      'SameSite=Lax',
      ...(secure ? ['Secure'] : []),
    ].join('; ');
    const writeHead = response.writeHead;
    response.writeHead = function (this: ServerResponse, ...args: unknown[]) {
      const existing = response.getHeader('set-cookie');
      const list =
        existing === undefined ? [] : Array.isArray(existing) ? existing : [String(existing)];
      response.setHeader('set-cookie', [...list, attributes]);
      return (writeHead as (...rest: unknown[]) => ServerResponse).apply(this, args);
    } as ServerResponse['writeHead'];
    next();
  };
}
