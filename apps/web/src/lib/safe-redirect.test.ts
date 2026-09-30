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

  it('refuses paths the URL parser turns into another site', () => {
    for (const target of ['/\n/evil.example', '/\t/evil.example', '/\r/evil.example', '/\u0000x']) {
      expect(safeRedirect(target)).toBe('/');
    }
  });

  it('keeps the search and hash of a path', () => {
    expect(safeRedirect('/tasks/1?tab=comments#c2')).toBe('/tasks/1?tab=comments#c2');
  });
});
