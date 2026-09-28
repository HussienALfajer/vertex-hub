import type { TFunction } from 'i18next';
import { ApiError } from './api/client';

/** Better Auth error codes the screens explain (sign-in, password and 2FA forms). */
const AUTH_CODES = [
  'INVALID_EMAIL_OR_PASSWORD',
  'INVALID_PASSWORD',
  'INVALID_CODE',
  'INVALID_BACKUP_CODE',
  'INVALID_TWO_FACTOR_COOKIE',
  'ACCOUNT_TEMPORARILY_LOCKED',
  'PASSWORD_TOO_SHORT',
] as const;

type AuthCode = (typeof AUTH_CODES)[number];

/** A Better Auth client error: `{ code, message, status }`. */
export interface AuthClientError {
  code?: string;
  status: number;
}

/** The message to show for a failed API or Better Auth call; never the server's own text. */
export function errorMessage(t: TFunction, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return t('errors.TOO_MANY_REQUESTS');
    const code = error.knownCode;
    return code ? t(`errors.${code}`) : t('errors.generic');
  }
  const auth = error as Partial<AuthClientError> | null;
  if (auth?.status === 429) return t('errors.TOO_MANY_REQUESTS');
  if (auth?.code === 'TWO_FACTOR_REQUIRED') return t('errors.TWO_FACTOR_REQUIRED');
  if (auth?.code && (AUTH_CODES as readonly string[]).includes(auth.code)) {
    return t(`errors.auth.${auth.code as AuthCode}`);
  }
  return t('errors.generic');
}
