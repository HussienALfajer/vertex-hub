import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

// The API client reads window.location at import time.
vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:5173' } });
const { ApiError } = await import('./api/client');
const { errorMessage } = await import('./errors');

// The key stands in for its translation.
const t = ((key: string) => key) as unknown as TFunction;
const failure = (status: number, code?: string) => new ApiError(status, code, undefined, 'x');

describe('errorMessage', () => {
  it('shows the translation of a known code', () => {
    expect(errorMessage(t, failure(409, 'PROJECT_CLOSED'))).toBe('errors.PROJECT_CLOSED');
  });

  it('explains errors without a code by their status, not "try again"', () => {
    expect(errorMessage(t, failure(401))).toBe('errors.SESSION_ENDED');
    expect(errorMessage(t, failure(403))).toBe('errors.FORBIDDEN');
    expect(errorMessage(t, failure(404))).toBe('errors.NOT_FOUND');
    expect(errorMessage(t, failure(429))).toBe('errors.TOO_MANY_REQUESTS');
    expect(errorMessage(t, failure(500))).toBe('errors.generic');
  });

  it('ignores a code the app does not know', () => {
    expect(errorMessage(t, failure(403, 'SOMETHING_NEW'))).toBe('errors.FORBIDDEN');
  });
});
