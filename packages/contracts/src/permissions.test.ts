import { describe, expect, it } from 'vitest';
import {
  DEPARTMENT_CAPABILITIES,
  effectiveRoles,
  grantedPermissions,
  hasPermission,
  PERMISSION_MAP,
  PERMISSIONS,
  permissionScopes,
  twoFactorRequired,
  type UserAccess,
} from './permissions.js';
import { ROLES } from './roles.js';

const design = { code: 'design', isManager: false } as const;

function access(
  roles: UserAccess['roles'],
  departments: UserAccess['departments'] = [design],
): UserAccess {
  return { roles, departments };
}

describe('permission map', () => {
  it('defines grants for every role', () => {
    expect(Object.keys(PERMISSION_MAP).sort()).toEqual([...ROLES].sort());
  });

  it('gives the General Manager every permission over all records', () => {
    for (const permission of PERMISSIONS) {
      expect(permissionScopes(access(['general_manager']), permission)).toEqual(['all']);
    }
  });

  it('keeps invoices away from employees and lets finance manage them', () => {
    expect(hasPermission(access(['employee']), 'invoices.read')).toBe(false);
    expect(hasPermission(access(['finance']), 'invoices.manage')).toBe(true);
    expect(hasPermission(access(['finance']), 'payments.manage')).toBe(true);
  });

  it('gives financial reports to finance but not operational reports', () => {
    expect(permissionScopes(access(['finance']), 'reports.finance')).toEqual(['all']);
    expect(hasPermission(access(['finance']), 'reports.read')).toBe(false);
    expect(hasPermission(access(['department_manager']), 'reports.finance')).toBe(false);
  });

  it('reserves discount approval for the General Manager (ADR 0007)', () => {
    const others = ROLES.filter((role) => role !== 'general_manager');
    expect(hasPermission(access(others), 'quotes.approve_discount')).toBe(false);
  });

  it('lets every employee read the team directory', () => {
    expect(permissionScopes(access(['employee']), 'users.read')).toEqual(['all']);
    expect(PERMISSION_MAP.department_manager['users.read']).toBeUndefined();
  });

  it('keeps user management, the audit log and template management off every role but GM', () => {
    const others = ROLES.filter((role) => role !== 'general_manager');
    for (const permission of ['users.manage', 'audit.read', 'templates.manage'] as const) {
      expect(hasPermission(access(others), permission)).toBe(false);
    }
    expect(hasPermission(access(['department_manager']), 'templates.read')).toBe(true);
  });

  it('lets account managers work the leads they own', () => {
    expect(permissionScopes(access(['account_manager']), 'leads.manage')).toEqual(['assigned']);
  });

  it('combines the scopes of several roles', () => {
    // A designer who is also an account manager (ADR 0007).
    expect(permissionScopes(access(['employee', 'account_manager']), 'tasks.read')).toEqual([
      'own_clients',
      'assigned',
    ]);
    expect(permissionScopes(access(['employee']), 'clients.manage')).toEqual([]);
  });

  it('lists granted permissions once, in catalog order, with their scopes', () => {
    const granted = grantedPermissions(access(['employee', 'department_manager']));
    const names = granted.map((g) => g.permission);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(PERMISSIONS.filter((p) => names.includes(p)));
    expect(granted).toContainEqual({
      permission: 'tasks.read',
      scopes: ['department', 'assigned'],
    });
    expect(grantedPermissions(access([], []))).toEqual([]);
  });
});

describe('clients (F02)', () => {
  it('lets every user read every client and write in the communication log', () => {
    expect(permissionScopes(access(['employee']), 'clients.read')).toEqual(['all']);
    expect(permissionScopes(access(['employee']), 'clients.log')).toEqual(['all']);
    for (const role of ['department_manager', 'account_manager', 'finance'] as const) {
      expect(PERMISSION_MAP[role]['clients.read'], role).toBeUndefined();
    }
  });

  it('lets account managers manage their own clients only', () => {
    expect(permissionScopes(access(['employee', 'account_manager']), 'clients.manage')).toEqual([
      'own_clients',
    ]);
  });

  it('lets the Operations manager manage every client', () => {
    const manager = access(
      ['employee', 'department_manager'],
      [{ code: 'internal_operations', isManager: true }],
    );
    expect(permissionScopes(manager, 'clients.manage')).toEqual(['all']);
    const member = access(['employee'], [{ code: 'internal_operations', isManager: false }]);
    expect(hasPermission(member, 'clients.manage')).toBe(false);
  });
});

describe('department capabilities', () => {
  it('only names known departments', () => {
    expect(Object.keys(DEPARTMENT_CAPABILITIES).sort()).toEqual([
      'general_communication',
      'internal_operations',
      'marketing',
      'medical_consultation',
    ]);
  });

  it('gives the Operations manager user management, the audit log and templates', () => {
    const manager = access(
      ['employee', 'department_manager'],
      [{ code: 'internal_operations', isManager: true }],
    );
    for (const permission of [
      'users.manage',
      'audit.read',
      'templates.read',
      'templates.manage',
    ] as const) {
      expect(permissionScopes(manager, permission)).toEqual(['all']);
    }
  });

  it('gives nothing extra to a plain member of Internal Operations', () => {
    const member = access(['employee'], [{ code: 'internal_operations', isManager: false }]);
    expect(hasPermission(member, 'users.manage')).toBe(false);
    expect(hasPermission(member, 'audit.read')).toBe(false);
  });

  it('grants member capabilities through a secondary membership too', () => {
    const member = access(
      ['employee'],
      [design, { code: 'medical_consultation', isManager: false }],
    );
    expect(permissionScopes(member, 'approvals.review_medical')).toEqual(['all']);
  });

  it('unions department and role scopes for the same permission', () => {
    const marketer = access(
      ['employee', 'account_manager'],
      [{ code: 'marketing', isManager: false }],
    );
    expect(permissionScopes(marketer, 'leads.read')).toEqual(['all', 'assigned']);
  });
});

describe('effective roles', () => {
  it('adds employee to every user and keeps catalog order', () => {
    expect(effectiveRoles(['finance', 'general_manager'], [design])).toEqual([
      'general_manager',
      'employee',
      'finance',
    ]);
  });

  it('adds department manager while the user manages a department', () => {
    expect(effectiveRoles([], [{ code: 'design', isManager: true }])).toEqual([
      'department_manager',
      'employee',
    ]);
    expect(effectiveRoles([], [])).toEqual(['employee']);
  });
});

describe('two-factor requirement', () => {
  it('requires 2FA for General Managers, Finance and the Operations manager', () => {
    expect(twoFactorRequired(access(['general_manager', 'employee']))).toBe(true);
    expect(twoFactorRequired(access(['employee', 'finance']))).toBe(true);
    expect(
      twoFactorRequired(access(['employee'], [{ code: 'internal_operations', isManager: true }])),
    ).toBe(true);
  });

  it('leaves it optional for everyone else', () => {
    expect(twoFactorRequired(access(['employee', 'account_manager']))).toBe(false);
    expect(
      twoFactorRequired(access(['employee'], [{ code: 'internal_operations', isManager: false }])),
    ).toBe(false);
    expect(
      twoFactorRequired(access(['department_manager'], [{ code: 'design', isManager: true }])),
    ).toBe(false);
  });
});
