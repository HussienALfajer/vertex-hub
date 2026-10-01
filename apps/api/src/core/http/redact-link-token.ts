/** The API routes of an approval link (F09): the path segment after this prefix is its token. */
const LINK_PREFIX = '/api/public/approvals/';

/**
 * The token of an approval link is its only credential and is never stored or logged (ADR 0002,
 * ADR 0020): replaces it in a request URL before the URL is written to the log.
 */
export function redactLinkToken(url: string): string {
  const start = url.indexOf(LINK_PREFIX);
  if (start === -1) return url;
  const from = start + LINK_PREFIX.length;
  const rest = url.slice(from);
  const end = rest.search(/[/?#]/);
  return `${url.slice(0, from)}[token]${end === -1 ? '' : rest.slice(end)}`;
}

/** pino-http's serialized request, without the link token in its URL and route parameters. */
export function redactLoggedRequest<T extends { url?: string; params?: Record<string, unknown> }>(
  request: T,
): T {
  return {
    ...request,
    ...(request.url && { url: redactLinkToken(request.url) }),
    ...(request.params?.token !== undefined && {
      params: { ...request.params, token: '[token]' },
    }),
  };
}
