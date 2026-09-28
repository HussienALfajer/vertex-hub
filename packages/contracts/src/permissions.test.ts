import { describe, expect, it } from 'vitest';
import {
  grantedPermissions,
  hasPermission,
  PERMISSION_MAP,
  PERMISSIONS,
  permissionScopes,
} from './permissions.js';
import { ROLES } from './roles.js';

describe('permission map', () => {
  it('defines grants for every role', () => {
    expect(Object.keys(PERMISSION_MAP).sort()).toEqual([...ROLES].sort());
  });

  it('gives the General Manager every permission over all records', () => {
    for (const permission of PERMISSIONS) {
      expect(permissionScopes(['general_manager'], permission)).toEqual(['all']);
    }
  });

  it('keeps invoices away from employees and lets finance manage them', () => {
    expect(hasPermission(['employee'], 'invoices.read')).toBe(false);
    expect(hasPermission(['finance'], 'invoices.manage')).toBe(true);
    expect(hasPermission(['finance'], 'payments.manage')).toBe(true);
  });

  it('reserves discount approval for the General Manager (ADR 0007)', () => {
    const others = ROLES.filter((role) => role !== 'general_manager');
    expect(hasPermission(others, 'quotes.approve_discount')).toBe(false);
  });

  it('combines the scopes of several roles', () => {
    // A designer who is also an account manager (ADR 0007).
    expect(permissionScopes(['employee', 'account_manager'], 'clients.read')).toEqual([
      'own_clients',
      'assigned',
    ]);
    expect(permissionScopes(['employee'], 'clients.manage')).toEqual([]);
  });

  it('lists granted permissions once, in catalog order', () => {
    const granted = grantedPermissions(['employee', 'department_manager']);
    expect(new Set(granted).size).toBe(granted.length);
    expect(granted).toEqual(PERMISSIONS.filter((p) => granted.includes(p)));
    expect(granted).toContain('tasks.manage');
    expect(grantedPermissions([])).toEqual([]);
  });
});
