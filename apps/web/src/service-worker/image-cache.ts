/*
 * F01C rule 13: the service worker answers image routes from its own cache first, so the last
 * loaded photos and logos show without a connection. An image never changes (a new image has a
 * new id), so a kept copy never goes stale. Shared with the app, which erases it with the rest of
 * the offline cache (F16 rule A5).
 */

export const IMAGE_CACHE = 'vertex-hub-images';

const IMAGE_ROUTE = /^\/api\/images\/[0-9a-f-]+\/(sm|md)$/;

/** Whether a request is for an image rendition (`GET /api/images/:id/:size`). */
export function isImageRequest(url: URL, method: string, origin: string): boolean {
  return method === 'GET' && url.origin === origin && IMAGE_ROUTE.test(url.pathname);
}

/**
 * Whether a response may be kept: a ready rendition. A pending image is served with `no-store`
 * (rule 11), so its rendition replaces it on the next load; a 404 shows the initial.
 */
export function isKeptImage(response: Response): boolean {
  return response.ok && !/no-store/.test(response.headers.get('cache-control') ?? '');
}
