import {
  type AssignableRole,
  effectiveRoles,
  grantedPermissions,
  type MeResponse,
} from '@vertex-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { hasQuoteAccess } from './client-quotes-tab';

// The auth client reads the page's origin when its module loads.
vi.hoisted(() => vi.stubGlobal('window', { location: { origin: 'http://localhost' } }));

const ME = '0190a3c2-0000-7000-8000-000000000001';
const OTHER = '0190a3c2-0000-7000-8000-000000000002';

function me(assigned: AssignableRole[]): MeResponse {
  const roles = effectiveRoles(assigned, []);
  return {
    user: { id: ME, name: 'مستخدم', email: 'user@vertexhub.test', image: null },
    roles,
    departments: [],
    permissions: grantedPermissions({ roles, departments: [] }),
    twoFactor: { enabled: true, required: false },
  };
}

describe('hasQuoteAccess', () => {
  it('shows the Quotes tab to an account manager on their own client only', () => {
    expect(hasQuoteAccess(me(['account_manager']), ME)).toBe(true);
    expect(hasQuoteAccess(me(['account_manager']), OTHER)).toBe(false);
  });

  it('shows it on every client to readers of all quotes', () => {
    expect(hasQuoteAccess(me(['general_manager']), OTHER)).toBe(true);
    expect(hasQuoteAccess(me(['finance']), OTHER)).toBe(true);
  });

  it('hides it from a user without quotes.read', () => {
    expect(hasQuoteAccess(me([]), ME)).toBe(false);
  });
});
