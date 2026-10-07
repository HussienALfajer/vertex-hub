import type { TFunction } from 'i18next';
import type { FieldError } from 'react-hook-form';
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
    if (code) return t(`errors.${code}`);
    // Errors without a code: retrying would fail again, so say why instead.
    if (error.status === 401) return t('errors.SESSION_ENDED');
    if (error.status === 403) return t('errors.FORBIDDEN');
    if (error.status === 404) return t('errors.NOT_FOUND');
    return t('errors.generic');
  }
  const auth = error as Partial<AuthClientError> | null;
  if (auth?.status === 429) return t('errors.TOO_MANY_REQUESTS');
  if (auth?.code === 'TWO_FACTOR_REQUIRED') return t('errors.TWO_FACTOR_REQUIRED');
  if (auth?.code && (AUTH_CODES as readonly string[]).includes(auth.code)) {
    return t(`errors.auth.${auth.code as AuthCode}`);
  }
  return t('errors.generic');
}

/** The `type` of a field error a screen sets itself, with a translated message. */
export const SCREEN_ERROR = 'screen';

/**
 * The text of a field error: the translated message a screen set (`SCREEN_ERROR`), otherwise the
 * field's own hint. Errors from the schema resolver carry Zod's English text and never show.
 */
export function fieldError(error: FieldError | undefined, fallback: string): string {
  return error?.type === SCREEN_ERROR && error.message ? error.message : fallback;
}

/**
 * The `role` of a field's `FieldError`: a refusal a screen set (`SCREEN_ERROR`) is announced; the
 * schema's own errors show as the user fixes them.
 */
export const errorRole = (error: { type?: string } | undefined) =>
  error?.type === SCREEN_ERROR ? ('alert' as const) : undefined;

/**
 * A refused request, and where to show it: `field` when the password the user just typed was
 * wrong (under that field), otherwise for the whole form (`FormAlert`).
 */
export interface Failure {
  message: string;
  field: boolean;
}

/** For the forms that confirm an action with the current password. */
export function passwordFailure(t: TFunction, error: unknown): Failure {
  const code = (error as Partial<AuthClientError> | null)?.code;
  return { message: errorMessage(t, error), field: code === 'INVALID_PASSWORD' };
}
