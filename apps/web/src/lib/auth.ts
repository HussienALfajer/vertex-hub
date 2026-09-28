import { queryOptions } from '@tanstack/react-query';
import { type MeResponse, meResponseSchema } from '@vertex-hub/contracts';
import { createAuthClient } from 'better-auth/client';

/** Better Auth is served by the API under the same origin (the Vite proxy locally, nginx in production). */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
});

/** The signed-in user, or null without a session. */
async function fetchMe(): Promise<MeResponse | null> {
  const response = await fetch('/api/me');
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Loading the session failed with HTTP ${response.status}`);
  return meResponseSchema.parse(await response.json());
}

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: fetchMe,
  staleTime: 5 * 60_000,
  retry: false,
});

/** Accepts only same-origin paths as a post-login destination, to prevent open redirects. */
export function safeRedirect(target: unknown): string {
  return typeof target === 'string' && target.startsWith('/') && !target.startsWith('//')
    ? target
    : '/';
}
