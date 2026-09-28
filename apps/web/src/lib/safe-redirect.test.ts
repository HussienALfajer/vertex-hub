import { describe, expect, it, vi } from 'vitest';

// auth.ts creates the Better Auth client from window.location at import time.
vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:5173' } });
const { safeRedirect } = await import('./auth');

describe('safeRedirect', () => {
  it('keeps paths inside the app', () => {
    expect(safeRedirect('/team?search=ali')).toBe('/team?search=ali');
  });

  it('refuses other sites and anything that is not a path', () => {
    for (const target of ['//evil.example', '/\\evil.example', 'https://evil.example', 'team', 7]) {
      expect(safeRedirect(target)).toBe('/');
    }
  });
});
