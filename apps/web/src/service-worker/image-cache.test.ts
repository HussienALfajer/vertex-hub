import { describe, expect, it } from 'vitest';
import { isImageRequest, isKeptImage } from './image-cache';

const origin = 'https://hub.example.test';
const id = '0199a4b2-7c1e-7d3a-9f00-0123456789ab';

describe('image cache (F01C rule 13)', () => {
  it('matches image renditions of the app only', () => {
    expect(isImageRequest(new URL(`${origin}/api/images/${id}/sm`), 'GET', origin)).toBe(true);
    expect(isImageRequest(new URL(`${origin}/api/images/${id}/md`), 'GET', origin)).toBe(true);
    expect(isImageRequest(new URL(`${origin}/api/images/${id}/lg`), 'GET', origin)).toBe(false);
    expect(isImageRequest(new URL(`${origin}/api/users/${id}/image`), 'GET', origin)).toBe(false);
    expect(isImageRequest(new URL(`${origin}/api/images/${id}/sm`), 'PUT', origin)).toBe(false);
    expect(isImageRequest(new URL(`https://other.test/api/images/${id}/sm`), 'GET', origin)).toBe(
      false,
    );
  });

  it('keeps ready renditions, never pending squares or refusals', () => {
    const ready = new Response('x', {
      headers: { 'cache-control': 'private, max-age=31536000, immutable' },
    });
    expect(isKeptImage(ready)).toBe(true);
    expect(isKeptImage(new Response('x', { headers: { 'cache-control': 'no-store' } }))).toBe(
      false,
    );
    expect(isKeptImage(new Response(null, { status: 404 }))).toBe(false);
  });
});
