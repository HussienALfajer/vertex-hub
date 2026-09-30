import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { useRouteContext } from '@tanstack/react-router';
import type { MeResponse, Permission, PermissionScope } from '@vertex-hub/contracts';
import { createAuthClient } from 'better-auth/client';
import { twoFactorClient } from 'better-auth/client/plugins';
import { api } from './api/client';

/** Better Auth is served by the API under the same origin (the Vite proxy locally, nginx in production). */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
  // The sign-in screen handles the two-factor step itself.
  plugins: [twoFactorClient()],
});

/** The signed-in user, or null without a session. */
async function fetchMe(): Promise<MeResponse | null> {
  const { data, response } = await api.GET('/api/me');
  if (response.status === 401) return null;
  if (!data) throw new Error(`Loading the session failed with HTTP ${response.status}`);
  return data;
}

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: fetchMe,
  staleTime: 60_000,
  // Roles and departments can change while the tab is open (F01 edge case 2).
  refetchOnWindowFocus: 'always',
  retry: false,
});

/**
 * The signed-in user inside the app shell, kept fresh by the query (the route context holds the
 * value from when the page loaded).
 */
export function useMe(): MeResponse {
  const { me } = useRouteContext({ from: '/_app' });
  const { data } = useQuery(meQuery);
  return data ?? me;
}

/** Whether the user holds a permission with any scope. Hides UI only; the API enforces it. */
export function can(me: MeResponse, permission: Permission): boolean {
  return me.permissions.some((granted) => granted.permission === permission);
}

/**
 * Whether the user holds a permission with scope `all`, as the actions that no narrower scope
 * covers need (creating a client, archiving it). Hides UI only; the API enforces it.
 */
export function canAll(me: MeResponse, permission: Permission): boolean {
  return me.permissions.some(
    (granted) => granted.permission === permission && granted.scopes.includes('all'),
  );
}

/** Every scope under which the user holds a permission; empty without it. Hides UI only. */
export function scopesOf(me: MeResponse, permission: Permission): PermissionScope[] {
  return me.permissions.find((granted) => granted.permission === permission)?.scopes ?? [];
}

/**
 * Leaves the signed-in state after sign-out or an expired session: stops running requests, marks
 * the session gone, runs `navigate` (to the sign-in page), then drops every cached answer once
 * the app's pages have unmounted, so nothing refetches with the old session and the next user
 * never sees the previous one's data.
 */
export async function leaveSession(
  queryClient: QueryClient,
  navigate: () => Promise<void>,
): Promise<void> {
  await queryClient.cancelQueries();
  queryClient.setQueryData(meQuery.queryKey, null);
  await navigate();
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== meQuery.queryKey[0] });
}

/** Two-factor sign-in is required and not set up yet: the user must go to the setup page. */
export function needsTwoFactorSetup(me: MeResponse): boolean {
  return me.twoFactor.required && !me.twoFactor.enabled;
}

/**
 * Accepts only same-origin paths as a post-login destination, to prevent open redirects. The
 * target is resolved as the browser would: URL parsing drops tabs and line breaks, so "/\n/host"
 * would otherwise become "//host", another site.
 */
export function safeRedirect(target: unknown): string {
  if (typeof target !== 'string' || !target.startsWith('/')) return '/';
  // Control characters have no place in a path of the app.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
  if (/[\u0000-\u001f\u007f]/.test(target)) return '/';
  const origin = window.location.origin;
  const resolved = new URL(target, origin);
  if (resolved.origin !== origin) return '/';
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
